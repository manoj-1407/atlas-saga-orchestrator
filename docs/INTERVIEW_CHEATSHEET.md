# Atlas Workflow Platform — Software Engineering Interview & Presentation Cheatsheet

> **Target Audience:** College Software Engineering Evaluators, Technical Interviewers, System Architecture Reviewers.

---

## 1. High-Level Architecture Overview

Atlas is a **distributed, event-driven workflow engine** designed using the **Saga Pattern (Orchestration-based)**. It guarantees reliability and consistency across multi-step, distributed microservices without distributed locks or 2PC.

```
┌─────────────────────────────────────────────────────────────┐
│                    React Dashboard UI                        │
│     Real-Time Visualizer | 3D Physics Canvas | Replay    │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / WebSocket Stream
┌──────────────────────────────▼──────────────────────────────┐
│                    Express REST API                         │
│       RBAC Auth | DAG Registration | Prometheus Telemetry   │
└──────────────────────────────┬──────────────────────────────┘
                               │ PostgreSQL LISTEN / NOTIFY
┌──────────────────────────────▼──────────────────────────────┐
│                    PostgreSQL Database                       │
│    Workflows | Step States | Events Timeline | Metrics Log   │
└──────────────────────────────┬──────────────────────────────┘
                               │ Concurrent Polling
┌──────────────────────────────▼──────────────────────────────┐
│                   Distributed Workers                        │
│    FOR UPDATE SKIP LOCKED | Retry Backoff | Auto Rollback    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Key Architectural Decisions & Interview Talking Points

### Q1: Why Saga Pattern instead of Two-Phase Commit (2PC)?
- **2PC Disadvantages:** 2PC requires synchronous blocking locks across databases/microservices. If a coordinator or network node fails while holding a lock, system resources remain locked (low availability, vulnerability to cascading timeouts).
- **Saga Solution:** Saga breaks long-running processes into a sequence of local transactions. Each step updates its local database and publishes an event. If a step fails, Atlas automatically executes **compensating transactions** in topological reverse DAG order to roll back side effects asynchronously.

### Q2: How does Atlas prevent Worker Race Conditions?
- Atlas uses PostgreSQL's native lock-free row reservation query:
  ```sql
  SELECT * FROM steps
  WHERE status = 'pending'
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  ```
- **Benefit:** Multiple worker instances can run concurrently across machines without stepping on each other or experiencing deadlock contention. Workers instantly grab unreserved steps and skip locked rows.

### Q3: How is Idempotency Guaranteed?
- **Workflow-level:** `engine.create()` accepts an optional `idempotencyKey` field inside the workflow input JSON. Before inserting a new row, the engine queries for an existing non-terminal workflow with the same `(workflow_type, idempotencyKey)` pair. If found, it returns the existing workflow unchanged — making repeated calls from retry-prone callers (e.g. message queues, HTTP clients with retry policies) safe without producing duplicate workflows.
- **Step-level:** Every step is assigned a unique, immutable NanoID (`stepId`). The `FOR UPDATE SKIP LOCKED` claim pattern is atomic — a step cannot be claimed twice. State transitions (`pending` → `running` → `success` / `failed`) execute inside ACID transactions, so partial failures leave the step in a consistent claimable state.
- **Concrete protection:** A payment step that succeeded will be in `status='success'` with a recorded `output`. If the worker crashes after writing success but before the workflow advances, the next worker poll skips this step (`status != 'pending'`) and continues from the next ready step — no double charge occurs.

### Q4: What is the failure recovery mechanism?
- **Exponential Backoff:** Retries temporary failures up to `maxRetries` using exponential delay: $\text{delay} = 2^{\text{retryCount}} \times 1000\text{ms}$.
- **Automatic Compensation Rollback:** If retries are exhausted, the workflow status transitions to `compensating`. Succeeded steps are fetched and compensated in topological reverse dependency order.

---

## 3. System Components & Tech Stack Summary

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18, TypeScript, TailwindCSS/Vanilla CSS, Canvas 2D/3D | Dynamic DAG visualizer, live console stream, theme switching |
| **API Server** | Express, Node.js, WebSocket (`ws`), Helmet | RESTful routes, real-time WebSocket event broadcasting, Prometheus export |
| **Worker Engine** | Node.js, `pg` pool, `nanoid` | High-throughput distributed task runner with `SKIP LOCKED` |
| **Database** | PostgreSQL 16 | ACID persistent storage for workflows, steps, events, and metrics |

---

## 4. Academic & Engineering Takeaways

1. **Distributed System Resilience:** Embracing BASE (Basically Available, Soft State, Eventual Consistency) over traditional strict ACID across network boundaries.
2. **Observability First:** Real-time event streams (`pg_notify` $\rightarrow$ WebSocket $\rightarrow$ UI) allow instant root-cause analysis and operational debugging.
3. **Speculative Execution & Rollback:** Clean separation between business action (`run`) and undo action (`compensate`).
