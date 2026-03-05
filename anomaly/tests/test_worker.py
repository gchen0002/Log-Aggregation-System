"""Tests for polling worker."""

import time
from datetime import datetime

from src.config import Settings
from src.db.alert_repository import AlertRepository
from src.db.log_repository import LogEntry, LogRepository
from src.detectors.base import AnomalyResult, BaseDetector
from src.workers.polling_worker import PollingWorker


class MockDetector(BaseDetector):
    def __init__(self, should_detect: bool = True):
        super().__init__("mock_detector")
        self.should_detect = should_detect
        self.detect_calls = 0

    def detect(self, logs: list[LogEntry]) -> list[AnomalyResult]:
        self._record_run()
        self.detect_calls += 1
        if self.should_detect and logs:
            return [
                AnomalyResult(
                    log_id=logs[0].id,
                    anomaly_type="mock_anomaly",
                    severity="medium",
                    message="Mock anomaly detected",
                    details={"count": len(logs)},
                )
            ]
        return []


class TestPollingWorker:
    def test_worker_stats(self, settings: Settings, log_repo: LogRepository, alert_repo: AlertRepository):
        detector = MockDetector()
        worker = PollingWorker(
            settings=settings,
            log_repo=log_repo,
            alert_repo=alert_repo,
            detectors=[detector],
        )

        stats = worker.get_stats()
        assert stats["status"] == "stopped"
        assert stats["uptime_seconds"] == 0
        assert stats["polls_count"] == 0
        assert stats["logs_processed"] == 0

    def test_worker_start_stop(self, settings: Settings, log_repo: LogRepository, alert_repo: AlertRepository):
        detector = MockDetector()
        worker = PollingWorker(
            settings=settings,
            log_repo=log_repo,
            alert_repo=alert_repo,
            detectors=[detector],
        )

        worker.start()
        assert worker.is_running() is True

        time.sleep(0.5)
        worker.stop()

        stats = worker.get_stats()
        assert stats["status"] == "stopped"

    def test_worker_processes_logs(
        self,
        settings: Settings,
        log_repo: LogRepository,
        alert_repo: AlertRepository,
    ):
        now = datetime.utcnow()
        for i in range(5):
            log_repo.db.execute(
                """
                INSERT INTO logs (id, timestamp, level, source, message, raw)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (f"log-{i}", now.isoformat(), "info", "app", f"Message {i}", None),
            )
        log_repo.db.commit()

        detector = MockDetector(should_detect=True)
        worker = PollingWorker(
            settings=settings,
            log_repo=log_repo,
            alert_repo=alert_repo,
            detectors=[detector],
        )

        worker._poll_and_detect()

        assert detector.detect_calls == 1
        assert worker.logs_processed == 5

    def test_worker_creates_alerts(
        self,
        settings: Settings,
        log_repo: LogRepository,
        alert_repo: AlertRepository,
    ):
        now = datetime.utcnow()
        log_repo.db.execute(
            """
            INSERT INTO logs (id, timestamp, level, source, message, raw)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("log-1", now.isoformat(), "error", "app", "Error message", None),
        )
        log_repo.db.commit()

        detector = MockDetector(should_detect=True)
        worker = PollingWorker(
            settings=settings,
            log_repo=log_repo,
            alert_repo=alert_repo,
            detectors=[detector],
        )

        worker._poll_and_detect()

        assert worker.alerts_created == 1

        alerts = alert_repo.get_recent_alerts(hours=1.0)
        assert len(alerts) == 1
        assert alerts[0].log_id == "log-1"

    def test_worker_deduplicates_alerts(
        self,
        settings: Settings,
        log_repo: LogRepository,
        alert_repo: AlertRepository,
    ):
        now = datetime.utcnow()
        log_repo.db.execute(
            """
            INSERT INTO logs (id, timestamp, level, source, message, raw)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("log-1", now.isoformat(), "error", "app", "Error message", None),
        )
        log_repo.db.commit()

        detector = MockDetector(should_detect=True)
        worker = PollingWorker(
            settings=settings,
            log_repo=log_repo,
            alert_repo=alert_repo,
            detectors=[detector],
        )

        worker._poll_and_detect()
        assert worker.alerts_created == 1

        log_repo.set_last_processed_id(None)
        worker._poll_and_detect()
        assert worker.alerts_created == 1

    def test_worker_handles_detector_error(
        self,
        settings: Settings,
        log_repo: LogRepository,
        alert_repo: AlertRepository,
    ):
        now = datetime.utcnow()
        log_repo.db.execute(
            """
            INSERT INTO logs (id, timestamp, level, source, message, raw)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("log-1", now.isoformat(), "info", "app", "Message", None),
        )
        log_repo.db.commit()

        class FailingDetector(BaseDetector):
            def __init__(self):
                super().__init__("failing")

            def detect(self, logs):
                raise RuntimeError("Detector failed")

        failing = FailingDetector()
        working = MockDetector(should_detect=True)

        worker = PollingWorker(
            settings=settings,
            log_repo=log_repo,
            alert_repo=alert_repo,
            detectors=[failing, working],
        )

        worker._poll_and_detect()

        assert working.detect_calls == 1
        assert worker.logs_processed == 1
