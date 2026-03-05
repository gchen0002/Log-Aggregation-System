"""Configuration management using pydantic-settings."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    db_path: str = "./data/logs.db"
    poll_interval_seconds: float = 30.0
    batch_size: int = 1000
    error_rate_threshold: float = 10.0
    volume_spike_std: float = 3.0
    model_path: str = "./data/anomaly_model.pkl"
    min_training_samples: int = 100
    log_level: str = "INFO"
    contamination_rate: float = 0.05
    training_interval_hours: float = 24.0
    deduplication_window_hours: float = 1.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
