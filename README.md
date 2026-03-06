# Log Aggregation System

A distributed log aggregation system similar to Splunk/Datadog, built with C++, TypeScript, and Python.

## Features

- **High-throughput log collection** - C++ agent tails log files and batches entries
- **Custom message queue** - Persistent queue for reliable log delivery
- **Full-text search** - SQLite FTS5 for fast log queries
- **ML anomaly detection** - Python service with Isolation Forest
- **Real-time dashboard** - Next.js frontend with observability UI

## Tech Stack

| Component | Technology |
|-----------|------------|
| Log Agent | C++17, Winsock |
| Message Queue | C++17, Thread Pool |
| API Server | TypeScript, Node.js, Express |
| Storage | SQLite + FTS5 |
| Anomaly Detection | Python, FastAPI, scikit-learn |
| Frontend | Next.js 15, React, Tailwind CSS |
| Deployment | Docker Compose |

## Quick Start

### Prerequisites

- C++17 compiler (MSVC on Windows)
- CMake 3.16+
- Node.js 20+
- Python 3.11+
- Docker Desktop (optional, for containerized deployment)

### Option 1: Windows Batch Scripts (Recommended)

**Full local development stack:**
```cmd
test-local.bat
```
Starts API, anomaly service, and frontend locally with health checks.

**Start services individually:**
```cmd
start-local.bat    # Start all services in background
stop-local.bat     # Stop all running services
```

**Full Docker stack:**
```cmd
test-docker.bat
```
Builds and starts all containers with health checks.

### Option 2: Docker Compose

```bash
cd docker
docker-compose up --build
```

Services:
- Frontend: http://localhost:3001
- API: http://localhost:3000
- Anomaly: http://localhost:8000
- Queue: http://localhost:8080

### Option 3: Run Services Individually

**C++ Agent:**
```bash
cd agent && mkdir -p build && cd build && cmake .. && cmake --build . --config Debug
./Debug/log_agent.exe --file test.log --queue-host localhost --queue-port 8080
```

**C++ Queue:**
```bash
cd queue && mkdir -p build && cd build && cmake .. && cmake --build . --config Debug
./Debug/log_queue.exe --port 8080 --db ./data/queue.db
```

**TypeScript API:**
```bash
cd api && npm install && npm run dev
```

**Python Anomaly Detection:**
```bash
cd anomaly
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python -m src.main
```

**Next.js Frontend:**
```bash
cd frontend && npm install && npm run dev
```

## Development Scripts

| Script | Purpose |
|--------|---------|
| `test-local.bat` | Start local dev stack with health checks |
| `test-docker.bat` | Start Docker stack with health checks |
| `start-local.bat` | Start services in background |
| `stop-local.bat` | Stop all running services |
| `api/scripts/seed.ts` | Generate dummy log/alert data |

## Testing

### API Tests
```bash
cd api
npm test                           # All tests
npm test -- logs.test.ts           # Single file
npm test -- --testNamePattern="logs"  # Pattern match
```

### Anomaly Tests
```bash
cd anomaly
venv\Scripts\activate
pytest                             # All tests
pytest -v                          # Verbose output
```

### C++ Integration Test
```bash
cd queue/build/Debug
mkdir -p data
./log_queue.exe --port 8080 --db ./data/queue.db &
curl -X POST http://localhost:8080/api/logs/batch \
  -H "Content-Type: application/json" \
  -d "[\"log1\",\"log2\",\"log3\"]"
curl http://localhost:8080/api/logs/pending
```

## API Endpoints

### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/logs` | Ingest single log |
| POST | `/api/logs/batch` | Ingest log batch |
| GET | `/api/logs` | Search logs with filters |
| GET | `/api/logs/stats` | Get log statistics |

**Query Parameters (GET /api/logs):**
- `q` - Full-text search query
- `level` - Filter by log level (ERROR, WARN, INFO, DEBUG)
- `source` - Filter by source
- `start` / `end` - Time range (ISO 8601)
- `limit` / `offset` - Pagination

### Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alerts` | List alerts |
| GET | `/api/alerts/:id` | Get single alert |
| PUT | `/api/alerts/:id/acknowledge` | Acknowledge alert |

### Anomaly Detection

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health check |
| GET | `/status` | Detector status and metrics |
| POST | `/detect` | Trigger manual detection |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Log Agent  │────▶│  C++ Queue   │────▶│  Node.js API    │
│   (C++)     │     │   (Custom)   │     │   (TypeScript)  │
└─────────────┘     └──────────────┘     └─────────────────┘
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ▼                     ▼                     ▼
                   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
                   │   SQLite    │      │   Python    │      │  Frontend   │
                   │   + FTS5    │      │  Anomaly    │      │  (Next.js)  │
                   └─────────────┘      └─────────────┘      └─────────────┘
```

**Data Flow:**
1. Agent tails log files and sends batches to Queue
2. Queue persists logs and exposes HTTP API
3. API consumer polls Queue and writes to SQLite with FTS5
4. Anomaly service reads logs, detects anomalies, writes alerts
5. Frontend displays logs, stats, and alerts in real-time

## Environment Variables

### API (`api/.env`)
```
PORT=3000
QUEUE_HOST=localhost
QUEUE_PORT=8080
DB_PATH=./data/logs.db
POLL_INTERVAL_MS=1000
```

### Anomaly (`anomaly/.env`)
```
API_BASE_URL=http://localhost:3000
DB_PATH=./data/logs.db
POLL_INTERVAL_SECONDS=30
```

### Frontend (`frontend/.env.local`)
```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Linting & Formatting

```bash
# API
cd api && npm run lint

# Frontend
cd frontend && npm run lint

# Python
cd anomaly && black src/ && flake8 src/
```

## License

MIT
