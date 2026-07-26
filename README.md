# Atlas — Distributed Workflow Platform

> Run multi-step business processes reliably. When steps fail, Atlas rolls back automatically. Every decision is recorded so you can replay and debug instantly.

![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?style=flat-square)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## What it does

Atlas runs multi-step business processes (workflows) reliably across distributed systems. If any step fails, Atlas automatically **compensates** — undoing completed steps in reverse order.

**Real example:** An e-commerce checkout runs 6 steps. If shipment booking fails after payment is charged, Atlas automatically refunds the payment and releases inventory. You write zero rollback code.

---

## Included Workflows

| Type | Steps | Parallel? | Description |
|------|-------|-----------|-------------|
| `ecommerce-checkout` | 6 | Yes | validate → reserve + fraud check → charge → ship → confirm |
| `kyc-verification` | 5 | Yes | collect → verify identity + blacklist (parallel) → approve → welcome |
| `loan-disbursement` | 5 | Yes | credit + income (parallel) → approve → disburse → sanction letter |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Dashboard                    │
│  Dashboard | Workflows | Metrics | Replay            │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP + WebSocket
┌──────────────────────▼──────────────────────────────┐
│                  Express API :4000                   │
│  /api/workflows  /api/metrics  /api/health           │
└──────────────────────┬──────────────────────────────┘
                       │ pg_notify (real-time events)
┌──────────────────────▼──────────────────────────────┐
│                PostgreSQL 16                         │
│  workflows | steps | events | metrics                │
└──────────────────────┬──────────────────────────────┘
                       │ poll every 500ms
┌──────────────────────▼──────────────────────────────┐
│                   Worker Process                     │
│  FOR UPDATE SKIP LOCKED — race-free step execution   │
└─────────────────────────────────────────────────────┘
```

**Key design decisions:**
- `FOR UPDATE SKIP LOCKED` — multiple workers can run simultaneously without stepping on each other
- Steps are claimed atomically, so a step can't be picked up by two workers at once
- Workflow-level idempotency via `input.idempotencyKey` + a partial unique index — retrying a create with the same key returns the original workflow instead of starting a second one, even under concurrent requests
- DAG-based execution — steps with no unmet dependencies run in parallel automatically
- `pg_notify` → WebSocket — UI updates in real-time without polling
- Full causal event log — every state change recorded with timestamp and context
- Branch-isolated compensation — on failure, only the causal ancestors of the failed step get rolled back; independent parallel branches that already succeeded are left alone

---

## Quick Start

```bash
# 1. Clone and install backend deps (also needed to run tests locally)
git clone https://github.com/your-username/atlas
cd atlas && npm install

# 2. Run the test suite
npm test

# 3. Start backend (Docker required — builds its own copy of node_modules inside the container)
docker-compose up --build

# 4. Start frontend (new terminal)
cd web && npm install && npm run dev

# Open http://localhost:3000
```

---

## Using the Dashboard

**Dashboard tab** — 3-column layout:
- Left: live list of all workflows with progress bars
- Center: React Flow DAG graph of selected workflow + causal event timeline
- Right: control panel to trigger workflows with failure injection

**Workflows tab** — filterable table with:
- Retry failed workflows in one click
- Cancel running workflows
- Replay any workflow with modified input

**Metrics tab** — real-time charts:
- Throughput over time (area chart)
- Status breakdown (pie chart)
- Workflows by type, avg duration, completion rates

**Replay tab** — debug tool:
- Select any failed/completed workflow
- Edit its input JSON to fix the root cause
- Replay creates a new workflow — original preserved

---

## API

```bash
# Health check
GET /api/health

# List workflow types
GET /api/workflow-types

# Create workflow
POST /api/workflows
{ "type": "ecommerce-checkout", "input": { "sku": "SKU-001", "qty": 1, "amount": 1299 } }

# List workflows (with filters)
GET /api/workflows?status=failed&type=ecommerce-checkout&limit=20

# Get full trace (workflow + steps + events)
GET /api/workflows/:id/trace

# Replay with modified input
POST /api/workflows/:id/replay
{ "input": { "simulateFailureAt": "" } }

# Retry failed workflow
POST /api/workflows/:id/retry

# Cancel running workflow
POST /api/workflows/:id/cancel

# Metrics
GET /api/metrics
GET /api/metrics/steps
```

---

## Failure Injection

Every workflow accepts `simulateFailureAt` and `simulateCompensationFailureAt` in its input:

```json
{
  "sku": "SKU-001", "qty": 1, "amount": 1299,
  "simulateFailureAt": "charge_payment",
  "simulateCompensationFailureAt": "reserve_inventory"
}
```

This forces `charge_payment` to fail, then makes `reserve_inventory`'s compensation fail — creating a `compensation_failed` (stuck) saga. This is the scenario that requires manual intervention in production.

---

## Adding Your Own Workflow

```typescript
import { engine } from './packages/engine'

engine.register('my-process', {
  name: 'My Process',
  steps: [
    {
      name: 'step_one',
      maxRetries: 3,
      async run(input, ctx) {
        await ctx.emit('step.log', { msg: 'doing step one' })
        // call your actual service here
        return { result: 'done' }
      },
      async compensate(input, output, ctx) {
        // undo step_one
        await ctx.emit('step.log', { msg: 'undoing step one' })
      }
    },
    {
      name: 'step_two',
      dependsOn: ['step_one'],  // runs after step_one
      async run(input, ctx) {
        return { result: 'step two done' }
      }
    },
    {
      name: 'step_three',
      dependsOn: ['step_one'],  // also runs after step_one (parallel with step_two)
      async run(input, ctx) {
        return { done: true }
      }
    }
  ]
})
```

---

## SDK

```typescript
import { AtlasClient } from './packages/sdk'

const atlas = new AtlasClient({ baseUrl: 'http://localhost:4000' })

// Trigger and wait for completion
const wf = await atlas.trigger('ecommerce-checkout', { sku: 'SKU-001', qty: 1, amount: 1299 })
const result = await atlas.waitFor(wf.id, { timeoutMs: 60000 })

console.log(result.status)  // 'completed'
console.log(result.output)  // { validate_order: {...}, charge_payment: {...}, ... }
```

---

## Real Integrations

Set in `.env`:
```
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=xxx
RESEND_API_KEY=re_xxx
```

The `charge_payment` step will use real Razorpay when keys are present. The `send_confirmation` step will send real emails via Resend.

---

## Project Structure

```
atlas/
├── apps/
│   ├── api/src/server.ts       — Express API + WebSocket server
│   └── worker/src/worker.ts    — Step execution worker
├── packages/
│   ├── engine.ts               — Core workflow engine (DAG + compensation)
│   ├── db.ts                   — PostgreSQL connection pool
│   ├── eventbus.ts             — In-process event bus
│   ├── auth.ts                 — API key auth middleware
│   ├── logger.ts               — Structured logging (pino)
│   ├── sdk/index.ts            — TypeScript SDK
│   └── workflows/
│       └── ecommerce.ts        — Workflow definitions
├── web/                        — React frontend (Vite + TypeScript)
│   └── src/
│       ├── pages/              — Dashboard, Workflows, Metrics, Replay
│       ├── components/         — WorkflowGraph (React Flow), Timeline, Boot
│       ├── store/              — Zustand global state
│       └── lib/                — API client, WebSocket client
├── tests/                      — Unit + integration tests
├── schema.sql                  — PostgreSQL schema
├── docker-compose.yml          — Full stack (postgres + api + worker)
└── .github/workflows/ci.yml    — GitHub Actions CI
```

---

## License

MIT — use it, fork it, build on it.
