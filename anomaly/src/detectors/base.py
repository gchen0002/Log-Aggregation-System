"""Base detector interface."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ..db.log_repository import LogEntry


@dataclass
class AnomalyResult:
    log_id: str
    anomaly_type: str
    severity: str
    message: str
    details: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "log_id": self.log_id,
            "anomaly_type": self.anomaly_type,
            "severity": self.severity,
            "message": self.message,
            "details": self.details,
        }


class BaseDetector(ABC):
    def __init__(self, name: str) -> None:
        self.name = name
        self.enabled = True
        self.last_run: datetime | None = None
        self.runs_count = 0
        self.alerts_created = 0

    @abstractmethod
    def detect(self, logs: list[LogEntry]) -> list[AnomalyResult]:
        pass

    def train(self, logs: list[LogEntry]) -> None:
        """Optional training method for ML-based detectors."""
        pass

    def _record_run(self) -> None:
        self.last_run = datetime.utcnow()
        self.runs_count += 1

    def _record_alerts(self, count: int) -> None:
        self.alerts_created += count

    def get_stats(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "enabled": self.enabled,
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "runs_count": self.runs_count,
            "alerts_created": self.alerts_created,
        }
