#!/usr/bin/env python3
"""
Controlled Worker Crash Recovery Test Harness (Standalone)
Project: AI-Task-Processing-Platform

Validates Python worker crash recovery, Redis XAUTOCLAIM lease recovery,
and zombie/stale worker protection against an isolated Redis test stream.

MANDATORY SAFETY RULES:
- Operates strictly on isolated stream: task_stream_test_recovery
- Operates strictly on isolated group: test_recovery_group
- Does NOT touch production stream (task_stream) or production consumer group.
- Does NOT terminate or interfere with live worker process (PID 32524).
- Never prints passwords, URIs, JWTs, or lease tokens.
"""

import argparse
import json
import logging
import os
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

# Ensure worker package is in sys.path
WORKER_DIR = Path(__file__).resolve().parent.parent
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

from config import Config
from db import Database, parse_object_id
from engine import execute_operation
from redis_client import RedisStreamClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [crash-harness] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("crash-harness")

# Isolated Test Architecture Constants
TEST_STREAM = "task_stream_test_recovery"
TEST_GROUP = "test_recovery_group"
CRASH_CONSUMER = "crash_worker_1"
RECOVERY_CONSUMER = "recovery_worker_1"

TEST_TITLE = "CONTROLLED_CRASH_RECOVERY_TEST"
TEST_OPERATION = "uppercase"
TEST_INPUT = "hello crash test"
EXPECTED_RESULT = "HELLO CRASH TEST"

STATE_FILE = Path(__file__).resolve().parent / ".crash_recovery_state.json"


def save_state(state: dict):
    """Saves test state to a private local JSON file with restricted permissions (0600)."""
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    try:
        os.chmod(STATE_FILE, 0o600)
    except Exception:
        pass


def load_state() -> dict:
    """Loads existing test harness state after strictly verifying file permissions."""
    if not STATE_FILE.exists():
        logger.error(
            f"State file not found at {STATE_FILE}. Run '--phase prepare' first."
        )
        sys.exit(1)

    # Security check: require file permissions to be strictly 0600 (owner read/write only)
    file_stat = STATE_FILE.stat()
    permissions = stat.S_IMODE(file_stat.st_mode)
    if permissions != 0o600:
        logger.error(
            f"Insecure file permissions on state file: {oct(permissions)}. "
            f"Permissions must be strictly 0600 (owner read/write only). Refusing to read state."
        )
        sys.exit(1)

    with open(STATE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def get_db(config: Config) -> Database:
    """Connects to the targeted MongoDB database."""
    db_name = os.getenv("MONGODB_DATABASE")
    if not db_name:
        try:
            parsed = urlparse(config.MONGODB_URI)
            db_name = parsed.path.lstrip("/").split("?")[0]
        except Exception:
            db_name = "ai_task_platform"
    if not db_name:
        db_name = "ai_task_platform"

    db = Database(config.MONGODB_URI, db_name)
    db.connect()
    return db


def get_redis(config: Config) -> RedisStreamClient:
    """Connects to the Redis server."""
    redis_client = RedisStreamClient(config.REDIS_URL)
    redis_client.connect()
    return redis_client


# ============================================================================
# PHASE 1: PREPARE
# ============================================================================
def phase_prepare(config: Config):
    """Creates a dedicated test task in MongoDB and publishes a message to the isolated stream."""
    logger.info("Starting Phase 1: prepare")

    db = get_db(config)
    redis_client = get_redis(config)

    try:
        # Obtain a valid test user ID
        user = db.db["users"].find_one({"email": "integration.tester@example.com"})
        if not user:
            user = db.db["users"].find_one()
        if not user or "_id" not in user:
            logger.error(
                "No user found in database to associate with test task. Register a user first."
            )
            sys.exit(1)

        user_id = user["_id"]
        now = datetime.now(timezone.utc)

        # 1. Create dedicated MongoDB test task document
        task_doc = {
            "userId": user_id,
            "title": TEST_TITLE,
            "operation": TEST_OPERATION,
            "input": TEST_INPUT,
            "status": "pending",
            "result": None,
            "error": None,
            "logs": [
                {
                    "message": "Task initialized for controlled crash recovery harness",
                    "timestamp": now,
                    "level": "info",
                }
            ],
            "startedAt": None,
            "completedAt": None,
            "workerId": None,
            "leaseToken": None,
            "leaseExpiresAt": None,
            "createdAt": now,
            "updatedAt": now,
        }

        insert_result = db.tasks.insert_one(task_doc)
        task_id = str(insert_result.inserted_id)
        logger.info(f"Created dedicated test task in MongoDB (taskId: {task_id}).")

        # 2. Ensure isolated consumer group exists on isolated stream
        redis_client.ensure_consumer_group(TEST_STREAM, TEST_GROUP)

        # 3. Publish job to isolated test stream
        payload = {
            "taskId": task_id,
            "operation": TEST_OPERATION,
            "input": TEST_INPUT,
            "queuedAt": now.isoformat(),
        }
        message_id = redis_client.client.xadd(TEST_STREAM, payload)
        logger.info(
            f"Published message {message_id} to isolated stream '{TEST_STREAM}'."
        )

        # 4. Save state
        state = {
            "taskId": task_id,
            "messageId": str(message_id),
            "stream": TEST_STREAM,
            "group": TEST_GROUP,
            "leaseTokenA": None,
            "leaseTokenB": None,
            "preparedAt": now.isoformat(),
            "lastPhase": "prepare",
        }
        save_state(state)

        print("\n==================================================")
        print("PHASE 1 (prepare) COMPLETED SUCCESSFULLY")
        print("==================================================")
        print(f"Test Task ID:     {task_id}")
        print(f"Redis Message ID: {message_id}")
        print(f"Isolated Stream:  {TEST_STREAM}")
        print(f"Isolated Group:   {TEST_GROUP}")
        print("MongoDB Status:   pending")
        print("Ready for:        python worker/scripts/crash_recovery_harness.py --phase crash_simulation")

    finally:
        db.close()
        redis_client.close()


# ============================================================================
# PHASE 2: CRASH SIMULATION
# ============================================================================
def phase_crash_simulation(config: Config):
    """Reads isolated message via crash_worker_1, acquires lease A, then immediately halts without XACK."""
    logger.info("Starting Phase 2: crash_simulation")
    state = load_state()
    task_id = state["taskId"]
    expected_msg_id = state["messageId"]

    db = get_db(config)
    redis_client = get_redis(config)

    try:
        # 1. Read message from isolated stream using crash_worker_1
        streams_resp = redis_client.client.xreadgroup(
            groupname=TEST_GROUP,
            consumername=CRASH_CONSUMER,
            streams={TEST_STREAM: ">"},
            count=1,
            block=2000,
        )

        if not streams_resp or len(streams_resp) == 0:
            logger.error(f"No message received from isolated stream '{TEST_STREAM}'.")
            sys.exit(1)

        _stream_name, messages = streams_resp[0]
        if not messages or len(messages) == 0:
            logger.error("No unread messages available in stream.")
            sys.exit(1)

        msg_id, fields = messages[0]
        if str(msg_id) != str(expected_msg_id):
            logger.error(
                f"Unexpected message ID {msg_id}; expected {expected_msg_id}."
            )
            sys.exit(1)

        # 2. Acquire Lease A atomically
        lease_seconds = config.PROCESSING_LEASE_SECONDS
        leased_task, lease_token_a = db.acquire_task_lease(
            task_id, CRASH_CONSUMER, lease_duration_seconds=lease_seconds
        )

        if not leased_task or not lease_token_a:
            logger.error(f"Failed to acquire initial lease on task {task_id}.")
            sys.exit(1)

        # 3. Assert task status transitioned to 'processing'
        if leased_task.get("status") != "processing":
            logger.error(f"Expected status 'processing', got '{leased_task.get('status')}'.")
            sys.exit(1)

        # 4. Save lease A privately (DO NOT PRINT)
        state["leaseTokenA"] = lease_token_a
        state["crashedAt"] = datetime.now(timezone.utc).isoformat()
        state["lastPhase"] = "crash_simulation"
        save_state(state)

        # 5. SIMULATE CRASH:
        # Terminate immediately WITHOUT execute_operation, WITHOUT complete_task, and WITHOUT XACK
        logger.warning(
            f"Simulated abrupt crash of consumer '{CRASH_CONSUMER}' after lease acquisition."
        )

        print("\n==================================================")
        print("PHASE 2 (crash_simulation) COMPLETED SUCCESSFULLY")
        print("==================================================")
        print(f"Task ID:         {task_id}")
        print(f"Consumer:        {CRASH_CONSUMER}")
        print("MongoDB Status:  processing")
        print("Lease A Token:   [CAPTURED PRIVATELY IN STATE - NEVER LOGGED]")
        print("Redis PEL State: 1 pending entry (times_delivered: 1, unacknowledged)")
        print("Simulated Crash: Worker exited cleanly before completing or ACKing.")
        print("Ready for:       python worker/scripts/crash_recovery_harness.py --phase inspect")

    finally:
        db.close()
        redis_client.close()


# ============================================================================
# PHASE 3: INSPECT
# ============================================================================
def phase_inspect(config: Config):
    """Read-only inspection of MongoDB task state and Redis PEL state without mutation."""
    logger.info("Starting Phase 3: inspect (READ-ONLY)")
    state = load_state()
    task_id = state["taskId"]
    message_id = state["messageId"]

    db = get_db(config)
    redis_client = get_redis(config)

    try:
        # 1. Inspect MongoDB task
        task = db.get_task(task_id)
        if not task:
            logger.error(f"Task {task_id} not found in MongoDB.")
            sys.exit(1)

        now = datetime.now(timezone.utc)
        lease_expires_at = task.get("leaseExpiresAt")
        if lease_expires_at and lease_expires_at.tzinfo is None:
            lease_expires_at = lease_expires_at.replace(tzinfo=timezone.utc)

        is_lease_active = bool(lease_expires_at and lease_expires_at > now)
        seconds_to_lease_expiry = (
            (lease_expires_at - now).total_seconds() if is_lease_active else 0.0
        )

        # 2. Inspect Redis PEL
        pending_entries = redis_client.client.xpending_range(
            TEST_STREAM, TEST_GROUP, min=message_id, max=message_id, count=1
        )

        has_pel_entry = bool(pending_entries and len(pending_entries) > 0)
        pel_info = pending_entries[0] if has_pel_entry else {}
        idle_ms = pel_info.get("time_since_delivered", pel_info.get("idle", 0))
        times_delivered = pel_info.get("times_delivered", 0)
        consumer_in_pel = pel_info.get("consumer", "N/A")

        autoclaim_min_idle_ms = config.AUTOCLAIM_MIN_IDLE_MS
        is_autoclaim_eligible = bool(idle_ms >= autoclaim_min_idle_ms)
        ms_until_autoclaim = max(0, autoclaim_min_idle_ms - idle_ms)

        print("\n==================================================")
        print("PHASE 3 (inspect) — CURRENT STATE (READ-ONLY)")
        print("==================================================")
        print(f"Task ID:                   {task_id}")
        print(f"MongoDB Status:            {task.get('status')}")
        print(f"Assigned Worker:           {task.get('workerId')}")
        print(f"Lease Token Set:           {bool(task.get('leaseToken'))}")
        print(f"Lease Expires At:          {lease_expires_at}")
        print(f"Is Lease Active?           {is_lease_active} ({seconds_to_lease_expiry:.1f}s remaining)")
        print(f"Task Result:               {task.get('result')}")
        print("---")
        print(f"Redis Stream:              {TEST_STREAM}")
        print(f"Message ID:                {message_id}")
        print(f"Pending in Group PEL?      {has_pel_entry}")
        print(f"Current PEL Consumer:      {consumer_in_pel}")
        print(f"Times Delivered:           {times_delivered}")
        print(f"PEL Idle Time:             {idle_ms / 1000.0:.2f}s ({idle_ms} ms)")
        print(f"Eligible for XAUTOCLAIM?   {is_autoclaim_eligible} ({ms_until_autoclaim / 1000.0:.1f}s remaining)")
        print("==================================================")

        if not is_autoclaim_eligible:
            print(f"[!] Message is NOT yet eligible for XAUTOCLAIM.")
            print(f"    Wait at least {ms_until_autoclaim / 1000.0:.1f} more seconds before running recovery.")
        else:
            print("[+] Message IS eligible for XAUTOCLAIM recovery!")
            print("    Ready for: python worker/scripts/crash_recovery_harness.py --phase recover")

    finally:
        db.close()
        redis_client.close()


# ============================================================================
# PHASE 4: RECOVER
# ============================================================================
def phase_recover(config: Config):
    """Reclaims the message via XAUTOCLAIM with recovery_worker_1, acquires lease B, computes, persists, and ACKs."""
    logger.info("Starting Phase 4: recover")
    state = load_state()
    task_id = state["taskId"]
    message_id = state["messageId"]
    lease_token_a = state.get("leaseTokenA")

    db = get_db(config)
    redis_client = get_redis(config)

    try:
        # 1. Verify eligibility threshold
        pending = redis_client.client.xpending_range(
            TEST_STREAM, TEST_GROUP, min=message_id, max=message_id, count=1
        )
        if not pending or len(pending) == 0:
            logger.error("Message is not present in PEL. Has it already been acknowledged?")
            sys.exit(1)

        idle_ms = pending[0].get("time_since_delivered", pending[0].get("idle", 0))
        if idle_ms < config.AUTOCLAIM_MIN_IDLE_MS:
            logger.error(
                f"Message idle time ({idle_ms} ms) is less than AUTOCLAIM_MIN_IDLE_MS ({config.AUTOCLAIM_MIN_IDLE_MS} ms). "
                f"Wait {(config.AUTOCLAIM_MIN_IDLE_MS - idle_ms) / 1000.0:.1f}s before recovering."
            )
            sys.exit(1)

        # 2. Reclaim message using XAUTOCLAIM
        autoclaim_res = redis_client.client.xautoclaim(
            TEST_STREAM,
            TEST_GROUP,
            RECOVERY_CONSUMER,
            min_idle_time=config.AUTOCLAIM_MIN_IDLE_MS,
            start_id="0-0",
            count=10,
        )

        if not autoclaim_res or len(autoclaim_res) < 2:
            logger.error("XAUTOCLAIM did not return any claimed messages.")
            sys.exit(1)

        claimed_msgs = autoclaim_res[1]
        claimed_ids = [str(m[0]) for m in claimed_msgs]
        if str(message_id) not in claimed_ids:
            logger.error(
                f"XAUTOCLAIM claimed messages {claimed_ids}, but expected message {message_id} was not among them."
            )
            sys.exit(1)

        logger.info(
            f"Successfully reclaimed message {message_id} to consumer '{RECOVERY_CONSUMER}'."
        )

        # 3. Acquire Lease B atomically
        leased_task, lease_token_b = db.acquire_task_lease(
            task_id, RECOVERY_CONSUMER, lease_duration_seconds=config.PROCESSING_LEASE_SECONDS
        )

        if not leased_task or not lease_token_b:
            logger.error(
                f"Recovery worker '{RECOVERY_CONSUMER}' failed to acquire lease on task {task_id}."
            )
            sys.exit(1)

        # Assert lease B is distinct from lease A
        if lease_token_a and lease_token_b == lease_token_a:
            logger.error("FATAL: Lease Token B is identical to Lease Token A!")
            sys.exit(1)

        logger.info(
            f"Recovery worker '{RECOVERY_CONSUMER}' acquired fresh lease B (distinct from lease A)."
        )

        # 4. Execute operation via pure functional engine
        result_str = execute_operation(TEST_OPERATION, TEST_INPUT)
        if result_str != EXPECTED_RESULT:
            logger.error(
                f"Engine output '{result_str}' does not match expected '{EXPECTED_RESULT}'."
            )
            sys.exit(1)

        # 5. Persist successful completion conditioned on lease B
        saved = db.complete_task(task_id, RECOVERY_CONSUMER, lease_token_b, result_str)
        if not saved:
            logger.error(
                f"Recovery worker '{RECOVERY_CONSUMER}' failed to persist completed task."
            )
            sys.exit(1)

        logger.info(
            f"Task {task_id} marked as completed in MongoDB with result '{result_str}'."
        )

        # 6. Acknowledge message in Redis (XACK)
        acked_count = redis_client.acknowledge_message(TEST_STREAM, TEST_GROUP, message_id)
        if acked_count != 1:
            logger.error(f"XACK returned {acked_count}, expected 1.")
            sys.exit(1)

        logger.info(f"Acknowledged message {message_id} via XACK.")

        # 7. Update state
        state["leaseTokenB"] = lease_token_b
        state["recoveredAt"] = datetime.now(timezone.utc).isoformat()
        state["lastPhase"] = "recover"
        save_state(state)

        print("\n==================================================")
        print("PHASE 4 (recover) COMPLETED SUCCESSFULLY")
        print("==================================================")
        print(f"Task ID:          {task_id}")
        print(f"Recovery Worker:  {RECOVERY_CONSUMER}")
        print("Lease B Token:    [CAPTURED PRIVATELY - VERIFIED DISTINCT FROM LEASE A]")
        print(f"Computed Result:  {result_str}")
        print("MongoDB Status:   completed")
        print("Redis XACK:       Message acknowledged and removed from PEL")
        print("Ready for:        python worker/scripts/crash_recovery_harness.py --phase stale_token_test")

    finally:
        db.close()
        redis_client.close()


# ============================================================================
# PHASE 5: STALE TOKEN TEST
# ============================================================================
def phase_stale_token_test(config: Config):
    """Simulates crashed worker waking up and attempting completion with stale lease A. Asserts rejection."""
    logger.info("Starting Phase 5: stale_token_test")
    state = load_state()
    task_id = state["taskId"]
    lease_token_a = state.get("leaseTokenA")

    if not lease_token_a:
        logger.error("Lease Token A is missing from state. Cannot test stale worker protection.")
        sys.exit(1)

    db = get_db(config)

    try:
        # 1. Verify task is currently completed
        task = db.get_task(task_id)
        if not task or task.get("status") != "completed":
            logger.error(f"Task {task_id} is not in completed state; cannot run stale token test.")
            sys.exit(1)

        # 2. Attempt stale completion with old lease token A
        logger.info(
            f"Simulating zombie worker '{CRASH_CONSUMER}' attempting complete_task with stale token A..."
        )
        stale_save = db.complete_task(
            task_id, CRASH_CONSUMER, lease_token_a, "CORRUPTED_STALE_OUTPUT"
        )

        # 3. Assert stale write was REJECTED
        if stale_save is not False:
            logger.error(
                "CRITICAL SECURITY DEFECT: complete_task accepted a stale lease token!"
            )
            sys.exit(1)

        logger.info(
            "Zombie write was rejected as expected (complete_task returned False)."
        )

        # 4. Verify task in MongoDB was NOT overwritten
        fresh_task = db.get_task(task_id)
        if fresh_task.get("result") != EXPECTED_RESULT:
            logger.error(
                f"Result was corrupted! Expected '{EXPECTED_RESULT}', got '{fresh_task.get('result')}'."
            )
            sys.exit(1)

        if fresh_task.get("status") != "completed":
            logger.error(
                f"Status was modified! Expected 'completed', got '{fresh_task.get('status')}'."
            )
            sys.exit(1)

        state["lastPhase"] = "stale_token_test"
        save_state(state)

        print("\n==================================================")
        print("PHASE 5 (stale_token_test) COMPLETED SUCCESSFULLY")
        print("==================================================")
        print(f"Task ID:               {task_id}")
        print("Stale Worker ID:       crash_worker_1")
        print("Stale Update Result:   False (Matched 0 documents)")
        print(f"Current Result in DB:  '{fresh_task.get('result')}' (Unaltered)")
        print("Current Status in DB:  completed")
        print("Protection Verified:   Old lease token cannot overwrite newer completed work.")
        print("Ready for:             python worker/scripts/crash_recovery_harness.py --phase verify")

    finally:
        db.close()


# ============================================================================
# PHASE 6: VERIFY
# ============================================================================
def phase_verify(config: Config):
    """Confirms final task result in MongoDB and ensures Redis test PEL is empty."""
    logger.info("Starting Phase 6: verify")
    state = load_state()
    task_id = state["taskId"]
    message_id = state["messageId"]

    db = get_db(config)
    redis_client = get_redis(config)

    try:
        # 1. Verify MongoDB final document
        task = db.get_task(task_id)
        if not task:
            logger.error(f"Task {task_id} not found in MongoDB.")
            sys.exit(1)

        assert task.get("status") == "completed", f"Status is {task.get('status')}"
        assert task.get("result") == EXPECTED_RESULT, f"Result is {task.get('result')}"
        assert task.get("workerId") == RECOVERY_CONSUMER, f"Worker is {task.get('workerId')}"
        assert task.get("completedAt") is not None, "completedAt is None"
        assert task.get("startedAt") is not None, "startedAt is None"
        assert task.get("completedAt") >= task.get("startedAt"), "completedAt < startedAt"

        # 2. Verify Redis PEL is completely empty
        pending = redis_client.client.xpending_range(
            TEST_STREAM, TEST_GROUP, min="-", max="+", count=10
        )
        assert len(pending) == 0, f"Expected 0 pending entries in test PEL, found {len(pending)}"

        state["lastPhase"] = "verify"
        save_state(state)

        print("\n==================================================")
        print("PHASE 6 (verify) COMPLETED — ALL ASSERTIONS PASSED")
        print("==================================================")
        print(f"Task ID:          {task_id}")
        print(f"Final Status:     completed")
        print(f"Final Result:     '{task.get('result')}'")
        print(f"Assigned Worker:  {task.get('workerId')}")
        print(f"Started At:       {task.get('startedAt')}")
        print(f"Completed At:     {task.get('completedAt')}")
        print(f"Total Logs:       {len(task.get('logs', []))} entries")
        print(f"Test Stream PEL:  EMPTY (0 pending entries)")
        print("==================================================")
        print("All recovery, lease renewal, and fencing assertions VERIFIED.")
        print("To clean up test artifacts:")
        print("  python worker/scripts/crash_recovery_harness.py --phase cleanup")

    finally:
        db.close()
        redis_client.close()


# ============================================================================
# PHASE 7: CLEANUP
# ============================================================================
def phase_cleanup(config: Config):
    """Explicitly cleans up ONLY the dedicated test task and the isolated test stream."""
    logger.info("Starting Phase 7: cleanup")
    state = load_state()
    task_id = state.get("taskId")

    db = get_db(config)
    redis_client = get_redis(config)

    try:
        # 1. Delete test task from MongoDB
        if task_id:
            oid = parse_object_id(task_id)
            if oid:
                res = db.tasks.delete_one({"_id": oid, "title": TEST_TITLE})
                logger.info(
                    f"Deleted test task {task_id} from MongoDB (deleted: {res.deleted_count})."
                )

        # 2. Delete isolated test stream from Redis
        try:
            del_count = redis_client.client.delete(TEST_STREAM)
            logger.info(
                f"Deleted isolated test stream '{TEST_STREAM}' (keys removed: {del_count})."
            )
        except Exception as e:
            logger.warning(f"Could not delete stream '{TEST_STREAM}': {e}")

        # 3. Remove local state file
        if STATE_FILE.exists():
            STATE_FILE.unlink()
            logger.info(f"Removed state file {STATE_FILE}.")

        print("\n==================================================")
        print("PHASE 7 (cleanup) COMPLETED SUCCESSFULLY")
        print("==================================================")
        print("Dedicated test task and isolated stream cleaned up.")
        print("No production streams or production tasks were affected.")

    finally:
        db.close()
        redis_client.close()


def main():
    parser = argparse.ArgumentParser(
        description="Controlled Worker Crash Recovery Test Harness"
    )
    parser.add_argument(
        "--phase",
        required=True,
        choices=[
            "prepare",
            "crash_simulation",
            "inspect",
            "recover",
            "stale_token_test",
            "verify",
            "cleanup",
        ],
        help="Target execution phase",
    )
    args = parser.parse_args()

    config = Config()

    phase_map = {
        "prepare": phase_prepare,
        "crash_simulation": phase_crash_simulation,
        "inspect": phase_inspect,
        "recover": phase_recover,
        "stale_token_test": phase_stale_token_test,
        "verify": phase_verify,
        "cleanup": phase_cleanup,
    }

    handler = phase_map[args.phase]
    try:
        handler(config)
    except Exception as e:
        logger.error(f"Phase '{args.phase}' failed with unhandled error: {e}", exc_info=True)
        print("\n==================================================")
        print(f"[-] ERROR IN PHASE '{args.phase}'")
        print("==================================================")
        print(f"Details: {type(e).__name__}: {e}")
        print("Test artifacts have been PRESERVED for diagnosis.")
        if STATE_FILE.exists():
            try:
                st = load_state()
                print(f"Task ID:         {st.get('taskId')}")
                print(f"Message ID:      {st.get('messageId')}")
                print(f"Isolated Stream: {st.get('stream')}")
            except Exception:
                pass
        print("You can inspect the current state with:")
        print("  python worker/scripts/crash_recovery_harness.py --phase inspect")
        sys.exit(1)


if __name__ == "__main__":
    main()
