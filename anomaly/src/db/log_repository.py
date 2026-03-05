"""Log repository for reading logs from SQLite database."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import structlog

from .database import Database

logger = structlog.get_logger()


@dataclass
class LogEntry:
    id: str
    timestamp: str
    level: str
    source: str
    message: str
    raw: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "level": self.level,
            "source": self.source,
            "message": self.message,
            "raw": self.raw,
        }


class LogRepository:
    def __init__(self, db: Database) -> None:
        self.db = db
        self._ensure_state_table()

    def _ensure_state_table(self) -> None:
        with self.db.get_cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS anomaly_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
        self.db.commit()

    def fetch_logs_since(
        self,
        since_id: str | None,
        limit: int = 1000,
    ) -> list[LogEntry]:
        if since_id:
            rows = self.db.execute(
                """
                SELECT id, timestamp, level, source, message, raw
                FROM logs
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (since_id, limit),
            ).fetchall()
        else:
            rows = self.db.execute(
                """
                SELECT id, timestamp, level, source, message, raw
                FROM logs
                ORDER BY id ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return [LogEntry(**dict(row)) for row in rows]

    def fetch_logs_by_timerange(
        self,
        start_time: datetime,
        end_time: datetime,
        limit: int = 10000,
    ) -> list[LogEntry]:
        rows = self.db.execute(
            """
            SELECT id, timestamp, level, source, message, raw
            FROM logs
            WHERE timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
            LIMIT ?
            """,
            (start_time.isoformat(), end_time.isoformat(), limit),
        ).fetchall()

        return [LogEntry(**dict(row)) for row in rows]

    def fetch_recent_logs(self, hours: float = 1.0, limit: int = 10000) -> list[LogEntry]:
        since = datetime.utcnow() - timedelta(hours=hours)
        return self.fetch_logs_by_timerange(since, datetime.utcnow(), limit)

    def get_log_count_by_level(self, since: datetime) -> dict[str, int]:
        rows = self.db.execute(
            """
            SELECT level, COUNT(*) as count
            FROM logs
            WHERE timestamp >= ?
            GROUP BY level
            """,
            (since.isoformat(),),
        ).fetchall()

        return {row["level"]: row["count"] for row in rows}

    def get_log_count_by_source(self, since: datetime) -> dict[str, int]:
        rows = self.db.execute(
            """
            SELECT source, COUNT(*) as count
            FROM logs
            WHERE timestamp >= ?
            GROUP BY source
            """,
            (since.isoformat(),),
        ).fetchall()

        return {row["source"]: row["count"] for row in rows}

    def get_total_count(self, since: datetime | None = None) -> int:
        if since:
            row = self.db.execute(
                "SELECT COUNT(*) as count FROM logs WHERE timestamp >= ?",
                (since.isoformat(),),
            ).fetchone()
        else:
            row = self.db.execute("SELECT COUNT(*) as count FROM logs").fetchone()
        return row["count"] if row else 0

    def get_last_processed_id(self) -> str | None:
        row = self.db.execute(
            "SELECT value FROM anomaly_state WHERE key = 'last_processed_id'"
        ).fetchone()
        return row["value"] if row else None

    def set_last_processed_id(self, log_id: str | None) -> None:
        with self.db.get_cursor() as cursor:
            if log_id is None:
                cursor.execute("DELETE FROM anomaly_state WHERE key = 'last_processed_id'")
            else:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO anomaly_state (key, value, updated_at)
                    VALUES ('last_processed_id', ?, ?)
                    """,
                    (log_id, datetime.utcnow().isoformat()),
                )
            self.db.connection.commit()

    def get_volume_stats(self, hours: float = 24.0) -> dict[str, Any]:
        since = datetime.utcnow() - timedelta(hours=hours)
        rows = self.db.execute(
            """
            SELECT
                strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
                COUNT(*) as count
            FROM logs
            WHERE timestamp >= ?
            GROUP BY hour
            ORDER BY hour
            """,
            (since.isoformat(),),
        ).fetchall()

        volumes = [row["count"] for row in rows]
        if not volumes:
            return {"mean": 0, "std": 0, "max": 0, "min": 0}

        import statistics

        return {
            "mean": statistics.mean(volumes),
            "std": statistics.stdev(volumes) if len(volumes) > 1 else 0,
            "max": max(volumes),
            "min": min(volumes),
        }
