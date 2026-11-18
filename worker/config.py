"""Configuration loader and validator for the Python Task Worker."""

import os
import uuid
from pathlib import Path

# Attempt to load python-dotenv if installed
try:
    from dotenv import load_dotenv

    # 1. Look for worker/.env
    worker_env = Path(__file__).resolve().parent / ".env"
    if worker_env.exists():
        load_dotenv(dotenv_path=worker_env)
    else:
        # 2. Fallback to backend/.env if worker/.env does not exist
        backend_env = Path(__file__).resolve().parent.parent / "backend" / ".env"
        if backend_env.exists():
            load_dotenv(dotenv_path=backend_env)
except ImportError:
    # python-dotenv not installed yet; rely on system environment variables
    pass


class Config:
    """Worker configuration container."""

    def __init__(self):
        self.REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379")
        self.MONGODB_URI = os.getenv("MONGODB_URI", "")
        self.MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "ai-task-platform")

        self.REDIS_STREAM = os.getenv("REDIS_STREAM", "task_stream")
        self.REDIS_CONSUMER_GROUP = os.getenv("REDIS_CONSUMER_GROUP", "task_workers_group")

        # Unique consumer identity per worker process
        consumer_env = os.getenv("REDIS_CONSUMER_NAME", "").strip()
        self.REDIS_CONSUMER_NAME = consumer_env if consumer_env else f"worker-{uuid.uuid4().hex[:8]}"

        self.REDIS_BLOCK_MS = int(os.getenv("REDIS_BLOCK_MS", "2000"))
        self.REDIS_BATCH_SIZE = int(os.getenv("REDIS_BATCH_SIZE", "10"))
        self.PROCESSING_LEASE_SECONDS = int(os.getenv("PROCESSING_LEASE_SECONDS", "60"))
        self.AUTOCLAIM_MIN_IDLE_MS = int(os.getenv("AUTOCLAIM_MIN_IDLE_MS", "70000"))
        self.RECOVERY_POLLING_INTERVAL_SECONDS = float(
            os.getenv("RECOVERY_POLLING_INTERVAL_SECONDS", "10.0")
        )
        self.MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
        self.DEAD_LETTER_STREAM = os.getenv("DEAD_LETTER_STREAM", "task_stream:dead_letter")

    def validate(self):
        """Validates critical connection parameters and timing alignment, raising ValueError if invalid."""
        errors = []
        if not self.REDIS_URL:
            errors.append("REDIS_URL is required.")
        if not self.MONGODB_URI:
            errors.append("MONGODB_URI is required.")
        if not self.REDIS_STREAM:
            errors.append("REDIS_STREAM is required.")
        if not self.REDIS_CONSUMER_GROUP:
            errors.append("REDIS_CONSUMER_GROUP is required.")
        if self.PROCESSING_LEASE_SECONDS <= 0:
            errors.append("PROCESSING_LEASE_SECONDS must be positive.")
        if self.AUTOCLAIM_MIN_IDLE_MS <= (self.PROCESSING_LEASE_SECONDS * 1000):
            errors.append(
                f"AUTOCLAIM_MIN_IDLE_MS ({self.AUTOCLAIM_MIN_IDLE_MS}ms) must be strictly greater "
                f"than PROCESSING_LEASE_SECONDS ({self.PROCESSING_LEASE_SECONDS * 1000}ms) to prevent premature reclamation."
            )
        if self.RECOVERY_POLLING_INTERVAL_SECONDS <= 0:
            errors.append("RECOVERY_POLLING_INTERVAL_SECONDS must be positive.")

        if errors:
            raise ValueError(f"Configuration validation failed: {'; '.join(errors)}")

    def __repr__(self):
        # Prevent secret exposure in repr/logs
        return (
            f"<Config stream={self.REDIS_STREAM} "
            f"group={self.REDIS_CONSUMER_GROUP} "
            f"consumer={self.REDIS_CONSUMER_NAME} "
            f"batch_size={self.REDIS_BATCH_SIZE} "
            f"lease_sec={self.PROCESSING_LEASE_SECONDS}>"
        )
