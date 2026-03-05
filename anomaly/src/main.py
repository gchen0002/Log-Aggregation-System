"""Main FastAPI application for anomaly detection service."""

import logging
import signal
import sys
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import structlog
from fastapi import FastAPI, HTTPException

from .config import get_settings
from .db.alert_repository import AlertRepository
from .db.database import Database
from .db.log_repository import LogRepository
from .detectors.isolation_forest import IsolationForestDetector
from .detectors.statistical import ErrorBurstDetector, SourceAnomalyDetector, VolumeSpikeDetector
from .models.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    HealthResponse,
    ServiceStats,
    TrainRequest,
    TrainResponse,
)
from .models.schemas import (
    AnomalyResult as AnomalyResultSchema,
)
from .workers.polling_worker import PollingWorker


def setup_logging(log_level: str) -> None:
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper()),
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer() if sys.stdout.isatty() else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelName(log_level.upper())
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


logger = structlog.get_logger()

db: Database | None = None
log_repo: LogRepository | None = None
alert_repo: AlertRepository | None = None
worker: PollingWorker | None = None
ml_detector: IsolationForestDetector | None = None
statistical_detectors: list[ErrorBurstDetector | VolumeSpikeDetector | SourceAnomalyDetector] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db, log_repo, alert_repo, worker, ml_detector, statistical_detectors

    settings = get_settings()
    setup_logging(settings.log_level)

    logger.info("service_starting", db_path=settings.db_path)

    db = Database(settings.db_path)
    log_repo = LogRepository(db)
    alert_repo = AlertRepository(db)

    error_detector = ErrorBurstDetector(
        error_rate_threshold=settings.error_rate_threshold,
        window_minutes=5,
    )
    volume_detector = VolumeSpikeDetector(
        spike_std_threshold=settings.volume_spike_std,
        baseline_hours=24.0,
    )
    source_detector = SourceAnomalyDetector(min_logs_per_source=10)

    statistical_detectors = [error_detector, volume_detector, source_detector]

    ml_detector = IsolationForestDetector(
        model_path=settings.model_path,
        contamination=settings.contamination_rate,
        min_training_samples=settings.min_training_samples,
    )

    detectors = [
        error_detector,
        volume_detector,
        source_detector,
        ml_detector,
    ]

    worker = PollingWorker(
        settings=settings,
        log_repo=log_repo,
        alert_repo=alert_repo,
        detectors=detectors,
    )

    def signal_handler(signum, frame):
        logger.info("shutdown_signal_received", signal=signum)
        if worker:
            worker.stop()
        if db:
            db.close()
        sys.exit(0)

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    worker.start()
    logger.info("service_started")

    yield

    logger.info("service_shutting_down")
    if worker:
        worker.stop()
    if db:
        db.close()
    logger.info("service_stopped")


app = FastAPI(
    title="Anomaly Detection Service",
    description="ML-powered anomaly detection for log aggregation system",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="healthy" if worker and worker.is_running() else "unhealthy",
        timestamp=datetime.now(UTC).isoformat(),
    )


@app.get("/stats", response_model=ServiceStats)
async def get_stats() -> ServiceStats:
    if not worker or not log_repo or not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    settings = get_settings()
    worker_stats = worker.get_stats()

    total_logs = log_repo.get_total_count()
    db_stats = {
        "total_logs": total_logs,
        "db_path": settings.db_path,
    }

    model_stats = None
    if ml_detector:
        model_stats = ml_detector.get_stats()

    return ServiceStats(
        status=worker_stats["status"],
        uptime_seconds=worker_stats["uptime_seconds"],
        last_poll=worker_stats["last_poll"],
        polls_count=worker_stats["polls_count"],
        logs_processed=worker_stats["logs_processed"],
        alerts_created=worker_stats["alerts_created"],
        detectors=worker_stats["detectors"],
        database=db_stats,
        model=model_stats,
    )


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_logs(request: AnalyzeRequest) -> AnalyzeResponse:
    if not log_repo:
        raise HTTPException(status_code=503, detail="Service not initialized")

    start_time = time.time()

    from .db.log_repository import LogEntry

    logs = []
    for log_input in request.logs:
        try:
            logs.append(
                LogEntry(
                    id=log_input.id,
                    timestamp=log_input.timestamp,
                    level=log_input.level,
                    source=log_input.source,
                    message=log_input.message,
                    raw=log_input.raw,
                )
            )
        except Exception as e:
            logger.debug("log_parse_error", error=str(e), log_id=log_input.id)
            continue

    anomalies = []

    if request.include_statistical:
        for detector in statistical_detectors:
            try:
                detected = detector.detect(logs)
                anomalies.extend(detected)
            except Exception as e:
                logger.error("analyze_detector_error", detector=detector.name, error=str(e))

    if request.include_ml and ml_detector and ml_detector.model:
        try:
            detected = ml_detector.detect(logs)
            anomalies.extend(detected)
        except Exception as e:
            logger.error("analyze_ml_error", error=str(e))

    elapsed_ms = (time.time() - start_time) * 1000

    return AnalyzeResponse(
        anomalies=[
            AnomalyResultSchema(
                log_id=a.log_id,
                anomaly_type=a.anomaly_type,
                severity=a.severity,
                message=a.message,
                details=a.details,
            )
            for a in anomalies
        ],
        processed_count=len(logs),
        analysis_time_ms=elapsed_ms,
    )


@app.post("/train", response_model=TrainResponse)
async def train_model(request: TrainRequest) -> TrainResponse:
    if not ml_detector or not log_repo:
        raise HTTPException(status_code=503, detail="Service not initialized")

    settings = get_settings()
    min_samples = request.min_samples or settings.min_training_samples

    if ml_detector.model and not request.force:
        return TrainResponse(
            success=False,
            samples_used=0,
            message="Model already trained. Use force=true to retrain.",
        )

    logs = log_repo.fetch_recent_logs(hours=settings.training_interval_hours, limit=10000)

    if len(logs) < min_samples:
        return TrainResponse(
            success=False,
            samples_used=len(logs),
            message=f"Insufficient training data: {len(logs)} logs (minimum: {min_samples})",
        )

    success = ml_detector.train(logs)

    if success:
        return TrainResponse(
            success=True,
            samples_used=len(logs),
            message=f"Model trained successfully with {len(logs)} samples",
        )
    else:
        return TrainResponse(
            success=False,
            samples_used=len(logs),
            message="Training failed",
        )


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(app, host="127.0.0.1", port=5000)
