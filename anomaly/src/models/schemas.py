"""Pydantic schemas for API requests and responses."""

from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    version: str = "1.0.0"


class DetectorStats(BaseModel):
    name: str
    enabled: bool
    last_run: str | None
    runs_count: int
    alerts_created: int


class ServiceStats(BaseModel):
    status: str
    uptime_seconds: float
    last_poll: str | None
    polls_count: int
    logs_processed: int
    alerts_created: int
    detectors: list[DetectorStats]
    database: dict[str, Any]
    model: dict[str, Any] | None


class LogInput(BaseModel):
    id: str = Field(default="", max_length=100)
    timestamp: str = Field(default="", max_length=100)
    level: str = Field(default="info", max_length=20)
    source: str = Field(default="unknown", max_length=100)
    message: str = Field(default="", max_length=10000)
    raw: str | None = Field(default=None, max_length=50000)


class AnalyzeRequest(BaseModel):
    logs: list[LogInput] = Field(default_factory=list, max_length=1000)
    include_statistical: bool = True
    include_ml: bool = True


class AnomalyResult(BaseModel):
    log_id: str
    anomaly_type: str
    severity: str
    message: str
    details: dict[str, Any] | None


class AnalyzeResponse(BaseModel):
    anomalies: list[AnomalyResult]
    processed_count: int
    analysis_time_ms: float


class TrainRequest(BaseModel):
    min_samples: int | None = Field(default=None, ge=10, le=100000)
    force: bool = False


class TrainResponse(BaseModel):
    success: bool
    samples_used: int
    message: str
