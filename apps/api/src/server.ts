
import dotenv from 'dotenv'
dotenv.config()

import express, { Request, Response, NextFunction } from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import path from 'path'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { nanoid } from 'nanoid'

import { pool, query, queryOne, withTransaction, getPoolStats } from '../../../packages/db'
import { Client } from 'pg'
import { engine, eventBatcher } from '../../../packages/engine'
import { logger } from '../../../packages/logger'
import { authMiddleware, requireRole } from '../../../packages/auth'
import { ecommerceCheckout, kycVerification, loanDisbursement } from '../../../packages/workflows/ecommerce'
import { userOnboarding } from '../../../packages/workflows/manual'
import type { Workflow, Step, Event } from '../../../packages/types'

// Register all workflow definitions
engine.register('ecommerce-checkout', ecommerceCheckout)
engine.register('kyc-verification', kycVerification)
engine.register('loan-disbursement', loanDisbursement)
engine.register('user-onboarding', userOnboarding)

const app = express()
const server = createServer(app)
const PORT = parseInt(process.env.PORT || '4000')

// ── CORS configuration ────────────────────────────────────────────────────────
// ATLAS_ALLOWED_ORIGINS: comma-separated list, e.g. "http://localhost:5173,https://app.example.com"
// Defaults to localhost dev origins only. Do NOT set to "*" in production.
const ALLOWED_ORIGINS = (process.env.ATLAS_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin || ''
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
    res.header('Access-Control-Allow-Origin', origin)
    res.header('Vary', 'Origin')
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  // Note: x-user-role is intentionally excluded — roles are derived server-side from API keys only
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key')
  if (req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
app.use(express.json({ limit: '2mb' }))
app.use(corsMiddleware)

// Rate limiting
app.use('/api/', rateLimit({ windowMs: 60_000, max: 500, standardHeaders: true, legacyHeaders: false }))

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now()
  res.on('finish', () => {
    if (req.path !== '/api/health') {
      logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }, 'request')
    }
  })
  next()
})

// ── Public routes (no auth) ───────────────────────────────────────────────────
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1')
    res.json({
      status: 'ok',
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
      workflows: engine.getRegistered(),
      pool: getPoolStats(),
      timestamp: new Date().toISOString(),
    })
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' })
  }
})

// Static (vanilla dashboard fallback)
app.use(express.static(path.join(__dirname, '../../../public')))

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/api/', authMiddleware)

// Workflow types
app.get('/api/workflow-types', (req: Request, res: Response) => {
  const types = engine.getRegistered().map(type => {
    const def = engine.getDefinition(type)!
    return {
      type,
      name: def.name,
      stepCount: def.steps.length,
      steps: def.steps.map(s => ({
        name: s.name,
        dependsOn: s.dependsOn || [],
        maxRetries: s.maxRetries || 3,
        hasCompensation: !!s.compensate,
      }))
    }
  })
  res.json(types)
})

// Create workflow
// requireRole enforces that the API key's server-side role is admin or operator.
// Clients cannot influence their role — it is derived from the API key only.
app.post('/api/workflows', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  try {
    const { type, input = {} } = req.body
    if (!type) { res.status(400).json({ error: 'type is required' }); return }
    if (!engine.getDefinition(type)) {
      res.status(400).json({ error: `Unknown workflow type: ${type}`, available: engine.getRegistered() }); return
    }
    const wf = await engine.create(type, input)
    // 200 on idempotency hit (existing returned), 201 on fresh creation
    const statusCode = wf.started_at && new Date(wf.started_at).getTime() < Date.now() - 500 ? 200 : 201
    res.status(statusCode).json(wf)
  } catch (err: any) {
    logger.error({ err: err.message }, 'create workflow failed')
    res.status(400).json({ error: err.message })
  }
})

// List workflows with pagination + filtering
app.get('/api/workflows', async (req: Request, res: Response) => {
  try {
    const { status, type, limit = '50', offset = '0', search } = req.query
    let sql = 'SELECT * FROM workflows WHERE 1=1'
    const params: any[] = []
    if (status) { params.push(status); sql += ` AND status=$${params.length}` }
    if (type) { params.push(type); sql += ` AND workflow_type=$${params.length}` }
    if (search) { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}` }
    params.push(parseInt(limit as string)); sql += ` ORDER BY started_at DESC LIMIT $${params.length}`
    params.push(parseInt(offset as string)); sql += ` OFFSET $${params.length}`
    const workflows = await query<Workflow>(sql, params)
    const [{ count }] = await query<{count: string}>('SELECT COUNT(*) FROM workflows WHERE 1=1')
    res.json({ data: workflows, total: parseInt(count), limit: parseInt(limit as string), offset: parseInt(offset as string) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Get single workflow
app.get('/api/workflows/:id', async (req: Request, res: Response) => {
  const wf = await queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [req.params.id])
  if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return }
  res.json(wf)
})

// Get steps
app.get('/api/workflows/:id/steps', async (req: Request, res: Response) => {
  const steps = await query<Step>('SELECT * FROM steps WHERE workflow_id=$1 ORDER BY created_at', [req.params.id])
  res.json(steps)
})

// Get events (causal timeline)
app.get('/api/workflows/:id/events', async (req: Request, res: Response) => {
  const events = await query<Event>('SELECT * FROM events WHERE workflow_id=$1 ORDER BY created_at', [req.params.id])
  res.json(events)
})

// Get full trace (workflow + steps + events)
app.get('/api/workflows/:id/trace', async (req: Request, res: Response) => {
  try {
    const [wf, steps, events] = await Promise.all([
      queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [req.params.id]),
      query<Step>('SELECT * FROM steps WHERE workflow_id=$1 ORDER BY created_at', [req.params.id]),
      query<Event>('SELECT * FROM events WHERE workflow_id=$1 ORDER BY created_at', [req.params.id]),
    ])
    if (!wf) { res.status(404).json({ error: 'not found' }); return }
    res.json({ workflow: wf, steps, events, stepCount: steps.length, eventCount: events.length })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Replay a workflow with modified input
app.post('/api/workflows/:id/replay', async (req: Request, res: Response) => {
  try {
    const original = await queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [req.params.id])
    if (!original) { res.status(404).json({ error: 'not found' }); return }
    // Strip idempotencyKey so replay always creates a new workflow
    const { idempotencyKey: _dropped, ...originalInput } = original.input
    const newInput = { ...originalInput, ...(req.body.input || {}) }
    const wf = await engine.create(original.workflow_type, newInput)
    await query(
      `INSERT INTO events (id,workflow_id,type,payload,level) VALUES ($1,$2,'workflow.replayed',$3,'info')`,
      [nanoid(), wf.id, JSON.stringify({ replayOf: original.id, originalName: original.name })]
    )
    res.status(201).json(wf)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// Retry failed steps
app.post('/api/workflows/:id/retry', async (req: Request, res: Response) => {
  try {
    const wf = await queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [req.params.id])
    if (!wf) { res.status(404).json({ error: 'not found' }); return }
    await query("UPDATE workflows SET status='running',updated_at=NOW() WHERE id=$1", [req.params.id])
    await query("UPDATE steps SET status='pending',retry_count=0,error=null WHERE workflow_id=$1 AND status='failed'", [req.params.id])
    await query(`INSERT INTO events (id,workflow_id,type,payload,level) VALUES ($1,$2,'workflow.retried',$3,'info')`,
      [nanoid(), req.params.id, JSON.stringify({ triggeredAt: new Date().toISOString() })])
    res.json({ ok: true, message: 'Workflow queued for retry' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Cancel a running workflow
app.post('/api/workflows/:id/cancel', async (req: Request, res: Response) => {
  try {
    const wf = await queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [req.params.id])
    if (!wf) { res.status(404).json({ error: 'not found' }); return }

    // The status check and the update both happen inside the transaction so a
    // workflow that completes between our read above and this write can't get
    // clobbered back to 'failed' — if it's no longer running/paused, rows=0.
    const cancelled = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE workflows SET status='failed', finished_at=NOW()
         WHERE id=$1 AND status IN ('running','paused')
         RETURNING id`,
        [req.params.id]
      )
      if (rows.length === 0) return false

      await client.query("UPDATE steps SET status='skipped' WHERE workflow_id=$1 AND status='pending'", [req.params.id])
      await client.query(`INSERT INTO events (id,workflow_id,type,payload,level) VALUES ($1,$2,'workflow.cancelled',$3,'warn')`,
        [nanoid(), req.params.id, JSON.stringify({ reason: req.body.reason || 'manual cancellation' })])
      return true
    })

    if (!cancelled) {
      res.status(400).json({ error: 'Can only cancel running or paused workflows' }); return
    }
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Approve manual step
app.post('/api/workflows/:id/steps/:name/approve', async (req: Request, res: Response) => {
  try {
    const { id, name } = req.params
    const wf = await queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [id])
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return }
    if (wf.status !== 'paused') {
      res.status(400).json({ error: 'Workflow is not in paused state' }); return
    }
    const step = await queryOne<Step>(
      'SELECT * FROM steps WHERE workflow_id=$1 AND name=$2 AND status=$3',
      [id, name, 'paused']
    )
    if (!step) { res.status(404).json({ error: 'Paused step not found' }); return }

    const output = req.body.output || { approved: true, approvedBy: req.auth?.userId || 'admin', approvedAt: new Date().toISOString() }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE steps SET status='success', output=$1, finished_at=NOW() WHERE id=$2`,
        [JSON.stringify(output), step.id]
      )
      await client.query(
        `UPDATE workflows SET status='running', updated_at=NOW() WHERE id=$1`,
        [id]
      )
      await client.query(
        `INSERT INTO events (id, workflow_id, step_id, type, payload, level)
         VALUES ($1,$2,$3,'step.approved',$4,'success')`,
        [nanoid(), id, step.id, JSON.stringify({ step: name, output, approvedBy: req.auth?.userId })]
      )
    })

    res.json({ ok: true, message: 'Step approved successfully' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Reject manual step
app.post('/api/workflows/:id/steps/:name/reject', async (req: Request, res: Response) => {
  try {
    const { id, name } = req.params
    const wf = await queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [id])
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return }
    if (wf.status !== 'paused') {
      res.status(400).json({ error: 'Workflow is not in paused state' }); return
    }
    const step = await queryOne<Step>(
      'SELECT * FROM steps WHERE workflow_id=$1 AND name=$2 AND status=$3',
      [id, name, 'paused']
    )
    if (!step) { res.status(404).json({ error: 'Paused step not found' }); return }

    const reason = req.body.reason || 'Manually rejected by admin'

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE steps SET status='failed', error=$1, finished_at=NOW() WHERE id=$2`,
        [reason, step.id]
      )
      await client.query(
        `UPDATE workflows SET status='running', updated_at=NOW() WHERE id=$1`,
        [id]
      )
      await client.query(
        `INSERT INTO events (id, workflow_id, step_id, type, payload, level)
         VALUES ($1,$2,$3,'step.failed',$4,'error')`,
        [nanoid(), id, step.id, JSON.stringify({ step: name, error: reason, rejectedBy: req.auth?.userId })]
      )
    })

    const def = engine.getDefinition(wf.workflow_type)
    if (def) {
      engine.startCompensation(id, name, def).catch(err => {
        logger.error({ err: err.message, workflowId: id, step: name }, 'Rejection rollback error')
      })
    }

    res.json({ ok: true, message: 'Step rejected, initiating rollback' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Metrics
app.get('/api/metrics', async (req: Request, res: Response) => {
  try {
    const [total, byStatus, byType, stepMetrics, throughput, recentErrors] = await Promise.all([
      query('SELECT COUNT(*) as count FROM workflows'),
      query("SELECT status, COUNT(*) as count FROM workflows GROUP BY status ORDER BY count DESC"),
      query(`SELECT workflow_type,
               COUNT(*) as count,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
               AVG(CASE WHEN finished_at IS NOT NULL THEN EXTRACT(EPOCH FROM (finished_at-started_at))*1000 END) as avg_ms
             FROM workflows GROUP BY workflow_type`),
      query(`SELECT name, AVG(value) as avg_ms, COUNT(*) as count, MIN(value) as min_ms, MAX(value) as max_ms
             FROM metrics WHERE name='step.duration' GROUP BY name`),
      query(`SELECT DATE_TRUNC('minute', started_at) as minute,
               COUNT(*) as count,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN status IN ('failed','compensation_failed') THEN 1 ELSE 0 END) as failed
             FROM workflows WHERE started_at > NOW() - INTERVAL '1 hour'
             GROUP BY 1 ORDER BY 1 DESC LIMIT 30`),
      query(`SELECT e.type, e.payload, e.created_at, w.name as workflow_name, w.workflow_type
             FROM events e JOIN workflows w ON e.workflow_id=w.id
             WHERE e.level='error' ORDER BY e.created_at DESC LIMIT 10`),
    ])
    res.json({
      total: parseInt((total[0] as any)?.count || '0'),
      byStatus: Object.fromEntries((byStatus as any[]).map(r => [r.status, parseInt(r.count)])),
      byType,
      stepMetrics: stepMetrics[0] || {},
      throughput: (throughput as any[]).reverse(),
      recentErrors,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Step-level metrics
app.get('/api/metrics/steps', async (req: Request, res: Response) => {
  try {
    const data = await query(`
      SELECT s.name,
        COUNT(*) as total,
        SUM(CASE WHEN s.status='success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN s.status='failed' THEN 1 ELSE 0 END) as failed,
        AVG(s.duration_ms) as avg_ms,
        MAX(s.duration_ms) as max_ms,
        SUM(s.retry_count) as total_retries
      FROM steps s GROUP BY s.name ORDER BY failed DESC
    `)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Prometheus Telemetry Export (Prometheus text format)
app.get('/api/metrics/prometheus', async (req: Request, res: Response) => {
  try {
    const [totalWfs, wfStatuses, stepMetrics] = await Promise.all([
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM workflows'),
      query<{ status: string; count: string }>('SELECT status, COUNT(*) as count FROM workflows GROUP BY status'),
      query<{ name: string; avg_ms: number; total: string; failed: string }>('SELECT name, AVG(duration_ms) as avg_ms, COUNT(*) as total, SUM(CASE WHEN status=\'failed\' THEN 1 ELSE 0 END) as failed FROM steps GROUP BY name')
    ])

    let output = `# HELP atlas_workflows_total Total number of workflows created\n`
    output += `# TYPE atlas_workflows_total counter\n`
    output += `atlas_workflows_total ${totalWfs?.count || 0}\n\n`

    output += `# HELP atlas_workflows_by_status Workflows broken down by status\n`
    output += `# TYPE atlas_workflows_by_status gauge\n`
    wfStatuses.forEach(row => {
      output += `atlas_workflows_by_status{status="${row.status}"} ${row.count}\n`
    })

    output += `\n# HELP atlas_step_duration_avg_milliseconds Average step execution latency\n`
    output += `# TYPE atlas_step_duration_avg_milliseconds gauge\n`
    stepMetrics.forEach(row => {
      output += `atlas_step_duration_avg_milliseconds{step="${row.name}"} ${Math.round(row.avg_ms || 0)}\n`
    })

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    res.send(output)
  } catch (err: any) {
    res.status(500).send(`# ERROR: ${err.message}`)
  }
})

// Register custom JSON-defined workflow on the fly
app.post('/api/workflow-types/custom', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { type, name, steps } = req.body
    if (!type || !name || !Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: 'Invalid schema. Requires type, name, and steps array.' })
      return
    }

    engine.register(type, {
      name,
      steps: steps.map((s: any) => ({
        name: s.name,
        dependsOn: s.dependsOn || [],
        maxRetries: s.maxRetries || 3,
        async run(input: any, ctx: any) {
          await ctx.log(`Executing step ${s.name}`, { input })
          if (input.simulateFailureAt === s.name) {
            throw new Error(`Simulated failure at step '${s.name}'`)
          }
          return { status: 'success', timestamp: new Date().toISOString(), result: s.mockOutput || 'Step completed successfully' }
        },
        async compensate(input: any, output: any, ctx: any) {
          await ctx.log(`Compensating step ${s.name}`)
          if (input.simulateCompensationFailureAt === s.name) {
            throw new Error(`Simulated compensation failure at step '${s.name}'`)
          }
        }
      }))
    })

    logger.info({ type, name, stepCount: steps.length }, 'Custom workflow dynamically registered')
    res.status(201).json({ ok: true, message: `Workflow '${name}' (${type}) registered successfully.` })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'unhandled error')
  res.status(500).json({ error: 'Internal server error' })
})

// ── WebSocket ──────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set<WebSocket>()

wss.on('connection', (ws: WebSocket, req) => {
  clients.add(ws)
  logger.info({ clientCount: clients.size }, 'WS client connected')

  // Send initial state
  ws.send(JSON.stringify({
    type: 'connected',
    data: { workflows: engine.getRegistered(), clientId: nanoid(8), ts: Date.now() }
  }))

  ws.on('close', () => {
    clients.delete(ws)
    logger.info({ clientCount: clients.size }, 'WS client disconnected')
  })

  ws.on('error', (err) => logger.warn({ err: err.message }, 'WS error'))
})

// ── pg_notify listener — SOLE broadcast path ──────────────────────────────────
// All workflow events reach the frontend via PostgreSQL LISTEN/NOTIFY.
// The DB trigger fires on every INSERT into the events table, ensuring both
// API-process events (workflow.created, etc.) and worker-process events
// (step.completed, etc.) reach WS clients through a single consistent path.
// The in-process eventBus path has been intentionally removed to prevent
// duplicate broadcasts when the API process itself writes events.
async function startDbEventListener() {
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL })

  try {
    await pgClient.connect()
    await pgClient.query('LISTEN atlas_events')
    logger.info('API pg_notify listener connected and listening on channel "atlas_events"')

    pgClient.on('notification', (msg) => {
      if (msg.channel === 'atlas_events' && msg.payload) {
        try {
          const eventRow = JSON.parse(msg.payload)
          const wsMsg = JSON.stringify({
            type: 'workflow_update',
            data: {
              id: eventRow.id,
              workflowId: eventRow.workflow_id,
              type: eventRow.type,
              payload: eventRow.payload,
              ts: new Date(eventRow.created_at).getTime()
            },
            ts: Date.now()
          })

          let sent = 0
          clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(wsMsg)
              sent++
            }
          })

          if (sent > 0) {
            logger.debug({ event: eventRow.type, clients: sent }, 'WS pg_notify broadcast')
          }
        } catch (err: any) {
          logger.warn({ err: err.message }, 'Failed to parse pg_notify payload')
        }
      }
    })

    pgClient.on('error', (err) => {
      logger.error({ err: err.message }, 'pg_notify client error')
      reconnect()
    })
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to connect pg_notify client')
    reconnect()
  }

  function reconnect() {
    pgClient.end().catch(() => {})
    setTimeout(startDbEventListener, 5000)
  }
}

// ── Start ──────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV, workflows: engine.getRegistered() }, 'Atlas API ready')
  startDbEventListener()
})

process.on('SIGTERM', async () => { logger.info('shutting down'); server.close(); await eventBatcher.shutdown(); await pool.end() })
process.on('SIGINT', async () => { logger.info('interrupted'); server.close(); await eventBatcher.shutdown(); await pool.end() })
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'))
