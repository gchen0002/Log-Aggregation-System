"""Tests for database repositories."""

from datetime import datetime, timedelta

import pytest

from src.db.alert_repository import AlertRepository
from src.db.log_repository import LogRepository


class TestLogRepository:
    def test_insert_and_fetch_logs(self, log_repo: LogRepository):
        now = datetime.utcnow()
        for i in range(10):
            log_repo.db.execute(
                """
                INSERT INTO logs (id, timestamp, level, source, message, raw)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (f"log-{i}", (now - timedelta(minutes=i)).isoformat(), "info", "app", f"Message {i}", None),
            )
        log_repo.db.commit()

        logs = log_repo.fetch_logs_since(None, limit=5)
        assert len(logs) == 5

    def test_fetch_logs_since_id(self, log_repo: LogRepository):
        now = datetime.utcnow()
        for i in range(10):
            log_repo.db.execute(
                """
                INSERT INTO logs (id, timestamp, level, source, message, raw)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (f"log-{i}", (now - timedelta(minutes=i)).isoformat(), "info", "app", f"Message {i}", None),
            )
        log_repo.db.commit()

        logs = log_repo.fetch_logs_since("log-4", limit=10)
        assert len(logs) == 5
        assert logs[0].id == "log-5"

    def test_last_processed_id(self, log_repo: LogRepository):
        assert log_repo.get_last_processed_id() is None

        log_repo.set_last_processed_id("log-123")
        assert log_repo.get_last_processed_id() == "log-123"

        log_repo.set_last_processed_id("log-456")
        assert log_repo.get_last_processed_id() == "log-456"

    def test_get_log_count_by_level(self, log_repo: LogRepository):
        now = datetime.utcnow()
        levels = ["info", "info", "error", "warn", "info", "error"]
        for i, level in enumerate(levels):
            log_repo.db.execute(
                """
                INSERT INTO logs (id, timestamp, level, source, message, raw)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (f"log-{i}", (now - timedelta(minutes=i)).isoformat(), level, "app", f"Message {i}", None),
            )
        log_repo.db.commit()

        counts = log_repo.get_log_count_by_level(now - timedelta(hours=1))
        assert counts["info"] == 3
        assert counts["error"] == 2
        assert counts["warn"] == 1


class TestAlertRepository:
    def test_create_alert(self, alert_repo: AlertRepository):
        alert = alert_repo.create(
            log_id="log-1",
            severity="high",
            message="Test alert",
            details={"key": "value"},
        )

        assert alert.id is not None
        assert alert.log_id == "log-1"
        assert alert.severity == "high"
        assert alert.message == "Test alert"
        assert alert.details == {"key": "value"}
        assert alert.acknowledged is False

    def test_create_alert_invalid_severity(self, alert_repo: AlertRepository):
        with pytest.raises(ValueError, match="Invalid severity"):
            alert_repo.create(
                log_id="log-1",
                severity="invalid",
                message="Test",
            )

    def test_find_by_id(self, alert_repo: AlertRepository):
        created = alert_repo.create(
            log_id="log-1",
            severity="medium",
            message="Test alert",
        )

        found = alert_repo.find_by_id(created.id)
        assert found is not None
        assert found.id == created.id

        not_found = alert_repo.find_by_id("nonexistent")
        assert not_found is None

    def test_acknowledge(self, alert_repo: AlertRepository):
        alert = alert_repo.create(
            log_id="log-1",
            severity="low",
            message="Test",
        )

        assert alert_repo.acknowledge(alert.id) is True
        assert alert_repo.acknowledge("nonexistent") is False

        found = alert_repo.find_by_id(alert.id)
        assert found is not None
        assert found.acknowledged is True

    def test_find_recent_similar(self, alert_repo: AlertRepository):
        alert_repo.create(
            log_id="log-1",
            severity="high",
            message="Error rate threshold exceeded: 15 errors/min",
        )

        similar = alert_repo.find_recent_similar(
            pattern="Error rate threshold",
            severity="high",
            hours=1.0,
        )
        assert similar is not None

        different = alert_repo.find_recent_similar(
            pattern="Completely different message",
            severity="high",
            hours=1.0,
        )
        assert different is None

    def test_count_unacknowledged(self, alert_repo: AlertRepository):
        alert_repo.create(log_id="log-1", severity="high", message="Alert 1")
        alert_repo.create(log_id="log-2", severity="medium", message="Alert 2")
        alert_repo.create(log_id="log-3", severity="high", message="Alert 3")

        assert alert_repo.count_unacknowledged() == 3
        assert alert_repo.count_unacknowledged(severity="high") == 2

    def test_get_recent_alerts(self, alert_repo: AlertRepository):
        for i in range(5):
            alert_repo.create(
                log_id=f"log-{i}",
                severity="low",
                message=f"Alert {i}",
            )

        alerts = alert_repo.get_recent_alerts(hours=1.0, limit=3)
        assert len(alerts) == 3
