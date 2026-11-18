"""MongoDB connection management and atomic task persistence."""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("worker.db")

try:
    from bson import ObjectId
    from bson.errors import InvalidId
    from pymongo import MongoClient, ReturnDocument
except ImportError:
    # Graceful fallback when pymongo is not yet installed in local environment
    ObjectId = None  # type: ignore
    InvalidId = Exception  # type: ignore
    MongoClient = None  # type: ignore
    ReturnDocument = None  # type: ignore


def parse_object_id(task_id: str) -> Optional[Any]:
    """Safely parses a 24-character hexadecimal string into a BSON ObjectId."""
    if not task_id or not isinstance(task_id, str):
        return None
    if ObjectId is None:
        return task_id
    try:
        return ObjectId(task_id)
    except (InvalidId, TypeError):
        return None


class Database:
    """Manages PyMongo connections and atomic conditional task updates."""

    def __init__(self, uri: str, db_name: str = "ai-task-platform"):
        self.uri = uri
        self.db_name = db_name
        self.client: Optional[Any] = None
        self.db: Optional[Any] = None
        self.tasks: Optional[Any] = None

    def connect(self):
        """Initializes PyMongo MongoClient and selects the tasks collection."""
        if MongoClient is None:
            raise RuntimeError(
                "pymongo is not installed. Please install dependencies from worker/requirements.txt."
            )
        self.client = MongoClient(self.uri, serverSelectionTimeoutMS=5000)
        self.db = self.client[self.db_name]
        self.tasks = self.db["tasks"]
        self.ping()

    def ping(self):
        """Verifies active connectivity to MongoDB cluster."""
        if self.client:
            self.client.admin.command("ping")

    def close(self):
        """Closes MongoDB connection pool gracefully."""
        if self.client:
            self.client.close()
            self.client = None

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a task document by ID."""
        oid = parse_object_id(task_id)
        if not oid:
            return None
        return self.tasks.find_one({"_id": oid})

    def acquire_task_lease(
        self, task_id: str, worker_id: str, lease_duration_seconds: int = 60
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Atomically transitions a task to 'processing' and assigns ownership with a unique lease token.

        Enforces lease recovery:
        - Succeeds if task status is 'pending'.
        - Succeeds if task status is 'processing' AND current lease has expired (worker crash recovery).
        - Generates a fresh unique leaseToken for each acquisition.
        - Rejects if task is 'completed', 'failed', 'cancelled', or actively leased by another worker.

        Args:
            task_id: MongoDB task string identifier.
            worker_id: Unique worker instance identifier.
            lease_duration_seconds: Lease expiration TTL.

        Returns:
            Tuple of (updated_task_doc, lease_token) if acquired, or (None, None) if rejected.
        """
        oid = parse_object_id(task_id)
        if not oid:
            return None, None

        now = datetime.now(timezone.utc)
        lease_expires_at = now + timedelta(seconds=lease_duration_seconds)
        lease_token = uuid.uuid4().hex

        filter_query = {
            "_id": oid,
            "$or": [
                {"status": "pending"},
                {
                    "status": "processing",
                    "leaseExpiresAt": {"$lt": now},
                },
            ],
        }

        update_query = {
            "$set": {
                "status": "processing",
                "workerId": worker_id,
                "leaseToken": lease_token,
                "leaseExpiresAt": lease_expires_at,
                "startedAt": now,
            },
            "$push": {
                "logs": {
                    "message": f"Processing lease acquired by worker '{worker_id}'",
                    "timestamp": now,
                    "level": "info",
                }
            },
        }

        return_doc = ReturnDocument.AFTER if ReturnDocument else True
        doc = self.tasks.find_one_and_update(
            filter_query,
            update_query,
            return_document=return_doc,
        )
        if doc:
            return doc, lease_token
        return None, None

    def complete_task(
        self, task_id: str, worker_id: str, lease_token: str, result_str: str
    ) -> bool:
        """Atomically marks a task as 'completed' conditioned on current workerId, leaseToken, and active lease.

        Prevents zombie workers whose lease expired or was reacquired from overwriting newer work.

        Args:
            task_id: MongoDB task string identifier.
            worker_id: The worker attempting completion.
            lease_token: Fresh lease token acquired during acquire_task_lease.
            result_str: Computed result string.

        Returns:
            True if successfully persisted, False if worker lost ownership or lease expired.
        """
        oid = parse_object_id(task_id)
        if not oid or not lease_token:
            return False

        now = datetime.now(timezone.utc)
        filter_query = {
            "_id": oid,
            "status": "processing",
            "workerId": worker_id,
            "leaseToken": lease_token,
            "leaseExpiresAt": {"$gt": now},  # Strict lease active check
        }

        update_query = {
            "$set": {
                "status": "completed",
                "result": str(result_str),
                "completedAt": now,
            },
            "$push": {
                "logs": {
                    "message": f"Task successfully completed by worker '{worker_id}'",
                    "timestamp": now,
                    "level": "info",
                }
            },
        }

        updated = self.tasks.find_one_and_update(filter_query, update_query)
        return updated is not None

    def fail_task(
        self, task_id: str, worker_id: str, lease_token: str, error_message: str
    ) -> bool:
        """Atomically marks a task as 'failed' conditioned on current workerId, leaseToken, and active lease.

        Args:
            task_id: MongoDB task string identifier.
            worker_id: The worker attempting failure update.
            lease_token: Fresh lease token acquired during acquire_task_lease.
            error_message: Explanatory error details.

        Returns:
            True if successfully persisted, False if worker lost ownership or lease expired.
        """
        oid = parse_object_id(task_id)
        if not oid or not lease_token:
            return False

        now = datetime.now(timezone.utc)
        filter_query = {
            "_id": oid,
            "status": "processing",
            "workerId": worker_id,
            "leaseToken": lease_token,
            "leaseExpiresAt": {"$gt": now},  # Strict lease active check
        }

        update_query = {
            "$set": {
                "status": "failed",
                "error": str(error_message),
                "completedAt": now,
            },
            "$push": {
                "logs": {
                    "message": f"Task execution failed: {error_message}",
                    "timestamp": now,
                    "level": "error",
                }
            },
        }

        updated = self.tasks.find_one_and_update(filter_query, update_query)
        return updated is not None

    def record_dead_letter(self, task_id: str, reason: str) -> bool:
        """Marks a task as failed when message retry limits are exhausted.

        Can mark a task failed only when:
        - The task is still 'pending', OR
        - The task is 'processing' AND its leaseExpiresAt is earlier than current UTC time (< now).

        Will NOT match or overwrite:
        - Actively leased tasks ('processing' with leaseExpiresAt >= now)
        - Terminal tasks ('completed', 'failed', 'cancelled')

        Returns:
            True if task was atomically marked failed, False if zero documents matched.
        """
        oid = parse_object_id(task_id)
        if not oid:
            return False

        now = datetime.now(timezone.utc)
        filter_query = {
            "_id": oid,
            "$or": [
                {"status": "pending"},
                {
                    "status": "processing",
                    "leaseExpiresAt": {"$lt": now},
                },
            ],
        }
        update_query = {
            "$set": {
                "status": "failed",
                "error": f"Dead letter: {reason}",
                "workerId": None,
                "leaseToken": None,
                "leaseExpiresAt": None,
                "completedAt": now,
                "updatedAt": now,
            },
            "$push": {
                "logs": {
                    "message": f"Task moved to dead letter queue: {reason}",
                    "timestamp": now,
                    "level": "error",
                }
            },
        }
        updated = self.tasks.find_one_and_update(filter_query, update_query)
        return updated is not None
