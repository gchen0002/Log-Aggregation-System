"""SQLite database connection management."""

import sqlite3
import threading
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

import structlog

logger = structlog.get_logger()


class Database:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._ensure_directory()
        self._connection: sqlite3.Connection | None = None
        self._lock = threading.RLock()
        logger.info("database_initialized", db_path=db_path)

    def _ensure_directory(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

    @property
    def connection(self) -> sqlite3.Connection:
        with self._lock:
            if self._connection is None:
                self._connection = sqlite3.connect(
                    self.db_path,
                    check_same_thread=False,
                )
                self._connection.row_factory = sqlite3.Row
                self._enable_wal_mode_unlocked()
            return self._connection

    def _enable_wal_mode_unlocked(self) -> None:
        cursor = self._connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    @contextmanager
    def get_cursor(self) -> Generator[sqlite3.Cursor, None, None]:
        with self._lock:
            cursor = self.connection.cursor()
        try:
            yield cursor
        finally:
            cursor.close()

    def execute(self, query: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._connection.execute(query, params)

    def commit(self) -> None:
        with self._lock:
            if self._connection:
                self._connection.commit()

    def close(self) -> None:
        with self._lock:
            if self._connection:
                self._connection.close()
                self._connection = None
                logger.info("database_closed")
