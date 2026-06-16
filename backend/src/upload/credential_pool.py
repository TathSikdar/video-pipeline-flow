"""Credential Pool for YouTube Data API.

Dynamically loads multiple GCP project credentials from environment variables
(GCP_CLIENT_ID_1, GCP_CLIENT_ID_2, etc.) and provides a thread-safe
round-robin rotating pool to distribute API quota across multiple projects.
"""

import logging
import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Tuple, Optional

logger = logging.getLogger(__name__)


class CredentialPool:
    """Thread-safe round-robin credential pool."""
    
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(CredentialPool, cls).__new__(cls)
                cls._instance._initialize()
            return cls._instance

    def _initialize(self):
        """Discovers credentials from the environment."""
        self.credentials: List[Tuple[str, str, str]] = []
        self.current_index = 0
        self._pool_lock = threading.Lock()
        
        # Track exhausted IDs in memory with timestamps
        self.exhausted_projects = {}
        self.exhausted_accounts = {}

        # Scan the environment for GCP_CLIENT_ID_*
        for key, client_id in os.environ.items():
            if key.startswith("GCP_CLIENT_ID_") and client_id:
                suffix = key.replace("GCP_CLIENT_ID_", "")
                
                client_secret = os.environ.get(f"GCP_CLIENT_SECRET_{suffix}")
                refresh_token = os.environ.get(f"GCP_REFRESH_TOKEN_{suffix}")

                if client_secret and refresh_token:
                    self.credentials.append((client_id, client_secret, refresh_token))
                    logger.info("Loaded credentials for project index: %s", suffix)
                else:
                    logger.warning("Found %s but missing secret or refresh token for index %s", key, suffix)

        if not self.credentials:
            logger.error("No valid GCP credentials found in the environment. Uploads will fail.")
        else:
            logger.info("CredentialPool initialized with %d projects.", len(self.credentials))

    def get_next_credential(self) -> Optional[Tuple[str, str, str]]:
        """Returns the next valid credential set in a round-robin.

        Automatically skips any credentials tied to an exhausted Project
        or an exhausted Account.

        Returns:
            Tuple of (client_id, client_secret, refresh_token) or None if all are exhausted.
        """
        if not self.credentials:
            return None

        with self._pool_lock:
            # Try to find a valid credential up to N times (pool size)
            for _ in range(len(self.credentials)):
                client_id, client_secret, refresh_token = self.credentials[self.current_index]
                self.current_index = (self.current_index + 1) % len(self.credentials)
                
                now_pt = datetime.now(tz=ZoneInfo("America/Los_Angeles"))
                
                # Helper to check if a ban has expired (passed midnight PT)
                def is_expired(ban_timestamp: float) -> bool:
                    ban_time_pt = datetime.fromtimestamp(ban_timestamp, tz=ZoneInfo("America/Los_Angeles"))
                    return now_pt.date() > ban_time_pt.date()
                
                # Check if this combination uses a banned project
                if client_id in self.exhausted_projects:
                    if not is_expired(self.exhausted_projects[client_id]):
                        continue
                    else:
                        del self.exhausted_projects[client_id]
                        
                # Check if this combination uses a banned account
                if refresh_token in self.exhausted_accounts:
                    if not is_expired(self.exhausted_accounts[refresh_token]):
                        continue
                    else:
                        del self.exhausted_accounts[refresh_token]
                    
                return (client_id, client_secret, refresh_token)
                
            # If the loop finishes without returning, everything is exhausted
            return None

    def mark_exhausted(self, client_id: str, refresh_token: str, reason: str) -> None:
        """Bans a specific Project or Account from being used again."""
        with self._pool_lock:
            if reason == "quotaExceeded":
                logger.warning("Banning GCP Project: %s (API Quota Exhausted until Midnight PT)", client_id[:15] + "...")
                self.exhausted_projects[client_id] = time.time()
            elif reason in ("uploadLimitExceeded", "invalid_grant"):
                logger.warning("Banning YouTube Account: %s (Limit Exhausted or Invalid Grant until Midnight PT)", refresh_token[:15] + "...")
                self.exhausted_accounts[refresh_token] = time.time()

    def get_pool_size(self) -> int:
        return len(self.credentials)
