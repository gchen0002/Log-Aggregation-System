# Log Aggregation System

A distributed log aggregation system similar to Splunk/Datadog, built with C++, TypeScript, and Python.

## Features

- **High-throughput log collection** - C++ agent tails log files and batches entries
- **Custom message queue** - Persistent queue for reliable log delivery
- **Full-text search** - SQLite FTS5 for fast log queries
- **ML anomaly detection** - Python service detects unusual patterns
- **Real-time dashboard** - Next.js frontend with D3.js visualizations

## Tech Stack

| Component | Technology |
|-----------|------------|
| Log Agent | C++17, Winsock |
| Message Queue | C++17, Thread Pool |
| API Server | TypeScript, Node.js, Express |
| Storage | SQLite + FTS5 |
| Anomaly Detection | Python, scikit-learn |
| Frontend | Next.js, React, D3.js |
| Deployment | Docker, AWS EC2 |

## Quick Start

### Prerequisites
- C++17 compiler
- CMake 3.16+
- Node.js 20+
- Python 3.11+
- Docker (optional)

### Run with Docker

```bash
cd docker
docker-compose up --build
```

- Frontend: http://localhost:3001
- API: http://localhost:3000

### Run Services Individually

```bash
# Build and run C++ components
cd agent && mkdir build && cd build && cmake .. && cmake --build .
./log_agent

cd ../../queue && mkdir build && cd build && cmake .. && cmake --build .
./log_queue

# Run API
cd ../../api && npm install && npm run dev

# Run anomaly detection
cd ../anomaly && pip install -r requirements.txt && python src/detector.py

# Run frontend
cd ../frontend && npm install && npm run dev
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/logs | Ingest logs |
| GET | /api/logs | Search logs |
| GET | /api/logs/stats | Get statistics |
| GET | /api/alerts | List alerts |

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

## License

MIT
