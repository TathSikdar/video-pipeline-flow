"""Credential Pool Manager.

Handles YouTube Data API OAuth refresh token rotation to bypass
the 10,000 daily quota unit limit. Utilizes Redis for cross-node
state synchronization with atomic round-robin operations, falling
back to a local in-memory pool if Redis is unreachable.

The pool supports multiple GCP project tokens loaded from
environment variables matching the pattern GCP_REFRESH_TOKEN_*.
When a token's quota is exhausted (detected via 403 quotaExceeded),
the pool atomically rotates to the next available token.
"""

import logging
import os
import re
from typing import Optional

import httpx
import redis

logger = logging.getLogger(__name__)

# Google OAuth 2.0 token exchange endpoint
TOKEN_URL = "https://oauth2.googleapis.com/token"

# GCP Client credentials for token exchange
GCP_CLIENT_ID = os.getenv("GCP_CLIENT_ID", "")
GCP_CLIENT_SECRET = os.getenv("GCP_CLIENT_SECRET", "")

# Redis key names
REDIS_TOKEN_LIST = "credential_pool:tokens"
REDIS_EXHAUSTED_SET = "credential_pool:exhausted"

# Exhausted token cooldown period (24 hours in seconds)
EXHAUSTED_TTL = 86400


class CredentialPool:
    """Manages a rotating pool of YouTube API OAuth tokens.

    Supports two operational modes:
    - Redis mode: Tokens are stored in a Redis list and rotated
      atomically using LPOP/RPUSH. Exhausted tokens are moved
      to a sorted set with a 24-hour TTL.
    - Memory mode: Tokens are loaded from environment variables
      and rotated via a simple index counter.

    Attributes:
        redis_client: The Redis connection, or None if offline.
    """

    def __init__(
        self,
        redis_url: str = "redis://redis:6379/0",
    ) -> None:
        """Initializes the credential pool.

        Attempts to connect to Redis. If the connection fails,
        falls back to loading tokens from environment variables.

        Args:
            redis_url: The Redis connection URL.
        """
        self.redis_client: Optional[redis.Redis] = None
        self._memory_pool: list[str] = []
        self._current_index: int = 0

        try:
            self.redis_client = redis.Redis.from_url(redis_url, socket_timeout=2)
            self.redis_client.ping()
            logger.info("Connected to Redis credential pool.")
            self._sync_tokens_to_redis()
        except redis.ConnectionError:
            logger.warning("Redis unreachable. " "Falling back to in-memory pool.")
            self.redis_client = None
            self._load_memory_pool()

    def _load_memory_pool(self) -> None:
        """Loads all tokens from environment variables.

        Scans the environment for variables matching the pattern
        GCP_REFRESH_TOKEN_* and loads them into the memory pool.
        """
        token_pattern = re.compile(r"^GCP_REFRESH_TOKEN_\d+$")

        for key, value in sorted(os.environ.items()):
            if token_pattern.match(key) and value:
                self._memory_pool.append(value)

        if not self._memory_pool:
            logger.warning(
                "No GCP_REFRESH_TOKEN_* variables found. "
                "Upload functionality will be unavailable."
            )
        else:
            logger.info(
                "Loaded %d tokens into memory pool.",
                len(self._memory_pool),
            )

    def _sync_tokens_to_redis(self) -> None:
        """Seeds Redis with tokens from environment variables.

        Only adds tokens that are not already present in the
        Redis list. This ensures idempotent container restarts
        do not duplicate tokens.
        """
        if not self.redis_client:
            return

        token_pattern = re.compile(r"^GCP_REFRESH_TOKEN_\d+$")

        existing = self.redis_client.lrange(REDIS_TOKEN_LIST, 0, -1)
        existing_set = {t.decode("utf-8") for t in existing}

        added = 0
        for key, value in sorted(os.environ.items()):
            if token_pattern.match(key) and value and value not in existing_set:
                self.redis_client.rpush(REDIS_TOKEN_LIST, value)
                added += 1

        if added > 0:
            logger.info("Synced %d new tokens to Redis.", added)

    def get_active_token(self) -> Optional[str]:
        """Retrieves the current active OAuth refresh token.

        In Redis mode, peeks at the head of the token list
        without removing it. In memory mode, returns the token
        at the current index.

        Returns:
            The active refresh token string, or None if the
            pool is empty.
        """
        if self.redis_client:
            token = self.redis_client.lindex(REDIS_TOKEN_LIST, 0)
            if token:
                return token.decode("utf-8")
            return None

        if not self._memory_pool:
            return None
        return self._memory_pool[self._current_index]

    def rotate_token(self) -> None:
        """Marks the current token as exhausted and rotates.

        In Redis mode, atomically pops the exhausted token from
        the head, adds it to the exhausted sorted set with a
        24-hour TTL, and the next token becomes the new head.

        In memory mode, advances the index to the next token
        in the round-robin list.
        """
        logger.info("Rotating OAuth credentials " "due to quota exhaustion...")

        if self.redis_client:
            exhausted = self.redis_client.lpop(REDIS_TOKEN_LIST)
            if exhausted:
                self.redis_client.setex(
                    f"{REDIS_EXHAUSTED_SET}:" f'{exhausted.decode("utf-8")}',
                    EXHAUSTED_TTL,
                    "1",
                )
                logger.info("Token moved to exhausted set " "(24h cooldown).")

            remaining = self.redis_client.llen(REDIS_TOKEN_LIST)
            logger.info("%d tokens remaining in pool.", remaining)
        else:
            if self._memory_pool:
                self._current_index = (self._current_index + 1) % len(self._memory_pool)
                logger.info(
                    "Rotated to token index %d.",
                    self._current_index,
                )

    def exchange_refresh_for_access(
        self,
        refresh_token: str,
    ) -> Optional[str]:
        """Exchanges a refresh token for a short-lived access token.

        Posts to Google's OAuth token endpoint with the refresh
        token and TVHTML5 client credentials to obtain an access
        token valid for approximately 1 hour.

        Args:
            refresh_token: The OAuth 2.0 refresh token.

        Returns:
            The access token string, or None if the exchange
            fails.
        """
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.post(
                    TOKEN_URL,
                    data={
                        "client_id": GCP_CLIENT_ID,
                        "client_secret": GCP_CLIENT_SECRET,
                        "refresh_token": refresh_token,
                        "grant_type": "refresh_token",
                    },
                )
                response.raise_for_status()

                data = response.json()
                access_token = data.get("access_token")

                if access_token:
                    logger.info(
                        "Access token obtained " "(expires in %ds).",
                        data.get("expires_in", 0),
                    )
                return access_token

        except httpx.HTTPError as exc:
            logger.error("Token exchange failed: %s", str(exc))
            return None

    def pool_size(self) -> int:
        """Returns the number of tokens currently in the pool.

        Returns:
            The token count.
        """
        if self.redis_client:
            return self.redis_client.llen(REDIS_TOKEN_LIST)
        return len(self._memory_pool)
