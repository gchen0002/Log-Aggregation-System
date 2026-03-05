"""Background polling worker for anomaly detection."""

import threading
from datetime import UTC, datetime
from typing import Any

import structlog

from ..config import Settings
from ..db.alert_repository import AlertRepository
from ..db.log_repository import LogRepository
from ..detectors.base import AnomalyResult, BaseDetector

logger = structlog.get_logger()


class PollingWorker:
    def __init__(
        self,
        settings: Settings,
        log_repo: LogRepository,
        alert_repo: AlertRepository,
        detectors: list[BaseDetector],
    ) -> None:
        self.settings = settings
        self.log_repo = log_repo
        self.alert_repo = alert_repo
        self.detectors = detectors
        self._running_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._shutdown_event = threading.Event()
        self._state_lock = threading.Lock()

        self.last_poll: datetime | None = None
        self.polls_count = 0
        self.logs_processed = 0
        self.alerts_created = 0
        self.start_time: datetime | None = None

    def is_running(self) -> bool:
        return self._running_event.is_set()

    def start(self) -> None:
        if self._running_event.is_set():
            logger.warning("worker_already_running")
            return

        self._running_event.set()
        with self._state_lock:
            self.start_time = datetime.now(UTC)
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info("worker_started", poll_interval=self.settings.poll_interval_seconds)

    def stop(self) -> None:
        if not self._running_event.is_set():
            return

        self._running_event.clear()
        self._shutdown_event.set()

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)

        logger.info("worker_stopped")

    def _run_loop(self) -> None:
        logger.info("worker_loop_started")

        while self._running_event.is_set() and not self._shutdown_event.is_set():
            try:
                self._poll_and_detect()
            except Exception as e:
                logger.error("poll_error", error=str(e), exc_info=True)

            self._shutdown_event.wait(timeout=self.settings.poll_interval_seconds)

        logger.info("worker_loop_ended")

    def _poll_and_detect(self) -> None:
        with self._state_lock:
            self.last_poll = datetime.now(UTC)
            self.polls_count += 1

        last_id = self.log_repo.get_last_processed_id()
        logs = self.log_repo.fetch_logs_since(last_id, limit=self.settings.batch_size)

        if not logs:
            logger.debug("no_new_logs")
            return

        logger.info("logs_fetched", count=len(logs))
        with self._state_lock:
            self.logs_processed += len(logs)

        all_anomalies: list[AnomalyResult] = []
        for detector in self.detectors:
            if not detector.enabled:
                continue

            try:
                anomalies = detector.detect(logs)
                all_anomalies.extend(anomalies)
            except Exception as e:
                logger.error(
                    "detector_error",
                    detector=detector.name,
                    error=str(e),
                    exc_info=True,
                )

        for anomaly in all_anomalies:
            self._create_alert(anomaly)

        if logs:
            self.log_repo.set_last_processed_id(logs[-1].id)

        logger.info(
            "poll_complete",
            logs_processed=len(logs),
            anomalies_found=len(all_anomalies),
        )

    def _create_alert(self, anomaly: AnomalyResult) -> None:
        existing = self.alert_repo.find_recent_similar(
            pattern=anomaly.message[:50],
            severity=anomaly.severity,
            hours=self.settings.deduplication_window_hours,
        )

        if existing:
            logger.debug(
                "alert_skipped_duplicate",
                anomaly_type=anomaly.anomaly_type,
                existing_id=existing.id,
            )
            return

        try:
            self.alert_repo.create(
                log_id=anomaly.log_id,
                severity=anomaly.severity,
                message=anomaly.message,
                details=anomaly.details,
            )
            with self._state_lock:
                self.alerts_created += 1
        except Exception as e:
            logger.error(
                "alert_creation_failed",
                anomaly_type=anomaly.anomaly_type,
                error=str(e),
            )

    def get_stats(self) -> dict[str, Any]:
        uptime = 0.0
        with self._state_lock:
            if self.start_time:
                uptime = (datetime.now(UTC) - self.start_time).total_seconds()

        return {
            "status": "running" if self._running_event.is_set() else "stopped",
            "uptime_seconds": uptime,
            "last_poll": self.last_poll.isoformat() if self.last_poll else None,
            "polls_count": self.polls_count,
            "logs_processed": self.logs_processed,
            "alerts_created": self.alerts_created,
            "detectors": [d.get_stats() for d in self.detectors],
        }
