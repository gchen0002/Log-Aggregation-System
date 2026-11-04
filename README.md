# Log aggregation and investigation

A local log pipeline with a C++20 file agent and durable SQLite queue, a Node.js indexing worker and API, Python anomaly detection, and an interactive Next.js workspace.

## Run locally

Install Node.js 22 LTS, Python 3.12, and a C++20 compiler. On Linux, install the compiler toolchain (`build-essential` on Debian/Ubuntu). On Windows, install Visual Studio 2022 Build Tools with **Desktop development with C++** and the Windows SDK. Python and Node must be on PATH.

From the repository root, run once:

```sh
npm run setup
```

Then start the simulation and every service together:

```sh
npm run dev
```

Open **http://localhost:3001**. The command builds the native executables and API, starts the queue, agent, indexer, detector, and UI, then generates 5,000 logs/sec. Ctrl+C stops the processes it owns. Startup refuses occupied ports; it does not terminate unrelated processes. The first native build downloads pinned dependency releases and takes longer.

No BAT startup sequence is required. Earlier component launchers and source files are retained for reference; the root commands use the current pipeline.

```sh
npm run dev -- --rate=20000
```

Runtime data, logs, checkpoints, and the local anomaly model live in `.runtime/demo`. Use a new `DATA_DIR` for an isolated run. `API_PORT`, `QUEUE_PORT`, `ANOMALY_PORT`, and `FRONTEND_PORT` override ports; set them using your shell's environment syntax. The defaults are 3000, 8081, 5000, and 3001 respectively. API, queue, and detector bind to loopback in the local launcher. The development UI listens on all interfaces for VM preview access.

## Workspace

- **Explore:** literal phrase search, severity/source/time filters, cursor pagination, original event data, parsed fields, and links to individual historical events.
- **Overview:** measured acceptance/indexing rates, durable backlog, observed API search latency, source shares, component health, and open alerts.
- **Alerts:** a three-pane investigation layout with an alert queue, detection evidence, and related logs. Acknowledgment persists in SQLite. New alerts do not replace the alert being inspected.

Charts use actual observations. The renderer moves smoothly between samples without inventing extra measurements, preserves gaps, and supports exact sample inspection, series toggles, and reduced motion. Search percentiles are a rolling sample of observed search requests, not a promised latency. History accumulates while the workspace is open and persists across its navigation links.

Each animated pipeline bead represents **10,000 logs** crossing that stage, using durable counters. The view does not replay the initial database total as new traffic. Pausing freezes frontend polling and motion; ingestion and detection continue in the background. Alert-related log rows are a bounded sample from the evidence window, separate from the detector's full error-event count.

## Delivery and storage

```text
NDJSON / text file → C++20 agent → SQLite durable queue
                                      ↓ leased batches
                               Node indexing worker
                                      ↓ committed rows
                               SQLite WAL + FTS5
                                 ↙           ↘
                            REST API      Python detectors
                                 ↓
                       Explore / Overview / Alerts
```

The agent coalesces input into bounded batches and preserves original event payloads. Checkpoints are replaced atomically after durable queue acceptance. File identity and byte offsets supply stable event IDs when the input has none. Truncation and file replacement are detected; incomplete trailing lines wait for a newline. Overlong or permanently rejected input fails explicitly without advancing its checkpoint.

The queue uses WAL with `synchronous=FULL`, transactional capacity checks, payload-bound batch receipts, expiring leases, and token-fenced acknowledgments. An expired consumer cannot acknowledge a new consumer's lease. Capacity pressure returns HTTP 429 and the agent retries while keeping the source position unchanged.

The indexing worker commits valid rows and quarantined invalid records before acknowledging. Stable IDs make re-delivery idempotent. The delivery contract is **at least once**, with duplicate suppression in the index. Malformed records are retained in `rejected_logs`; they do not silently disappear or prevent valid records from advancing. Receipts and indexed logs currently have no automatic retention policy, so storage grows with the run.

The API stays on a separate connection and worker thread from ingestion. FTS5 phrase search uses a bounded recent slice with a complete global fallback. Cursor pages are ordered by timestamp and rowid and bound to the search filters. The UI freezes older pages while paging so new traffic does not repeatedly shift them.

Python tracks incremental input by insertion order rather than UUID sort order. Error-rate evidence is computed over the complete rolling database window; volume comparisons use historical hourly aggregates. Source-distribution and model detectors operate on sampled polling batches. Statistical alerts describe observations and thresholds, not verified incidents.

This is a local demonstration without authentication or multi-tenant isolation. Keep the service ports private when running outside your machine.

## Verification

```sh
npm run build             # native Release, API TypeScript, production UI
npm test                  # API, frontend, Python, cross-process recovery tests
npm run test:integration  # queue/agent/indexer crash and replay scenarios
npm run test:ui           # real npm run dev startup, proxies, workflow API, shutdown
npm run bench -- --count=100000 --rate=20000 --seconds=15
```

The integration suite exercises source replay, fragmented HTTP bodies, payload conflicts, queue crashes, lease expiry and stale acknowledgments, consumer crashes, source replacement, incomplete and oversized lines, poison records, capacity backpressure, cursor uniqueness, and SQLite integrity. Tests use isolated runtime directories and ports.

GitHub Actions builds and runs the same entrypoints on Ubuntu and Windows, plus a Linux Docker deployment. A Linux VM run alone does not establish Windows compatibility; check the workflow results for the branch.

Benchmark output is written to `benchmarks/latest.json`, with per-run artifacts under `.runtime/bench-*`. Results include HTTP search p50/p95, bulk startup time, paced delivery including drain time, queue observations, environment, and durability settings. The benchmark excludes the UI and anomaly detector. Performance depends on disk, CPU, workload, phrase frequency, and concurrent activity; use recorded measurements rather than treating the simulator's offered rate as achieved throughput.

## Docker

```sh
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d --wait
```

Open http://localhost:3001. The stack includes the simulator and uses named volumes for events and databases. Only the UI port is published, on loopback. Images run the services without root privileges.

```sh
docker compose -f docker/docker-compose.yml down
```

Add `--volumes` only when you want to discard this stack's stored data. Container builds support an optional BuildKit secret named `ca_bundle` for environments with a custom certificate authority; it is mounted during downloads and is not copied into the images.

## API

The frontend proxies API calls, queue metrics, and detector status to their internal services.

| Endpoint                           | Purpose                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `POST /api/logs`                   | Insert a single event directly                                                   |
| `GET /api/logs/page`               | Cursor search: `q`, `level`, `source`, `startDate`, `endDate`, `limit`, `cursor` |
| `GET /api/logs`                    | Compatible offset search with an exact total                                     |
| `GET /api/logs/:id`                | Retrieve one event                                                               |
| `GET /api/logs/stats`              | Source and severity statistics                                                   |
| `GET /api/alerts`                  | Filter alerts by acknowledgment, severity, source, and text                      |
| `POST /api/alerts/:id/acknowledge` | Persist acknowledgment                                                           |
| `GET /api/alerts/stats`            | Aggregate and open severity counts                                               |
| `GET /metrics`                     | Indexer, queue, and observed search metrics                                      |
| `GET /health`                      | API readiness                                                                    |

Native queue endpoints are `POST /api/logs/batch`, `GET /api/logs/pending`, `POST /api/logs/ack`, `GET /api/queue/stats`, and `GET /health`. They form an internal leased-delivery protocol rather than the browser API.
