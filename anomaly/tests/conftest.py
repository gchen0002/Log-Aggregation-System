"""Pytest configuration and fixtures."""

from collections.abc import Generator
from pathlib import Path

import pytest

from src.config import Settings
from src.db.alert_repository import AlertRepository
from src.db.database import Database
from src.db.log_repository import LogRepository


@pytest.fixture
def temp_db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def temp_model_path(tmp_path: Path) -> Path:
    return tmp_path / "model.pkl"


@pytest.fixture
def settings(temp_db_path: Path, temp_model_path: Path) -> Settings:
    return Settings(
        db_path=str(temp_db_path),
        model_path=str(temp_model_path),
        poll_interval_seconds=1.0,
        batch_size=100,
        min_training_samples=10,
    )


@pytest.fixture
def database(temp_db_path: Path) -> Generator[Database, None, None]:
    db = Database(str(temp_db_path))
    yield db
    db.close()


@pytest.fixture
def log_repo(database: Database) -> LogRepository:
    cursor = database.connection.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            level TEXT NOT NULL,
            source TEXT NOT NULL,
            message TEXT NOT NULL,
            raw TEXT
        )
    """)
    database.connection.commit()
    return LogRepository(database)


@pytest.fixture
def alert_repo(database: Database) -> AlertRepository:
    cursor = database.connection.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            log_id TEXT NOT NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL,
            acknowledged BOOLEAN DEFAULT 0
        )
    """)
    database.connection.commit()
    return AlertRepository(database)


@pytest.fixture
def sample_logs() -> list[dict]:
    from datetime import datetime, timedelta

    now = datetime.utcnow()
    logs = []

    for i in range(50):
        logs.append({
            "id": f"log-{i}",
            "timestamp": (now - timedelta(minutes=i)).isoformat(),
            "level": "info" if i % 5 != 0 else "error",
            "source": "app" if i % 3 == 0 else "api",
            "message": f"Test log message {i}",
            "raw": None,
        })

    return logs


@pytest.fixture
def sample_error_logs() -> list[dict]:
    from datetime import datetime, timedelta

    now = datetime.utcnow()
    logs = []

    for i in range(20):
        logs.append({
            "id": f"error-log-{i}",
            "timestamp": (now - timedelta(seconds=i * 10)).isoformat(),
            "level": "error",
            "source": "app",
            "message": f"Error occurred: exception type {i}",
            "raw": None,
        })

    return logs
