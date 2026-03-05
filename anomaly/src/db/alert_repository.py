"""Alert repository for writing alerts to SQLite database."""

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import structlog

from .database import Database

logger = structlog.get_logger()


@dataclass
class Alert:
    id: str
    log_id: str
    severity: str
    message: str
    details: dict[str, Any] | None
    created_at: str
    acknowledged: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "log_id": self.log_id,
            "severity": self.severity,
            "message": self.message,
            "details": self.details,
            "created_at": self.created_at,
            "acknowledged": self.acknowledged,
        }


class AlertRepository:
    SEVERITY_LEVELS = ["low", "medium", "high", "critical"]

    def __init__(self, db: Database) -> None:
        self.db = db

    def create(
        self,
        log_id: str,
        severity: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> Alert:
        if severity not in self.SEVERITY_LEVELS:
            raise ValueError(f"Invalid severity: {severity}. Must be one of {self.SEVERITY_LEVELS}")

        alert = Alert(
            id=str(uuid.uuid4()),
            log_id=log_id,
            severity=severity,
            message=message,
            details=details,
            created_at=datetime.utcnow().isoformat(),
            acknowledged=False,
        )

        with self.db.get_cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO alerts (id, log_id, severity, message, details, created_at, acknowledged)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    alert.id,
                    alert.log_id,
                    alert.severity,
                    alert.message,
                    json.dumps(alert.details) if alert.details else None,
                    alert.created_at,
                    1 if alert.acknowledged else 0,
                ),
            )
            self.db.connection.commit()

        logger.info(
            "alert_created",
            alert_id=alert.id,
            severity=alert.severity,
            message=alert.message,
        )
        return alert

    def find_recent_similar(
        self,
        pattern: str,
        severity: str,
        hours: float = 1.0,
    ) -> Alert | None:
        since = datetime.utcnow() - timedelta(hours=hours)
        escaped_pattern = pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like_pattern = f"%{escaped_pattern}%"

        row = self.db.execute(
            """
            SELECT id, log_id, severity, message, details, created_at, acknowledged
            FROM alerts
            WHERE severity = ?
              AND acknowledged = 0
              AND created_at >= ?
              AND message LIKE ? ESCAPE '\\'
            LIMIT 1
            """,
            (severity, since.isoformat(), like_pattern),
        ).fetchone()

        if row:
            return self._row_to_alert(row)
        return None

    def find_by_id(self, alert_id: str) -> Alert | None:
        row = self.db.execute(
            """
            SELECT id, log_id, severity, message, details, created_at, acknowledged
            FROM alerts
            WHERE id = ?
            """,
            (alert_id,),
        ).fetchone()

        if row:
            return self._row_to_alert(row)
        return None

    def acknowledge(self, alert_id: str) -> bool:
        with self.db.get_cursor() as cursor:
            cursor.execute(
                "UPDATE alerts SET acknowledged = 1 WHERE id = ?",
                (alert_id,),
            )
            self.db.connection.commit()
            return cursor.rowcount > 0

    def count_unacknowledged(self, severity: str | None = None) -> int:
        if severity:
            row = self.db.execute(
                "SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0 AND severity = ?",
                (severity,),
            ).fetchone()
        else:
            row = self.db.execute(
                "SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0"
            ).fetchone()
        return row["count"] if row else 0

    def get_recent_alerts(self, hours: float = 24.0, limit: int = 100) -> list[Alert]:
        since = datetime.utcnow() - timedelta(hours=hours)
        rows = self.db.execute(
            """
            SELECT id, log_id, severity, message, details, created_at, acknowledged
            FROM alerts
            WHERE created_at >= ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (since.isoformat(), limit),
        ).fetchall()

        return [self._row_to_alert(row) for row in rows]

    def _row_to_alert(self, row: sqlite3.Row) -> Alert:
        details = None
        if row["details"]:
            try:
                details = json.loads(row["details"])
            except json.JSONDecodeError:
                details = None

        return Alert(
            id=row["id"],
            log_id=row["log_id"],
            severity=row["severity"],
            message=row["message"],
            details=details,
            created_at=row["created_at"],
            acknowledged=bool(row["acknowledged"]),
        )
