"""Feature extraction for anomaly detection."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog

from ..db.log_repository import LogEntry

logger = structlog.get_logger()


@dataclass
class ExtractedFeatures:
    log_id: str
    timestamp: str
    statistical: dict[str, Any]
    text_features: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "log_id": self.log_id,
            "timestamp": self.timestamp,
            "statistical": self.statistical,
            "text_features": self.text_features,
        }


class FeatureExtractor:
    def __init__(self) -> None:
        self._level_mapping = {"debug": 0, "info": 1, "warn": 2, "error": 3}

    def _parse_hour(self, timestamp: str) -> int:
        try:
            ts = timestamp
            if ts.endswith("Z"):
                ts = ts[:-1] + "+00:00"
            return datetime.fromisoformat(ts).hour
        except (ValueError, AttributeError):
            return 12

    def extract_statistical(self, logs: list[LogEntry]) -> list[ExtractedFeatures]:
        features = []
        for log in logs:
            hour = self._parse_hour(log.timestamp)
            features.append(
                ExtractedFeatures(
                    log_id=log.id,
                    timestamp=log.timestamp,
                    statistical={
                        "level_encoded": self._level_mapping.get(log.level.lower(), 1),
                        "message_length": len(log.message),
                        "hour_of_day": hour,
                        "is_business_hours": 9 <= hour <= 17,
                    },
                )
            )
        return features

    def extract_text_features(self, logs: list[LogEntry]) -> list[ExtractedFeatures]:
        features = self.extract_statistical(logs)
        for i, log in enumerate(logs):
            words = log.message.lower().split()
            features[i].text_features = {
                "word_count": len(words),
                "unique_words": len(set(words)),
                "has_error_keywords": any(
                    kw in log.message.lower()
                    for kw in ["error", "exception", "failed", "timeout", "crash"]
                ),
                "has_warning_keywords": any(
                    kw in log.message.lower()
                    for kw in ["warn", "warning", "deprecated", "slow"]
                ),
            }
        return features

    def extract_for_ml(
        self, logs: list[LogEntry], include_text: bool = True
    ) -> tuple[list[str], list[list[float]]]:
        if include_text:
            features = self.extract_text_features(logs)
        else:
            features = self.extract_statistical(logs)

        log_ids = []
        feature_vectors = []

        for f in features:
            log_ids.append(f.log_id)
            vector = list(f.statistical.values())
            if f.text_features:
                vector.extend(f.text_features.values())
            feature_vectors.append([float(v) for v in vector])

        return log_ids, feature_vectors
