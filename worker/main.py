"""Main entrypoint for the AI Task Processing Worker.

Receives task jobs from Redis Streams, manages processing leases in MongoDB,
dispatches execution to the processing engine, records execution logs,
and enforces strict at-least-once acknowledgement semantics.
"""

import logging
import signal
import sys
import time
from typing import Dict

from config import Config
from db import Database, parse_object_id
from engine import execute_operation
from redis_client import RedisStreamClient

# Setup structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("worker.main")


class Worker:
    """Manages the worker lifecycle, consumer loop, and job execution pipeline."""

    def __init__(self, config: Config):
        self.config = config
        self.running = True
        self.redis = RedisStreamClient(config.REDIS_URL)
        self.db = Database(config.MONGODB_URI, config.MONGODB_DATABASE)

    def handle_signal(self, signum, _frame):
        """Signal handler to allow graceful shutdown without interrupting an active task."""
        sig_name = signal.Signals(signum).name
        logger.info(f"Received shutdown signal {sig_name}. Preparing to stop...")
        self.running = False

    def setup(self):
        """Validates configuration and verifies database/queue connectivity."""
        self.config.validate()

        logger.info(f"Connecting to Redis at {self.config.REDIS_URL}...")
        self.redis.connect()

        logger.info("Connecting to MongoDB Atlas...")
        self.db.connect()

        logger.info(
            f"Ensuring Redis consumer group '{self.config.REDIS_CONSUMER_GROUP}' "
            f"on stream '{self.config.REDIS_STREAM}'..."
        )
        self.redis.ensure_consumer_group(
            self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP
        )

        logger.info(
            f"Worker initialized successfully. "
            f"Consumer Identity: {self.config.REDIS_CONSUMER_NAME}"
        )

    def process_message(self, message_id: str, fields: Dict[str, str]):
        """Executes the full task lifecycle for a single Redis Stream message.

        Enforces:
        1. Input validation
        2. Terminal state idempotency
        3. Lease-based concurrency acquisition
        4. Pure engine execution
        5. Atomic state update
        6. Post-persistence message acknowledgment
        """
        task_id = fields.get("taskId")
        operation = fields.get("operation")
        input_data = fields.get("input")

        # 1. Validate payload presence
        if not task_id or not operation or input_data is None:
            logger.error(
                f"Malformed stream message {message_id}: missing taskId, operation, or input."
            )
            self.redis.send_to_dead_letter(
                self.config.DEAD_LETTER_STREAM,
                message_id,
                fields,
                "Malformed message fields",
            )
            self.redis.acknowledge_message(
                self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
            )
            return

        # Validate task ID format
        if not parse_object_id(task_id):
            logger.error(f"Invalid ObjectId format for task {task_id} in message {message_id}")
            self.redis.send_to_dead_letter(
                self.config.DEAD_LETTER_STREAM,
                message_id,
                fields,
                "Invalid taskId ObjectId format",
            )
            self.redis.acknowledge_message(
                self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
            )
            return

        # 2. Inspect delivery count for retry exhaustion
        delivery_count = self.redis.get_delivery_count(
            self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
        )
        if delivery_count > self.config.MAX_RETRIES:
            logger.error(
                f"Task {task_id} exceeded max retries ({delivery_count} > {self.config.MAX_RETRIES}). "
                f"Evaluating dead-letter routing..."
            )
            task = self.db.get_task(task_id)
            if not task:
                logger.warning(
                    f"Task {task_id} not found in MongoDB during retry exhaustion. "
                    f"Routing to dead-letter stream and acknowledging."
                )
                self.redis.send_to_dead_letter(
                    self.config.DEAD_LETTER_STREAM,
                    message_id,
                    fields,
                    f"Task not found in MongoDB (retries: {delivery_count})",
                )
                self.redis.acknowledge_message(
                    self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
                )
                return

            current_status = task.get("status")

            # Do not overwrite completed or cancelled tasks
            if current_status in ("completed", "cancelled"):
                logger.info(
                    f"Task {task_id} is already in terminal/cancelled state '{current_status}'. "
                    f"Acknowledging without duplicate dead-letter routing."
                )
                self.redis.acknowledge_message(
                    self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
                )
                return

            if current_status == "failed":
                # Already marked failed; route to DLQ (idempotent) and acknowledge
                logger.info(
                    f"Task {task_id} is already in state 'failed'. "
                    f"Ensuring routed to dead-letter stream and acknowledging."
                )
                self.redis.send_to_dead_letter(
                    self.config.DEAD_LETTER_STREAM,
                    message_id,
                    fields,
                    f"Exceeded max retries ({delivery_count})",
                )
                self.redis.acknowledge_message(
                    self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
                )
                return

            # Atomically mark failed only if pending or expired lease
            updated = self.db.record_dead_letter(
                task_id, f"Exceeded maximum delivery attempts ({delivery_count})"
            )
            if updated:
                logger.info(f"Task {task_id} marked as failed via dead-letter.")
                self.redis.send_to_dead_letter(
                    self.config.DEAD_LETTER_STREAM,
                    message_id,
                    fields,
                    f"Exceeded max retries ({delivery_count})",
                )
                self.redis.acknowledge_message(
                    self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
                )
            else:
                # The atomic update matched 0 documents.
                # Explicitly investigate why by re-fetching the fresh task state:
                fresh_task = self.db.get_task(task_id)
                if not fresh_task:
                    logger.warning(
                        f"Task {task_id} was deleted between inspection and dead-letter update. "
                        f"Acknowledging message {message_id}."
                    )
                    self.redis.acknowledge_message(
                        self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
                    )
                elif fresh_task.get("status") in ("completed", "cancelled"):
                    logger.info(
                        f"Task {task_id} transitioned to '{fresh_task.get('status')}' between inspection and dead-letter update. "
                        f"Acknowledging message {message_id} without dead-letter routing."
                    )
                    self.redis.acknowledge_message(
                        self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
                    )
                elif fresh_task.get("status") == "failed":
                    logger.info(
                        f"Task {task_id} was marked failed by another process between inspection and update. "
                        f"Routing to DLQ idempotently and acknowledging."
                    )
                    self.redis.send_to_dead_letter(
                        self.config.DEAD_LETTER_STREAM,
                        message_id,
                        fields,
                        f"Exceeded max retries ({delivery_count})",
                    )
                    self.redis.acknowledge_message(
                        self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
                    )
                else:
                    # Actively leased by another worker (status == "processing" with active lease);
                    # MUST NOT publish to DLQ, MUST NOT ACK, and allows active worker to finish!
                    logger.warning(
                        f"Task {task_id} is actively leased by another worker. "
                        f"Deferring dead-letter handling; leaving message unacknowledged."
                    )
            return

        # 3. Read current task from MongoDB
        task = self.db.get_task(task_id)
        if not task:
            logger.warning(f"Task {task_id} not found in MongoDB. Acknowledging and discarding.")
            self.redis.acknowledge_message(
                self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
            )
            return

        current_status = task.get("status")

        # 4. Skip and acknowledge terminal or cancelled tasks (Idempotency guarantee)
        if current_status in ("completed", "failed", "cancelled"):
            logger.info(
                f"Task {task_id} is already in terminal/cancelled state '{current_status}'. "
                f"Acknowledging message {message_id} without re-processing."
            )
            self.redis.acknowledge_message(
                self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
            )
            return

        # 5. Acquire task lease atomically (prevents concurrent duplicate execution)
        worker_id = self.config.REDIS_CONSUMER_NAME
        leased_task, lease_token = self.db.acquire_task_lease(
            task_id, worker_id, self.config.PROCESSING_LEASE_SECONDS
        )
        if not leased_task or not lease_token:
            logger.info(
                f"Task {task_id} could not be acquired (actively leased by another worker or completed). "
                f"Skipping execution for this turn."
            )
            return

        logger.info(
            f"Acquired lease on task {task_id} for worker '{worker_id}'. "
            f"Executing operation '{operation}'..."
        )

        # 6. Execute operation via pure functional engine
        try:
            result_str = execute_operation(operation, input_data)
        except Exception as e:
            error_message = f"{type(e).__name__}: {str(e)}"
            logger.error(f"Task {task_id} execution failed: {error_message}")

            # Persist failure conditioned on current worker ownership AND valid lease token
            saved = self.db.fail_task(task_id, worker_id, lease_token, error_message)
            if saved:
                logger.info(f"Task {task_id} marked as failed in MongoDB.")
                # STRICT RULE: Acknowledge only after persistence succeeds
                self.redis.acknowledge_message(
                    self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
                )
            else:
                logger.warning(
                    f"Worker '{worker_id}' lost ownership of task {task_id} before recording failure. "
                    f"Skipping XACK."
                )
            return

        # 7. Persist successful completion conditioned on current worker ownership AND valid lease token
        saved = self.db.complete_task(task_id, worker_id, lease_token, result_str)
        if saved:
            logger.info(
                f"Task {task_id} completed successfully. Persisted result to MongoDB."
            )
            # STRICT RULE: Acknowledge only after persistence succeeds
            self.redis.acknowledge_message(
                self.config.REDIS_STREAM, self.config.REDIS_CONSUMER_GROUP, message_id
            )
        else:
            logger.warning(
                f"Worker '{worker_id}' lost ownership of task {task_id} before completing. "
                f"Skipping XACK."
            )

    def run(self):
        """Main event-driven consumer polling loop."""
        logger.info("Worker started. Listening for tasks...")

        last_claim_time = 0.0

        while self.running:
            try:
                now = time.time()
                # Periodically reclaim abandoned messages from crashed workers using configured interval
                if now - last_claim_time >= self.config.RECOVERY_POLLING_INTERVAL_SECONDS:
                    last_claim_time = now
                    abandoned = self.redis.claim_abandoned_messages(
                        self.config.REDIS_STREAM,
                        self.config.REDIS_CONSUMER_GROUP,
                        self.config.REDIS_CONSUMER_NAME,
                        min_idle_ms=self.config.AUTOCLAIM_MIN_IDLE_MS,
                        count=self.config.REDIS_BATCH_SIZE,
                    )
                    if abandoned:
                        logger.info(f"Reclaimed {len(abandoned)} abandoned message(s).")
                        for msg_id, fields in abandoned:
                            if not self.running:
                                break
                            self.process_message(msg_id, fields)

                # Poll for new messages using XREADGROUP
                messages = self.redis.read_new_messages(
                    self.config.REDIS_STREAM,
                    self.config.REDIS_CONSUMER_GROUP,
                    self.config.REDIS_CONSUMER_NAME,
                    count=self.config.REDIS_BATCH_SIZE,
                    block_ms=self.config.REDIS_BLOCK_MS,
                )

                for msg_id, fields in messages:
                    if not self.running:
                        break
                    self.process_message(msg_id, fields)

            except Exception as e:
                if self.running:
                    logger.error(f"Unexpected error in consumer loop: {e}", exc_info=True)
                    time.sleep(1.0)

        logger.info("Exiting consumer loop...")
        self.cleanup()

    def cleanup(self):
        """Cleans up database and Redis connections on shutdown."""
        logger.info("Closing connections...")
        self.redis.close()
        self.db.close()
        logger.info("Worker shutdown complete.")


def main():
    config = Config()

    worker = Worker(config)
    signal.signal(signal.SIGINT, worker.handle_signal)
    signal.signal(signal.SIGTERM, worker.handle_signal)

    try:
        worker.setup()
        worker.run()
    except Exception as e:
        logger.error(f"Fatal worker startup error: {e}")
        worker.cleanup()
        sys.exit(1)


if __name__ == "__main__":
    main()
