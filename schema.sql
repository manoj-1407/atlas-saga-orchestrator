
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Workflows: named multi-step processes
CREATE TABLE workflows (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  input         JSONB NOT NULL DEFAULT '{}',
  output        JSONB,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Steps: individual units of work within a workflow
CREATE TABLE steps (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id  TEXT NOT NULL REFERENCES workflows(id),
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  input        JSONB NOT NULL DEFAULT '{}',
  output       JSONB,
  error        TEXT,
  retry_count  INT NOT NULL DEFAULT 0,
  max_retries  INT NOT NULL DEFAULT 3,
  depends_on   TEXT[] NOT NULL DEFAULT '{}',
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  duration_ms  INT,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Events: full causal timeline of everything that happened
CREATE TABLE events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  step_id     TEXT REFERENCES steps(id),
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  level       TEXT NOT NULL DEFAULT 'info',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Integrations: connected external services
CREATE TABLE integrations (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,
  config     JSONB NOT NULL DEFAULT '{}',
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Metrics: time-series data for charts
CREATE TABLE metrics (
  id          SERIAL PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id),
  name        TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  tags        JSONB NOT NULL DEFAULT '{}',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_steps_workflow ON steps(workflow_id);
CREATE INDEX idx_steps_status ON steps(status);
CREATE INDEX idx_events_workflow ON events(workflow_id);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_metrics_name ON metrics(name);
CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_type ON workflows(workflow_type);
CREATE INDEX idx_steps_run_at ON steps(run_at);

-- Narrow indexes that only cover the rows claimNextReadyStep() actually scans
CREATE INDEX idx_steps_pending_ready ON steps(run_at, created_at) WHERE status = 'pending';
CREATE INDEX idx_workflows_running ON workflows(id, started_at) WHERE status = 'running';

-- Enforces idempotency at the DB level instead of relying on a check-then-insert
-- in application code, which would still race under concurrent duplicate requests.
-- Partial: once a workflow reaches a terminal failure state its key is free to reuse.
CREATE UNIQUE INDEX idx_workflows_idempotency
  ON workflows (workflow_type, (input->>'idempotencyKey'))
  WHERE input->>'idempotencyKey' IS NOT NULL
    AND status NOT IN ('failed', 'compensated', 'compensation_failed');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_workflows_touch BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- pg_notify on events for WebSocket push
CREATE OR REPLACE FUNCTION notify_event()
RETURNS TRIGGER AS $$ BEGIN PERFORM pg_notify('atlas_events', row_to_json(NEW)::text); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_notify AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION notify_event();
