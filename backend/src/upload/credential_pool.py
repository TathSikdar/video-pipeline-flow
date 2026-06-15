"""
Credential Pool Manager.
Handles YouTube Data API OAuth refresh token rotation to bypass the 10,000 daily quota limits.
Utilizes Redis for cross-node state synchronization, falling back to a local memory pool if offline.
"""

import logging
import os
import redis

logger = logging.getLogger(__name__)


class CredentialPool:
    def __init__(self, redis_url: str = "redis://redis:6379/0"):
        self.redis_client = None
        self._memory_pool = []
        self._current_index = 0

        try:
            self.redis_client = redis.Redis.from_url(redis_url, socket_timeout=2)
            self.redis_client.ping()
            logger.info("Successfully connected to Redis credential pool.")
        except redis.ConnectionError:
            logger.warning(
                "Redis is unreachable. Falling back to In-Memory Round Robin Pool."
            )
            self._load_memory_pool()

    def _load_memory_pool(self):
        # Fallback: Load tokens from environment
        token = os.getenv("GCP_REFRESH_TOKEN_1", "dummy_token_1")
        self._memory_pool.append(token)
        logger.info(f"Loaded {len(self._memory_pool)} tokens into memory pool.")

    def get_active_token(self) -> str:
        """Retrieves the active OAuth refresh token."""
        if self.redis_client:
            # For scaffolding: fetch from redis or return a dummy
            token = self.redis_client.get("active_token")
            return token.decode("utf-8") if token else "redis_dummy_token"
        else:
            return self._memory_pool[self._current_index]

    def rotate_token(self) -> None:
        """Marks the current token as exhausted and rotates to the next one."""
        logger.info("Rotating OAuth credentials due to quota exhaustion...")
        if self.redis_client:
            # Advance redis pointer
            pass
        else:
            self._current_index = (self._current_index + 1) % len(self._memory_pool)
