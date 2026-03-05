"""Statistical anomaly detectors."""

import statistics
from datetime import UTC, datetime, timedelta

import structlog

from ..db.log_repository import LogEntry
from .base import AnomalyResult, BaseDetector

logger = structlog.get_logger()


class ErrorBurstDetector(BaseDetector):
    def __init__(
        self,
        error_rate_threshold: float = 10.0,
        window_minutes: int = 5,
    ) -> None:
        super().__init__("error_burst")
        self.error_rate_threshold = error_rate_threshold
        self.window_minutes = window_minutes

    def detect(self, logs: list[LogEntry]) -> list[AnomalyResult]:
        self._record_run()
        if not logs:
            return []

        cutoff = datetime.now(UTC) - timedelta(minutes=self.window_minutes)
        recent_errors = 0
        total_recent = 0

        for log in logs:
            try:
                ts = log.timestamp
                if ts.endswith("Z"):
                    ts = ts[:-1] + "+00:00"
                log_time = datetime.fromisoformat(ts)
                if log_time.tzinfo is None:
                    log_time = log_time.replace(tzinfo=UTC)
                if log_time >= cutoff:
                    total_recent += 1
                    if log.level.lower() == "error":
                        recent_errors += 1
            except (ValueError, AttributeError):
                continue

        if total_recent == 0:
            return []

        errors_per_minute = recent_errors / self.window_minutes

        if errors_per_minute > self.error_rate_threshold:
            result = AnomalyResult(
                log_id="system",
                anomaly_type="error_burst",
                severity="high",
                message=f"High error rate detected: {errors_per_minute:.2f} errors/minute ({recent_errors} errors in {self.window_minutes} minutes)",
                details={
                    "error_count": recent_errors,
                    "total_count": total_recent,
                    "errors_per_minute": errors_per_minute,
                    "threshold": self.error_rate_threshold,
                    "window_minutes": self.window_minutes,
                },
            )
            self._record_alerts(1)
            logger.warning(
                "error_burst_detected",
                errors_per_minute=errors_per_minute,
                threshold=self.error_rate_threshold,
            )
            return [result]

        return []


class VolumeSpikeDetector(BaseDetector):
    def __init__(
        self,
        spike_std_threshold: float = 3.0,
        baseline_hours: float = 24.0,
    ) -> None:
        super().__init__("volume_spike")
        self.spike_std_threshold = spike_std_threshold
        self.baseline_hours = baseline_hours

    def detect(self, logs: list[LogEntry]) -> list[AnomalyResult]:
        self._record_run()
        if len(logs) < 10:
            return []

        hourly_counts: dict[str, int] = {}
        for log in logs:
            try:
                ts = log.timestamp
                if ts.endswith("Z"):
                    ts = ts[:-1] + "+00:00"
                log_time = datetime.fromisoformat(ts)
                hour_key = log_time.strftime("%Y-%m-%d %H:00")
                hourly_counts[hour_key] = hourly_counts.get(hour_key, 0) + 1
            except (ValueError, AttributeError):
                continue

        if len(hourly_counts) < 2:
            return []

        counts = list(hourly_counts.values())
        mean_count = statistics.mean(counts)
        std_count = statistics.stdev(counts) if len(counts) > 1 else 0

        if std_count == 0:
            return []

        current_hour = datetime.now(UTC).strftime("%Y-%m-%d %H:00")
        current_count = hourly_counts.get(current_hour, 0)
        z_score = (current_count - mean_count) / std_count

        if z_score > self.spike_std_threshold:
            result = AnomalyResult(
                log_id="system",
                anomaly_type="volume_spike",
                severity="medium",
                message=f"Log volume spike detected: {current_count} logs this hour ({z_score:.2f} standard deviations above mean)",
                details={
                    "current_count": current_count,
                    "mean_count": mean_count,
                    "std_count": std_count,
                    "z_score": z_score,
                    "threshold": self.spike_std_threshold,
                },
            )
            self._record_alerts(1)
            logger.warning(
                "volume_spike_detected",
                current_count=current_count,
                mean_count=mean_count,
                z_score=z_score,
            )
            return [result]

        return []


class SourceAnomalyDetector(BaseDetector):
    def __init__(self, min_logs_per_source: int = 10) -> None:
        super().__init__("source_anomaly")
        self.min_logs_per_source = min_logs_per_source

    def detect(self, logs: list[LogEntry]) -> list[AnomalyResult]:
        self._record_run()
        if len(logs) < self.min_logs_per_source:
            return []

        source_counts: dict[str, int] = {}
        for log in logs:
            source_counts[log.source] = source_counts.get(log.source, 0) + 1

        total = len(logs)
        anomalies = []

        for source, count in source_counts.items():
            ratio = count / total
            if count >= self.min_logs_per_source and ratio > 0.8:
                result = AnomalyResult(
                    log_id="system",
                    anomaly_type="source_anomaly",
                    severity="low",
                    message=f"Unusual source distribution: '{source}' accounts for {ratio*100:.1f}% of logs",
                    details={
                        "source": source,
                        "count": count,
                        "ratio": ratio,
                        "total_logs": total,
                    },
                )
                anomalies.append(result)
                logger.info(
                    "source_anomaly_detected",
                    source=source,
                    count=count,
                    ratio=ratio,
                )

        if anomalies:
            self._record_alerts(len(anomalies))
        return anomalies
