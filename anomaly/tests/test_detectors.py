"""Tests for statistical detectors."""

from datetime import datetime

from src.db.log_repository import LogEntry
from src.detectors.statistical import ErrorBurstDetector, SourceAnomalyDetector, VolumeSpikeDetector


class TestErrorBurstDetector:
    def test_detect_no_logs(self):
        detector = ErrorBurstDetector(error_rate_threshold=5.0)
        result = detector.detect([])
        assert result == []

    def test_detect_no_error_burst(self, sample_logs):
        detector = ErrorBurstDetector(error_rate_threshold=100.0)
        logs = [LogEntry(**log) for log in sample_logs]
        result = detector.detect(logs)
        assert result == []

    def test_detect_error_burst(self, sample_error_logs):
        detector = ErrorBurstDetector(error_rate_threshold=1.0, window_minutes=5)
        logs = [LogEntry(**log) for log in sample_error_logs]
        result = detector.detect(logs)
        assert len(result) == 1
        assert result[0].anomaly_type == "error_burst"
        assert result[0].severity == "high"

    def test_detector_stats(self):
        detector = ErrorBurstDetector()
        stats = detector.get_stats()
        assert stats["name"] == "error_burst"
        assert stats["enabled"] is True
        assert stats["runs_count"] == 0


class TestVolumeSpikeDetector:
    def test_detect_no_logs(self):
        detector = VolumeSpikeDetector()
        result = detector.detect([])
        assert result == []

    def test_detect_insufficient_logs(self):
        detector = VolumeSpikeDetector()
        logs = [
            LogEntry(id="1", timestamp=datetime.utcnow().isoformat(), level="info", source="app", message="test", raw=None)
            for _ in range(5)
        ]
        result = detector.detect(logs)
        assert result == []

    def test_detect_no_spike(self, sample_logs):
        detector = VolumeSpikeDetector(spike_std_threshold=10.0)
        logs = [LogEntry(**log) for log in sample_logs]
        result = detector.detect(logs)
        assert result == []


class TestSourceAnomalyDetector:
    def test_detect_no_logs(self):
        detector = SourceAnomalyDetector()
        result = detector.detect([])
        assert result == []

    def test_detect_insufficient_logs(self):
        detector = SourceAnomalyDetector(min_logs_per_source=100)
        logs = [
            LogEntry(id="1", timestamp=datetime.utcnow().isoformat(), level="info", source="app", message="test", raw=None)
            for _ in range(10)
        ]
        result = detector.detect(logs)
        assert result == []

    def test_detect_source_anomaly(self):
        detector = SourceAnomalyDetector(min_logs_per_source=5)
        now = datetime.utcnow()
        logs = [
            LogEntry(
                id=f"log-{i}",
                timestamp=now.isoformat(),
                level="info",
                source="dominant-source",
                message="test",
                raw=None,
            )
            for i in range(90)
        ]
        logs.extend([
            LogEntry(
                id=f"log-other-{i}",
                timestamp=now.isoformat(),
                level="info",
                source="other",
                message="test",
                raw=None,
            )
            for i in range(10)
        ])
        result = detector.detect(logs)
        assert len(result) == 1
        assert result[0].anomaly_type == "source_anomaly"
        assert result[0].severity == "low"
