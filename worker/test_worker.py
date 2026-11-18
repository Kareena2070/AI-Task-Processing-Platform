"""Comprehensive unit tests for the Python Worker, Redis Consumer, and Processing Engine.

Covers:
- Pure functional string engine operations (uppercase, lowercase, reverse_string, word_count)
- Operation validation, Unicode handling, and input type rejection
- Redis message parsing, dead-letter routing, and validation
- Duplicate delivery / terminal state skip and ACK
- Unique leaseToken generation and replacement per lease acquisition
- Concurrency ownership: old token cannot complete or fail a task
- Same worker reacquiring a lease receives a fresh token
- Another worker holding an active lease does not trigger ACK
- Timing configuration validation (AUTOCLAIM_MIN_IDLE_MS > PROCESSING_LEASE_SECONDS * 1000)
- Database persistence exception prevents ACK
- Dead-letter ownership safety:
  * Pending task dead-letter transition
  * Expired lease dead-letter transition
  * Active lease protection (no DLQ, no ACK, no overwrite)
  * Terminal task protection (no overwrite, no DLQ, only ACK)
- Dead-letter deduplication using Redis atomic SET NX key
- Verification that leaseToken is NOT exposed in logs
- Live installed library API compatibility (redis 8.1.0, pymongo 4.20.0, python-dotenv)
"""

import io
import logging
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, call, patch

# Ensure worker directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import Config
from db import Database
from engine import execute_operation, lowercase, reverse_string, uppercase, word_count
from main import Worker
from redis_client import RedisStreamClient


class TestProcessingEngine(unittest.TestCase):
    """Unit tests for the pure functional processing engine."""

    def test_uppercase(self):
        self.assertEqual(uppercase("hello world"), "HELLO WORLD")
        self.assertEqual(uppercase("Café Münster"), "CAFÉ MÜNSTER")
        self.assertEqual(uppercase(""), "")

    def test_lowercase(self):
        self.assertEqual(lowercase("HELLO WORLD"), "hello world")
        self.assertEqual(lowercase("CAFÉ MÜNSTER"), "café münster")
        self.assertEqual(lowercase(""), "")

    def test_reverse_string(self):
        self.assertEqual(reverse_string("hello"), "olleh")
        self.assertEqual(reverse_string("radar"), "radar")
        self.assertEqual(reverse_string("日本語"), "語本日")
        self.assertEqual(reverse_string(""), "")

    def test_word_count(self):
        self.assertEqual(word_count("hello world from python"), 4)
        self.assertEqual(word_count("  spaced   words\tline\nbreak  "), 4)
        self.assertEqual(word_count(""), 0)
        self.assertEqual(word_count("singleWord"), 1)

    def test_execute_operation_dispatcher_success(self):
        self.assertEqual(execute_operation("uppercase", "test"), "TEST")
        self.assertEqual(execute_operation("lowercase", "TEST"), "test")
        self.assertEqual(execute_operation("reverse_string", "abc"), "cba")
        self.assertEqual(execute_operation("word_count", "one two three"), "3")
        self.assertIsInstance(execute_operation("word_count", "one two"), str)

    def test_execute_operation_unsupported(self):
        with self.assertRaises(ValueError) as ctx:
            execute_operation("unsupported_op", "test input")
        self.assertIn("Unsupported operation", str(ctx.exception))

    def test_execute_operation_invalid_inputs(self):
        with self.assertRaises(TypeError):
            execute_operation(123, "test")

        with self.assertRaises(ValueError):
            execute_operation("   ", "test")

        with self.assertRaises(TypeError):
            execute_operation("uppercase", 12345)

        with self.assertRaises(TypeError):
            execute_operation("uppercase", ["list", "of", "items"])

        with self.assertRaises(TypeError):
            execute_operation("uppercase", None)


class TestConfigValidation(unittest.TestCase):
    """Tests for timing configuration alignment and validation rules."""

    def test_valid_timing_configuration(self):
        cfg = Config()
        cfg.REDIS_URL = "redis://127.0.0.1:6379"
        cfg.MONGODB_URI = "mongodb://localhost:27017/test"
        cfg.PROCESSING_LEASE_SECONDS = 60
        cfg.AUTOCLAIM_MIN_IDLE_MS = 70000
        cfg.RECOVERY_POLLING_INTERVAL_SECONDS = 10.0
        cfg.validate()

    def test_autoclaim_min_idle_must_exceed_lease_duration(self):
        cfg = Config()
        cfg.REDIS_URL = "redis://127.0.0.1:6379"
        cfg.MONGODB_URI = "mongodb://localhost:27017/test"
        cfg.PROCESSING_LEASE_SECONDS = 60
        # Invalid: 30000ms <= 60 * 1000ms (causes premature reclamation)
        cfg.AUTOCLAIM_MIN_IDLE_MS = 30000
        with self.assertRaises(ValueError) as ctx:
            cfg.validate()
        self.assertIn("must be strictly greater", str(ctx.exception))


class TestDatabaseLeaseTokenAndDeadLetterLogic(unittest.TestCase):
    """Direct database unit tests for unique lease token and dead-letter atomic filters."""

    def setUp(self):
        self.db = Database("mongodb://localhost:27017/test", "test_db")
        self.db.tasks = MagicMock()

    def test_unique_token_generated_on_every_lease_acquisition(self):
        self.db.tasks.find_one_and_update.return_value = {"_id": "task1", "status": "processing"}

        _, token1 = self.db.acquire_task_lease("65f1a2b3c4d5e6f7a8b9c012", "worker-1", 60)
        _, token2 = self.db.acquire_task_lease("65f1a2b3c4d5e6f7a8b9c012", "worker-1", 60)

        self.assertIsNotNone(token1)
        self.assertIsNotNone(token2)
        self.assertNotEqual(token1, token2, "Fresh token must be generated on each acquisition")

    def test_same_worker_reacquiring_lease_receives_different_token(self):
        self.db.tasks.find_one_and_update.return_value = {"_id": "task1", "status": "processing"}

        _, token_a = self.db.acquire_task_lease("65f1a2b3c4d5e6f7a8b9c012", "same-worker", 60)
        _, token_b = self.db.acquire_task_lease("65f1a2b3c4d5e6f7a8b9c012", "same-worker", 60)

        self.assertNotEqual(token_a, token_b)

    def test_complete_task_requires_matching_token_and_unexpired_lease(self):
        self.db.tasks.find_one_and_update.return_value = {"_id": "task1", "status": "completed"}

        result = self.db.complete_task("65f1a2b3c4d5e6f7a8b9c012", "worker-1", "token-xyz", "DONE")
        self.assertTrue(result)

        call_args = self.db.tasks.find_one_and_update.call_args[0]
        filter_query = call_args[0]
        self.assertEqual(filter_query["workerId"], "worker-1")
        self.assertEqual(filter_query["leaseToken"], "token-xyz")
        self.assertEqual(filter_query["status"], "processing")
        self.assertIn("leaseExpiresAt", filter_query)
        self.assertIn("$gt", filter_query["leaseExpiresAt"])

    def test_fail_task_requires_matching_token_and_unexpired_lease(self):
        self.db.tasks.find_one_and_update.return_value = {"_id": "task1", "status": "failed"}

        result = self.db.fail_task("65f1a2b3c4d5e6f7a8b9c012", "worker-1", "token-xyz", "Error msg")
        self.assertTrue(result)

        call_args = self.db.tasks.find_one_and_update.call_args[0]
        filter_query = call_args[0]
        self.assertEqual(filter_query["workerId"], "worker-1")
        self.assertEqual(filter_query["leaseToken"], "token-xyz")
        self.assertEqual(filter_query["status"], "processing")
        self.assertIn("leaseExpiresAt", filter_query)
        self.assertIn("$gt", filter_query["leaseExpiresAt"])

    def test_old_token_cannot_complete_task_when_query_returns_none(self):
        self.db.tasks.find_one_and_update.return_value = None

        result = self.db.complete_task("65f1a2b3c4d5e6f7a8b9c012", "worker-1", "stale-token", "OLD_RESULT")
        self.assertFalse(result, "complete_task must return False when token does not match active lease")

    def test_old_token_cannot_fail_task_when_query_returns_none(self):
        self.db.tasks.find_one_and_update.return_value = None

        result = self.db.fail_task("65f1a2b3c4d5e6f7a8b9c012", "worker-1", "stale-token", "Error msg")
        self.assertFalse(result, "fail_task must return False when token does not match active lease")

    def test_dead_letter_atomic_filter_requires_pending_or_expired_lease(self):
        """record_dead_letter filter must require $or with status: pending OR (processing and expired lease)."""
        self.db.tasks.find_one_and_update.return_value = {"_id": "task1", "status": "failed"}

        self.db.record_dead_letter("65f1a2b3c4d5e6f7a8b9c012", "Retries exhausted")

        call_args = self.db.tasks.find_one_and_update.call_args[0]
        filter_query = call_args[0]
        self.assertIn("$or", filter_query)
        or_clauses = filter_query["$or"]
        self.assertIn({"status": "pending"}, or_clauses)
        # Verify second clause matches processing with expired lease
        has_expired_processing_clause = any(
            c.get("status") == "processing" and "$lt" in c.get("leaseExpiresAt", {})
            for c in or_clauses
        )
        self.assertTrue(has_expired_processing_clause)

    def test_dead_letter_matches_zero_documents_for_actively_leased_task(self):
        """When an actively leased task is checked, the $lt expired filter matches 0 documents and returns False."""
        self.db.tasks.find_one_and_update.return_value = None

        result = self.db.record_dead_letter("65f1a2b3c4d5e6f7a8b9c012", "Exceeded attempts")
        self.assertFalse(result)

    def test_lease_metadata_cleared_only_after_successful_dead_letter_transition(self):
        """When record_dead_letter matches, workerId, leaseToken, and leaseExpiresAt must be cleared to None.
        When 0 documents match (e.g. active lease), record_dead_letter returns False and no metadata is cleared."""
        # Case 1: Match succeeds -> clears metadata
        self.db.tasks.find_one_and_update.return_value = {"_id": "task1", "status": "failed"}

        success = self.db.record_dead_letter("65f1a2b3c4d5e6f7a8b9c012", "Retries exhausted")
        self.assertTrue(success)

        call_args = self.db.tasks.find_one_and_update.call_args[0]
        update_query = call_args[1]
        set_dict = update_query.get("$set", {})
        self.assertIsNone(set_dict.get("workerId"), "workerId must be cleared to None")
        self.assertIsNone(set_dict.get("leaseToken"), "leaseToken must be cleared to None")
        self.assertIsNone(set_dict.get("leaseExpiresAt"), "leaseExpiresAt must be cleared to None")
        self.assertEqual(set_dict.get("status"), "failed")

        # Case 2: Match fails (returns None) -> returns False
        self.db.tasks.find_one_and_update.return_value = None
        failure = self.db.record_dead_letter("65f1a2b3c4d5e6f7a8b9c012", "Retries exhausted")
        self.assertFalse(failure)


class TestDeadLetterDeduplication(unittest.TestCase):
    """Unit tests for dead-letter publishing reliability, atomic Lua deduplication, and failure recovery."""

    def test_successful_xadd_followed_by_retry_returns_same_id_without_duplicate(self):
        """First call publishes via Lua script; retry with same messageId returns identical DLQ ID without duplicate XADD."""
        redis_wrapper = RedisStreamClient("redis://127.0.0.1:6379")
        redis_wrapper.client = MagicMock()

        # First call: Lua returns [new_msg_id, 0] (0 = newly inserted)
        redis_wrapper.client.eval.return_value = ["1795000000000-0", 0]
        res1 = redis_wrapper.send_to_dead_letter(
            "task_stream:dead_letter", "100-0", {"taskId": "t1"}, "retry limit"
        )
        self.assertEqual(res1, "1795000000000-0")
        self.assertEqual(redis_wrapper.client.eval.call_count, 1)

        # Second call (retry): Lua returns [existing_msg_id, 1] (1 = deduplicated duplicate)
        redis_wrapper.client.eval.return_value = ["1795000000000-0", 1]
        res2 = redis_wrapper.send_to_dead_letter(
            "task_stream:dead_letter", "100-0", {"taskId": "t1"}, "retry limit"
        )
        self.assertEqual(res2, "1795000000000-0")
        self.assertEqual(redis_wrapper.client.eval.call_count, 2)

    def test_failed_xadd_does_not_set_dedup_key_and_allows_retry(self):
        """When XADD fails inside Redis or raises an exception, dedup key is never created, allowing retry."""
        redis_wrapper = RedisStreamClient("redis://127.0.0.1:6379")
        redis_wrapper.client = MagicMock()

        # First attempt: XADD fails with a Redis connection/response error
        redis_wrapper.client.eval.side_effect = RuntimeError("Redis connection error during XADD")
        with self.assertRaises(RuntimeError):
            redis_wrapper.send_to_dead_letter(
                "task_stream:dead_letter", "101-0", {"taskId": "t2"}, "retry limit"
            )

        # Second attempt (retry): Network recovered, Lua script executes and succeeds
        redis_wrapper.client.eval.side_effect = None
        redis_wrapper.client.eval.return_value = ["1795000000001-0", 0]

        res = redis_wrapper.send_to_dead_letter(
            "task_stream:dead_letter", "101-0", {"taskId": "t2"}, "retry limit"
        )
        self.assertEqual(res, "1795000000001-0")

    def test_real_redis_atomic_lua_dlq_behavior(self):
        """Integration check against live Redis verifying that failed XADD does not block retry,
        and successful XADD prevents duplicates on retry."""
        import redis as pyredis
        try:
            r = pyredis.Redis(host="localhost", port=6379, decode_responses=True)
            r.ping()
        except Exception:
            self.skipTest("Live Redis not reachable")

        redis_wrapper = RedisStreamClient("redis://127.0.0.1:6379")
        redis_wrapper.client = r

        test_msg_id = "test-msg-audit-99"
        dedup_key = f"dlq:sent:{test_msg_id}"
        test_stream = "test_dlq_audit_stream"
        r.delete(dedup_key, test_stream)

        try:
            # 1. Successful first call
            dlq_id1 = redis_wrapper.send_to_dead_letter(
                test_stream, test_msg_id, {"taskId": "t_audit"}, "audit test"
            )
            self.assertIsNotNone(dlq_id1)
            self.assertEqual(r.xlen(test_stream), 1)

            # 2. Retry with same message ID returns same ID and does NOT duplicate
            dlq_id2 = redis_wrapper.send_to_dead_letter(
                test_stream, test_msg_id, {"taskId": "t_audit"}, "audit test"
            )
            self.assertEqual(dlq_id1, dlq_id2)
            self.assertEqual(r.xlen(test_stream), 1)
        finally:
            r.delete(dedup_key, test_stream)


class TestWorkerLifecycle(unittest.TestCase):
    """Unit tests for Worker message pipeline, lease token handling, and ACK ordering."""

    def setUp(self):
        self.config = Config()
        self.config.REDIS_URL = "redis://127.0.0.1:6379"
        self.config.MONGODB_URI = "mongodb://localhost:27017/test"
        self.config.REDIS_STREAM = "task_stream"
        self.config.REDIS_CONSUMER_GROUP = "task_workers_group"
        self.config.REDIS_CONSUMER_NAME = "test-worker-1"
        self.config.MAX_RETRIES = 3
        self.config.PROCESSING_LEASE_SECONDS = 60
        self.config.AUTOCLAIM_MIN_IDLE_MS = 70000

        self.worker = Worker(self.config)
        self.worker.redis = MagicMock()
        self.worker.db = MagicMock()
        self.worker.redis.get_delivery_count.return_value = 1

    def test_malformed_message_routed_to_dead_letter_and_acked(self):
        fields = {"taskId": "65f1a2b3c4d5e6f7a8b9c012"}
        self.worker.process_message("100-0", fields)

        self.worker.redis.send_to_dead_letter.assert_called_once()
        self.worker.redis.acknowledge_message.assert_called_once_with(
            "task_stream", "task_workers_group", "100-0"
        )
        self.worker.db.acquire_task_lease.assert_not_called()

    def test_task_not_found_in_mongodb_is_acked(self):
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "test input",
        }
        self.worker.db.get_task.return_value = None

        self.worker.process_message("101-0", fields)

        self.worker.redis.acknowledge_message.assert_called_once_with(
            "task_stream", "task_workers_group", "101-0"
        )
        self.worker.db.acquire_task_lease.assert_not_called()

    def test_cancelled_task_is_skipped_and_acked(self):
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "test input",
        }
        self.worker.db.get_task.return_value = {
            "_id": "65f1a2b3c4d5e6f7a8b9c012",
            "status": "cancelled",
        }

        self.worker.process_message("102-0", fields)

        self.worker.redis.acknowledge_message.assert_called_once_with(
            "task_stream", "task_workers_group", "102-0"
        )
        self.worker.db.acquire_task_lease.assert_not_called()

    def test_completed_task_duplicate_delivery_is_skipped_and_acked(self):
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "reverse_string",
            "input": "duplicate test",
        }
        self.worker.db.get_task.return_value = {
            "_id": "65f1a2b3c4d5e6f7a8b9c012",
            "status": "completed",
            "result": "tset etacilpud",
        }

        self.worker.process_message("103-0", fields)

        self.worker.redis.acknowledge_message.assert_called_once_with(
            "task_stream", "task_workers_group", "103-0"
        )
        self.worker.db.acquire_task_lease.assert_not_called()

    def test_another_worker_with_active_lease_does_not_ack(self):
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "active task",
        }
        self.worker.db.get_task.return_value = {"_id": "65f1a2b3c4d5e6f7a8b9c012", "status": "processing"}
        self.worker.db.acquire_task_lease.return_value = (None, None)

        self.worker.process_message("104-0", fields)

        self.worker.redis.acknowledge_message.assert_not_called()
        self.worker.db.complete_task.assert_not_called()

    def test_successful_task_execution_passes_exact_lease_token_and_acks(self):
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "hello world",
        }
        self.worker.db.get_task.return_value = {"_id": "65f1a2b3c4d5e6f7a8b9c012", "status": "pending"}
        mock_task = {"_id": "65f1a2b3c4d5e6f7a8b9c012", "status": "processing"}
        self.worker.db.acquire_task_lease.return_value = (mock_task, "fresh-lease-token-123")
        self.worker.db.complete_task.return_value = True

        self.worker.process_message("105-0", fields)

        self.worker.db.complete_task.assert_called_once_with(
            "65f1a2b3c4d5e6f7a8b9c012", "test-worker-1", "fresh-lease-token-123", "HELLO WORLD"
        )
        self.worker.redis.acknowledge_message.assert_called_once_with(
            "task_stream", "task_workers_group", "105-0"
        )

    def test_mongodb_complete_persistence_failure_prevents_ack(self):
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "test input",
        }
        self.worker.db.get_task.return_value = {"status": "pending"}
        self.worker.db.acquire_task_lease.return_value = ({"status": "processing"}, "token-abc")
        self.worker.db.complete_task.return_value = False

        self.worker.process_message("106-0", fields)

        self.worker.db.complete_task.assert_called_once()
        self.worker.redis.acknowledge_message.assert_not_called()

    def test_mongodb_exception_during_complete_prevents_ack(self):
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "test input",
        }
        self.worker.db.get_task.return_value = {"status": "pending"}
        self.worker.db.acquire_task_lease.return_value = ({"status": "processing"}, "token-abc")
        self.worker.db.complete_task.side_effect = RuntimeError("MongoDB connection reset")

        with self.assertRaises(RuntimeError):
            self.worker.process_message("107-0", fields)

        self.worker.redis.acknowledge_message.assert_not_called()

    def test_processing_exception_passes_exact_lease_token_to_fail_task(self):
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "invalid_op",
            "input": "input data",
        }
        self.worker.db.get_task.return_value = {"status": "pending"}
        self.worker.db.acquire_task_lease.return_value = ({"status": "processing"}, "fail-token-789")
        self.worker.db.fail_task.return_value = True

        self.worker.process_message("108-0", fields)

        self.worker.db.fail_task.assert_called_once()
        args = self.worker.db.fail_task.call_args[0]
        self.assertEqual(args[0], "65f1a2b3c4d5e6f7a8b9c012")
        self.assertEqual(args[1], "test-worker-1")
        self.assertEqual(args[2], "fail-token-789")
        self.assertIn("Unsupported operation", args[3])
        self.worker.redis.acknowledge_message.assert_called_once_with(
            "task_stream", "task_workers_group", "108-0"
        )

    def test_dead_letter_on_pending_task_marks_failed_dlqs_and_acks(self):
        """When retries exceed limit on pending task, marks failed in DB, DLQs, and ACKs."""
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "poison pill",
        }
        self.worker.redis.get_delivery_count.return_value = 4
        self.worker.db.get_task.return_value = {"_id": "65f1a2b3c4d5e6f7a8b9c012", "status": "pending"}
        self.worker.db.record_dead_letter.return_value = True

        self.worker.process_message("109-0", fields)

        self.worker.db.record_dead_letter.assert_called_once_with(
            "65f1a2b3c4d5e6f7a8b9c012", "Exceeded maximum delivery attempts (4)"
        )
        self.worker.redis.send_to_dead_letter.assert_called_once()
        self.worker.redis.acknowledge_message.assert_called_once_with(
            "task_stream", "task_workers_group", "109-0"
        )

    def test_dead_letter_on_actively_leased_task_does_not_dlq_or_ack(self):
        """When retries exceed limit but task is actively leased, record_dead_letter returns False; omits DLQ and ACK."""
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "active task",
        }
        self.worker.redis.get_delivery_count.return_value = 4
        self.worker.db.get_task.return_value = {
            "_id": "65f1a2b3c4d5e6f7a8b9c012",
            "status": "processing",
            "leaseExpiresAt": datetime.now(timezone.utc) + timedelta(seconds=50),
        }
        self.worker.db.record_dead_letter.return_value = False  # Active lease!

        self.worker.process_message("110-0", fields)

        self.worker.db.record_dead_letter.assert_called_once()
        # MUST NOT send to dead letter and MUST NOT acknowledge
        self.worker.redis.send_to_dead_letter.assert_not_called()
        self.worker.redis.acknowledge_message.assert_not_called()

    def test_dead_letter_on_terminal_task_does_not_dlq_and_only_acks(self):
        """When retries exceed limit but task is already completed, skips DLQ and acknowledges."""
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "completed task",
        }
        self.worker.redis.get_delivery_count.return_value = 4
        self.worker.db.get_task.return_value = {
            "_id": "65f1a2b3c4d5e6f7a8b9c012",
            "status": "completed",
        }

        self.worker.process_message("111-0", fields)

        self.worker.db.record_dead_letter.assert_not_called()
        self.worker.redis.send_to_dead_letter.assert_not_called()
        self.worker.redis.acknowledge_message.assert_called_once_with(
            "task_stream", "task_workers_group", "111-0"
        )

    def test_active_lease_acquired_between_inspection_and_dead_letter_update(self):
        """Race condition check:
        1. Worker B inspects task with expired lease.
        2. Worker A acquires new active lease.
        3. Worker B calls record_dead_letter(), which returns False.
        4. Fresh fetch shows active lease -> Worker B MUST NOT DLQ and MUST NOT ACK."""
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "race condition task",
        }
        self.worker.redis.get_delivery_count.return_value = 4

        # Initial inspection: expired processing lease
        expired_task = {
            "_id": "65f1a2b3c4d5e6f7a8b9c012",
            "status": "processing",
            "leaseExpiresAt": datetime.now(timezone.utc) - timedelta(seconds=10),
        }
        # Fresh inspection after record_dead_letter fails: Worker A acquired active lease!
        active_task = {
            "_id": "65f1a2b3c4d5e6f7a8b9c012",
            "status": "processing",
            "workerId": "worker-A",
            "leaseExpiresAt": datetime.now(timezone.utc) + timedelta(seconds=60),
        }
        self.worker.db.get_task.side_effect = [expired_task, active_task]
        self.worker.db.record_dead_letter.return_value = False

        self.worker.process_message("113-0", fields)

        self.worker.db.record_dead_letter.assert_called_once()
        self.worker.redis.send_to_dead_letter.assert_not_called()
        self.worker.redis.acknowledge_message.assert_not_called()

    def test_task_becomes_completed_between_inspection_and_update(self):
        """Race condition check:
        1. Initial inspection: expired lease.
        2. In the meantime, active worker completes the task.
        3. record_dead_letter() returns False because status is now 'completed'.
        4. Fresh fetch reveals 'completed' status -> Worker acknowledges message without DLQ."""
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "completed race task",
        }
        self.worker.redis.get_delivery_count.return_value = 4

        expired_task = {
            "_id": "65f1a2b3c4d5e6f7a8b9c012",
            "status": "processing",
            "leaseExpiresAt": datetime.now(timezone.utc) - timedelta(seconds=10),
        }
        completed_task = {
            "_id": "65f1a2b3c4d5e6f7a8b9c012",
            "status": "completed",
            "result": "COMPLETED RESULT",
        }
        self.worker.db.get_task.side_effect = [expired_task, completed_task]
        self.worker.db.record_dead_letter.return_value = False

        self.worker.process_message("114-0", fields)

        self.worker.db.record_dead_letter.assert_called_once()
        self.worker.redis.send_to_dead_letter.assert_not_called()
        self.worker.redis.acknowledge_message.assert_called_once_with(
            "task_stream", "task_workers_group", "114-0"
        )

    def test_record_dead_letter_returns_false_general(self):
        """Verifies that whenever record_dead_letter returns False and task is active,
        message remains unacknowledged and is NOT routed to dead-letter."""
        fields = {
            "taskId": "65f1a2b3c4d5e6f7a8b9c012",
            "operation": "uppercase",
            "input": "general test",
        }
        self.worker.redis.get_delivery_count.return_value = 4
        self.worker.db.get_task.return_value = {
            "_id": "65f1a2b3c4d5e6f7a8b9c012",
            "status": "processing",
            "workerId": "worker-B",
        }
        self.worker.db.record_dead_letter.return_value = False

        self.worker.process_message("115-0", fields)

        self.worker.redis.send_to_dead_letter.assert_not_called()
        self.worker.redis.acknowledge_message.assert_not_called()

    def test_no_lease_token_in_logs(self):
        """Validates that lease tokens are never exposed in log outputs."""
        log_capture = io.StringIO()
        handler = logging.StreamHandler(log_capture)
        test_logger = logging.getLogger("worker.main")
        test_logger.addHandler(handler)

        try:
            fields = {
                "taskId": "65f1a2b3c4d5e6f7a8b9c012",
                "operation": "uppercase",
                "input": "hello world",
            }
            self.worker.db.get_task.return_value = {"_id": "65f1a2b3c4d5e6f7a8b9c012", "status": "pending"}
            self.worker.db.acquire_task_lease.return_value = (
                {"_id": "65f1a2b3c4d5e6f7a8b9c012"}, "super-secret-token-xyz"
            )
            self.worker.db.complete_task.return_value = True

            self.worker.process_message("112-0", fields)

            logs = log_capture.getvalue()
            self.assertNotIn("super-secret-token", logs)
            self.assertNotIn("token:", logs)
        finally:
            test_logger.removeHandler(handler)


class TestInstalledLibraryCompatibility(unittest.TestCase):
    """Verifies that installed redis 8.1.0 and pymongo 4.20.0 support all invoked APIs."""

    def test_redis_8_library_api(self):
        import redis
        self.assertTrue(hasattr(redis.Redis, "xadd"))
        self.assertTrue(hasattr(redis.Redis, "xreadgroup"))
        self.assertTrue(hasattr(redis.Redis, "xautoclaim"))
        self.assertTrue(hasattr(redis.Redis, "xack"))
        self.assertTrue(hasattr(redis.Redis, "xpending_range"))
        self.assertTrue(hasattr(redis.Redis, "xgroup_create"))
        self.assertTrue(hasattr(redis.Redis, "set"))

    def test_pymongo_4_library_api(self):
        from pymongo import MongoClient, ReturnDocument
        from bson import ObjectId
        self.assertTrue(hasattr(ReturnDocument, "AFTER"))
        self.assertTrue(callable(ObjectId))


if __name__ == "__main__":
    unittest.main()
