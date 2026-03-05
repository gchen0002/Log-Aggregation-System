"""Tests for Isolation Forest ML detector."""

from datetime import datetime

from src.db.log_repository import LogEntry
from src.detectors.isolation_forest import IsolationForestDetector


class TestIsolationForestDetector:
    def test_init_no_model(self, temp_model_path):
        detector = IsolationForestDetector(
            model_path=str(temp_model_path),
            min_training_samples=10,
        )
        assert detector.model is None
        assert detector.samples_trained == 0

    def test_train_insufficient_samples(self, temp_model_path):
        detector = IsolationForestDetector(
            model_path=str(temp_model_path),
            min_training_samples=100,
        )
        logs = [
            LogEntry(
                id=f"log-{i}",
                timestamp=datetime.utcnow().isoformat(),
                level="info",
                source="app",
                message=f"Test message {i}",
                raw=None,
            )
            for i in range(10)
        ]
        result = detector.train(logs)
        assert result is False
        assert detector.model is None

    def test_train_success(self, temp_model_path):
        detector = IsolationForestDetector(
            model_path=str(temp_model_path),
            min_training_samples=10,
        )
        logs = [
            LogEntry(
                id=f"log-{i}",
                timestamp=datetime.utcnow().isoformat(),
                level="info" if i % 4 != 0 else "error",
                source="app" if i % 3 == 0 else "api",
                message=f"Test log message with some content {i}",
                raw=None,
            )
            for i in range(50)
        ]
        result = detector.train(logs)
        assert result is True
        assert detector.model is not None
        assert detector.samples_trained == 50

    def test_detect_no_model(self, temp_model_path, sample_logs):
        detector = IsolationForestDetector(
            model_path=str(temp_model_path),
            min_training_samples=10,
        )
        logs = [LogEntry(**log) for log in sample_logs]
        result = detector.detect(logs)
        assert result == []

    def test_detect_with_model(self, temp_model_path):
        detector = IsolationForestDetector(
            model_path=str(temp_model_path),
            min_training_samples=10,
            contamination=0.1,
        )

        train_logs = [
            LogEntry(
                id=f"train-{i}",
                timestamp=datetime.utcnow().isoformat(),
                level="info",
                source="app",
                message=f"Normal log message {i}",
                raw=None,
            )
            for i in range(100)
        ]
        detector.train(train_logs)

        test_logs = train_logs[:50]
        test_logs.append(
            LogEntry(
                id="anomaly-1",
                timestamp=datetime.utcnow().isoformat(),
                level="error",
                source="unknown",
                message="CRITICAL ERROR EXCEPTION FAILED TIMEOUT CRASH",
                raw=None,
            )
        )

        detector.detect(test_logs)
        assert detector.runs_count == 1

    def test_model_persistence(self, temp_model_path):
        detector1 = IsolationForestDetector(
            model_path=str(temp_model_path),
            min_training_samples=10,
        )

        logs = [
            LogEntry(
                id=f"log-{i}",
                timestamp=datetime.utcnow().isoformat(),
                level="info",
                source="app",
                message=f"Test message {i}",
                raw=None,
            )
            for i in range(50)
        ]
        detector1.train(logs)

        detector2 = IsolationForestDetector(
            model_path=str(temp_model_path),
            min_training_samples=10,
        )
        assert detector2.model is not None
        assert detector2.samples_trained == 50

    def test_get_stats(self, temp_model_path):
        detector = IsolationForestDetector(
            model_path=str(temp_model_path),
            contamination=0.05,
        )
        stats = detector.get_stats()
        assert stats["name"] == "isolation_forest"
        assert stats["model_loaded"] is False
        assert stats["contamination"] == 0.05
