"""Isolation Forest ML-based anomaly detector."""

from pathlib import Path
from typing import Any

import joblib
import numpy as np
import structlog
from sklearn.ensemble import IsolationForest

from ..db.log_repository import LogEntry
from ..features.extractor import FeatureExtractor
from .base import AnomalyResult, BaseDetector

logger = structlog.get_logger()


class IsolationForestDetector(BaseDetector):
    def __init__(
        self,
        model_path: str,
        contamination: float = 0.05,
        min_training_samples: int = 100,
    ) -> None:
        super().__init__("isolation_forest")
        self.model_path = Path(model_path)
        self.contamination = contamination
        self.min_training_samples = min_training_samples
        self.model: IsolationForest | None = None
        self.extractor = FeatureExtractor()
        self.samples_trained = 0
        self._load_model()

    def _load_model(self) -> None:
        if self.model_path.exists():
            try:
                data = joblib.load(self.model_path)
                self.model = data.get("model")
                self.samples_trained = data.get("samples_trained", 0)
                logger.info(
                    "model_loaded",
                    path=str(self.model_path),
                    samples_trained=self.samples_trained,
                )
            except Exception as e:
                logger.error("model_load_failed", error=str(e))
                self.model = None

    def _save_model(self) -> None:
        if self.model is None:
            return

        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "model": self.model,
                "samples_trained": self.samples_trained,
                "contamination": self.contamination,
            },
            self.model_path,
        )
        logger.info(
            "model_saved",
            path=str(self.model_path),
            samples_trained=self.samples_trained,
        )

    def train(self, logs: list[LogEntry]) -> bool:
        if len(logs) < self.min_training_samples:
            logger.info(
                "training_skipped",
                reason="insufficient_samples",
                log_count=len(logs),
                min_required=self.min_training_samples,
            )
            return False

        log_ids, features = self.extractor.extract_for_ml(logs, include_text=True)
        if not features:
            return False

        X = np.array(features)

        self.model = IsolationForest(
            contamination=self.contamination,
            random_state=42,
            n_estimators=100,
        )
        self.model.fit(X)
        self.samples_trained = len(logs)
        self._save_model()

        logger.info(
            "model_trained",
            samples=len(logs),
            features=X.shape[1],
            contamination=self.contamination,
        )
        return True

    def detect(self, logs: list[LogEntry]) -> list[AnomalyResult]:
        self._record_run()

        if self.model is None:
            logger.debug("model_not_trained", reason="No model available")
            return []

        if not logs:
            return []

        log_ids, features = self.extractor.extract_for_ml(logs, include_text=True)
        if not features:
            return []

        X = np.array(features)

        try:
            predictions = self.model.predict(X)
            scores = self.model.score_samples(X)
        except Exception as e:
            logger.error("prediction_failed", error=str(e))
            return []

        log_map = {log.id: log for log in logs}
        anomalies = []
        for log_id, pred, score in zip(log_ids, predictions, scores, strict=False):
            if pred == -1:
                log = log_map.get(log_id)
                message_preview = log.message[:100] if log else "Unknown"

                result = AnomalyResult(
                    log_id=log_id,
                    anomaly_type="unusual_pattern",
                    severity="medium",
                    message=f"ML detected unusual log pattern: {message_preview}...",
                    details={
                        "anomaly_score": float(score),
                        "log_level": log.level if log else None,
                        "log_source": log.source if log else None,
                    },
                )
                anomalies.append(result)

        if anomalies:
            self._record_alerts(len(anomalies))
            logger.info(
                "ml_anomalies_detected",
                count=len(anomalies),
                total_logs=len(logs),
            )

        return anomalies

    def get_stats(self) -> dict[str, Any]:
        stats = super().get_stats()
        stats.update(
            {
                "model_loaded": self.model is not None,
                "samples_trained": self.samples_trained,
                "contamination": self.contamination,
                "model_path": str(self.model_path),
            }
        )
        return stats
