"""Redis Streams client wrapper supporting consumer groups and message recovery."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("worker.redis")

try:
    import redis
    from redis.exceptions import ConnectionError, RedisError, ResponseError
except ImportError:
    redis = None  # type: ignore
    ConnectionError = Exception  # type: ignore
    RedisError = Exception  # type: ignore
    ResponseError = Exception  # type: ignore


class RedisStreamClient:
    """Manages Redis connection, consumer groups, XREADGROUP, and XAUTOCLAIM."""

    def __init__(self, url: str):
        self.url = url
        self.client: Optional[Any] = None

    def connect(self):
        """Initializes connection to Redis server with auto-decoding."""
        if redis is None:
            raise RuntimeError(
                "redis is not installed. Please install dependencies from worker/requirements.txt."
            )
        self.client = redis.from_url(
            self.url,
            decode_responses=True,
            socket_timeout=10,
            socket_connect_timeout=5,
        )
        self.ping()

    def ping(self):
        """Verifies Redis server responds to PING."""
        if self.client:
            self.client.ping()

    def close(self):
        """Closes Redis connection pool."""
        if self.client:
            self.client.close()
            self.client = None

    def ensure_consumer_group(self, stream: str, group: str):
        """Ensures the specified consumer group exists, creating it with MKSTREAM if necessary.

        Handles BUSYGROUP gracefully without error.
        """
        if not self.client:
            raise RuntimeError("Redis client is not connected.")

        try:
            # ID '0' allows the group to process all historical messages if desired
            self.client.xgroup_create(stream, group, id="0", mkstream=True)
            logger.info(f"Created consumer group '{group}' on stream '{stream}'.")
        except ResponseError as e:
            if "BUSYGROUP" in str(e):
                logger.info(f"Consumer group '{group}' already exists on '{stream}'.")
            else:
                logger.error(f"Error creating consumer group: {e}")
                raise

    def read_new_messages(
        self, stream: str, group: str, consumer_name: str, count: int = 10, block_ms: int = 2000
    ) -> List[Tuple[str, Dict[str, str]]]:
        """Reads unassigned messages using XREADGROUP with ID '>'."""
        if not self.client:
            raise RuntimeError("Redis client is not connected.")

        try:
            streams_response = self.client.xreadgroup(
                group, consumer_name, {stream: ">"}, count=count, block=block_ms
            )
        except ConnectionError as e:
            logger.error(f"Redis connection error during XREADGROUP: {e}")
            raise

        if not streams_response:
            return []

        # streams_response format: [[stream_name, [(msg_id, fields_dict), ...]]]
        messages: List[Tuple[str, Dict[str, str]]] = []
        for _stream_name, stream_msgs in streams_response:
            for msg_id, fields in stream_msgs:
                messages.append((msg_id, fields))
        return messages

    def claim_abandoned_messages(
        self, stream: str, group: str, consumer_name: str, min_idle_ms: int = 30000, count: int = 10
    ) -> List[Tuple[str, Dict[str, str]]]:
        """Recovers abandoned messages from crashed workers using XAUTOCLAIM."""
        if not self.client:
            raise RuntimeError("Redis client is not connected.")

        try:
            # XAUTOCLAIM stream group consumer min-idle-time start-id [COUNT count]
            # Returns: (next_start_id, [(msg_id, fields), ...], [deleted_ids])
            result = self.client.xautoclaim(
                stream, group, consumer_name, min_idle_time=min_idle_ms, start_id="0-0", count=count
            )
            if not result or len(result) < 2:
                return []
            claimed_messages = result[1]
            return [(msg_id, fields) for msg_id, fields in claimed_messages if fields]
        except ResponseError as e:
            logger.warning(f"XAUTOCLAIM error: {e}")
            return []

    def get_delivery_count(self, stream: str, group: str, message_id: str) -> int:
        """Inspects delivery attempts for a pending message using XPENDING."""
        if not self.client:
            return 1
        try:
            pending_entries = self.client.xpending_range(
                stream, group, min=message_id, max=message_id, count=1
            )
            if pending_entries and len(pending_entries) > 0:
                # pending entry format: {'message_id': ..., 'consumer': ..., 'idle': ..., 'times_delivered': int}
                return pending_entries[0].get("times_delivered", 1)
        except Exception as e:
            logger.warning(f"Could not retrieve delivery count for {message_id}: {e}")
        return 1

    # Atomic Lua script for DLQ deduplication:
    # 1. Checks if dlq:sent:<original_msg_id> already contains the DLQ stream message ID.
    # 2. If present, returns {existing_id, 1} to indicate duplicate; skips XADD.
    # 3. If absent, executes XADD to the dead-letter stream.
    # 4. If XADD succeeds, saves the new message ID in dlq:sent:<original_msg_id> (EX 86400)
    #    and returns {new_id, 0}.
    # If XADD fails, the script halts before SET, preventing false deduplication on retry.
    DLQ_LUA_SCRIPT = """
local dedup_key = KEYS[1]
local stream_key = KEYS[2]
local existing = redis.call('GET', dedup_key)
if existing then
    return {existing, 1}
end
local msg_id = redis.call('XADD', stream_key, '*', unpack(ARGV))
redis.call('SET', dedup_key, msg_id, 'EX', 86400)
return {msg_id, 0}
"""

    def acknowledge_message(self, stream: str, group: str, message_id: str) -> int:
        """Acknowledges a processed message using XACK."""
        if not self.client:
            raise RuntimeError("Redis client is not connected.")
        return self.client.xack(stream, group, message_id)

    def send_to_dead_letter(
        self, dead_letter_stream: str, original_msg_id: str, payload: Dict[str, str], reason: str
    ) -> Optional[str]:
        """Transfers unprocessable or exhausted retry messages to dead letter stream idempotently.

        Uses an atomic Lua script on the Redis server:
        - If dlq:sent:<original_msg_id> exists, returns the existing DLQ message ID without duplicate XADD.
        - If absent, executes XADD and records the message ID in the dedup key atomically.
        - If XADD fails or raises an error, the dedup key is never created, ensuring subsequent
          retries are not blocked.
        """
        if not self.client:
            raise RuntimeError("Redis client is not connected.")

        dedup_key = f"dlq:sent:{original_msg_id}"
        dead_letter_payload = {
            **payload,
            "originalMessageId": str(original_msg_id),
            "deadLetterReason": str(reason),
            "deadLetterAt": datetime.now(timezone.utc).isoformat(),
        }

        argv = []
        for k, v in dead_letter_payload.items():
            argv.extend([str(k), str(v)])

        res = self.client.eval(self.DLQ_LUA_SCRIPT, 2, dedup_key, dead_letter_stream, *argv)

        if isinstance(res, (list, tuple)):
            raw_id = res[0]
            is_duplicate = bool(res[1] == 1)
        else:
            raw_id = res
            is_duplicate = False

        if isinstance(raw_id, bytes):
            msg_id = raw_id.decode("utf-8")
        else:
            msg_id = str(raw_id) if raw_id else None

        if is_duplicate:
            logger.info(
                f"Message {original_msg_id} was already published to dead-letter stream ({msg_id}); "
                f"skipped duplicate XADD."
            )
        else:
            logger.info(
                f"Message {original_msg_id} published to dead-letter stream with ID {msg_id}."
            )

        return msg_id
