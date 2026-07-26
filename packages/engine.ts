
import { query, queryOne, withTransaction } from './db'
import { logger } from './logger'
import type { Workflow, Step, WorkflowDefinition, StepDefinition, StepContext } from './types'
import { nanoid } from 'nanoid'

// step.log events are chatty and don't need to hit the DB one at a time.
// This batches them and flushes on a timer or once the buffer fills up,
// whichever happens first, so a busy workflow doesn't turn into a query
// per log line.
class EventBatcher {
  private buffer: Array<{
    id: string
    workflow_id: string
    step_id: string | null
    type: string
    payload: string
    level: string
  }> = []
  private timer: ReturnType<typeof setInterval> | null = null

  private static readonly BATCH_SIZE = 50
  private static readonly FLUSH_INTERVAL_MS = 100

  constructor() {
    this.timer = setInterval(() => this.flush(), EventBatcher.FLUSH_INTERVAL_MS)
    this.timer.unref?.()
  }

  /** Enqueue an event for deferred batch insertion */
  push(event: {
    id: string
    workflow_id: string
    step_id?: string | null
    type: string
    payload: string
    level: string
  }) {
    this.buffer.push({
      id: event.id,
      workflow_id: event.workflow_id,
      step_id: event.step_id || null,
      type: event.type,
      payload: event.payload,
      level: event.level,
    })

    if (this.buffer.length >= EventBatcher.BATCH_SIZE) {
      this.flush()
    }
  }

  /** Flush all buffered events in a single batch INSERT */
  private async flush() {
    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0)
    try {
      // Use json_populate_recordset for atomic multi-row INSERT in 1 round-trip
      await query(
        `INSERT INTO events (id, workflow_id, step_id, type, payload, level)
         SELECT r.id, r.workflow_id, r.step_id, r.type, r.payload::jsonb, r.level
         FROM json_populate_recordset(NULL::events, $1) AS r`,
        [JSON.stringify(batch)]
      )
    } catch (err: any) {
      // On failure, fall back to individual inserts to avoid data loss
      logger.warn({ err: err.message, count: batch.length }, 'EventBatcher batch flush failed, falling back to individual inserts')
      for (const ev of batch) {
        try {
          await query(
            `INSERT INTO events (id, workflow_id, step_id, type, payload, level)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [ev.id, ev.workflow_id, ev.step_id, ev.type, ev.payload, ev.level]
          )
        } catch (innerErr: any) {
          logger.error({ err: innerErr.message, eventId: ev.id }, 'EventBatcher individual insert failed')
        }
      }
    }
  }

  /** Graceful shutdown: flush remaining events and stop timer */
  async shutdown() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.flush()
  }
}

export const eventBatcher = new EventBatcher()


export class PauseSignal extends Error {
  constructor() {
    super('PAUSE_SIGNAL')
    this.name = 'PauseSignal'
  }
}

export class WorkflowEngine {
  private definitions = new Map<string, WorkflowDefinition>()

  register(type: string, def: WorkflowDefinition) {
    // Detect circular dependencies (cycles) in DAG at registration time
    const graph = new Map<string, string[]>()
    def.steps.forEach(s => graph.set(s.name, s.dependsOn || []))

    const visited = new Set<string>()
    const recStack = new Set<string>()

    const checkCycle = (stepName: string): boolean => {
      visited.add(stepName)
      recStack.add(stepName)

      const deps = graph.get(stepName) || []
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (checkCycle(dep)) return true
        } else if (recStack.has(dep)) {
          return true
        }
      }

      recStack.delete(stepName)
      return false
    }

    for (const stepDef of def.steps) {
      if (!visited.has(stepDef.name)) {
        if (checkCycle(stepDef.name)) {
          throw new Error(`Circular dependency detected in workflow type '${type}': step '${stepDef.name}' is part of a cycle.`)
        }
      }
    }

    this.definitions.set(type, def)
    logger.info({ type }, 'workflow registered')
  }

  getDefinition(type: string) {
    return this.definitions.get(type)
  }

  getRegistered(): string[] {
    return Array.from(this.definitions.keys())
  }

  /**
   * Create a new workflow instance.
   *
   * If `input.idempotencyKey` is set, duplicate creates with the same
   * (workflow_type, idempotencyKey) return the original workflow instead of
   * starting a second one. This is enforced by a partial unique index on the
   * workflows table (see schema.sql), not just a pre-check — a pre-check
   * alone doesn't help if two requests with the same key land at the same
   * time, which is exactly when a retrying caller is likely to double-send.
   * We let the DB reject the second insert and recover the winner from there.
   */
  async create(type: string, input: Record<string, any>): Promise<Workflow> {
    const def = this.definitions.get(type)
    if (!def) throw new Error(`Unknown workflow type: ${type}`)

    const idempotencyKey: string | undefined = input.idempotencyKey

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(type, idempotencyKey)
      if (existing) {
        logger.info({ workflowId: existing.id, idempotencyKey }, 'idempotency hit, returning existing workflow')
        return existing
      }
    }

    const id = nanoid()
    const name = `${def.name} #${id.slice(-6).toUpperCase()}`

    try {
      const workflow = await withTransaction(async (client) => {
        const { rows: [wf] } = await client.query(
          `INSERT INTO workflows (id, name, workflow_type, status, input)
           VALUES ($1,$2,$3,'running',$4) RETURNING *`,
          [id, name, type, JSON.stringify(input)]
        )

        for (const stepDef of def.steps) {
          const stepId = nanoid()
          await client.query(
            `INSERT INTO steps (id, workflow_id, name, status, input, depends_on, max_retries)
             VALUES ($1,$2,$3,'pending',$4,$5,$6)`,
            [stepId, id, stepDef.name, JSON.stringify(input), stepDef.dependsOn || [], stepDef.maxRetries || 3]
          )
        }

        await client.query(
          `INSERT INTO events (id, workflow_id, type, payload, level)
           VALUES ($1,$2,'workflow.created',$3,'info')`,
          [nanoid(), id, JSON.stringify({ name, type, input })]
        )

        return wf as Workflow
      })

      logger.info({ workflowId: id, type }, 'workflow created')
      return workflow
    } catch (err: any) {
      // 23505 = unique_violation. Someone else won the race on this
      // idempotency key between our pre-check and our insert — fetch
      // whichever workflow actually got created and hand that back.
      if (idempotencyKey && err.code === '23505') {
        const winner = await this.findByIdempotencyKey(type, idempotencyKey)
        if (winner) {
          logger.info({ workflowId: winner.id, idempotencyKey }, 'idempotency race, returning the workflow that won')
          return winner
        }
      }
      throw err
    }
  }

  private async findByIdempotencyKey(type: string, key: string): Promise<Workflow | null> {
    return queryOne<Workflow>(
      `SELECT * FROM workflows
       WHERE workflow_type = $1
         AND input->>'idempotencyKey' = $2
         AND status NOT IN ('failed','compensated','compensation_failed')
       ORDER BY started_at DESC
       LIMIT 1`,
      [type, key]
    )
  }

  async executeClaimedStep(claimed: Step): Promise<void> {
    const wf = await queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [claimed.workflow_id])
    if (!wf || (wf.status !== 'running' && wf.status !== 'paused')) return

    const def = this.definitions.get(wf.workflow_type)
    if (!def) return

    const stepDef = def.steps.find(s => s.name === claimed.name)
    if (!stepDef) return

    return this.runStepLogic(wf, claimed, stepDef, def)
  }

  async executeStep(workflowId: string, stepName: string): Promise<void> {
    const wf = await queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [workflowId])
    if (!wf || (wf.status !== 'running' && wf.status !== 'paused')) return

    const def = this.definitions.get(wf.workflow_type)
    if (!def) return

    const stepDef = def.steps.find(s => s.name === stepName)
    if (!stepDef) return

    // Claim the step
    const claimed = await queryOne<Step>(
      `UPDATE steps SET status='running', started_at=NOW()
       WHERE workflow_id=$1 AND name=$2 AND status='pending'
       RETURNING *`,
      [workflowId, stepName]
    )
    if (!claimed) return

    return this.runStepLogic(wf, claimed, stepDef, def)
  }

  private async runStepLogic(wf: Workflow, claimed: Step, stepDef: StepDefinition, def: WorkflowDefinition): Promise<void> {
    const workflowId = wf.id
    const stepName = claimed.name

    const ctx: StepContext = {
      workflowId,
      stepId: claimed.id,
      retryCount: claimed.retry_count,
      log: async (msg, data) => {
        eventBatcher.push({
          id: nanoid(),
          workflow_id: workflowId,
          step_id: claimed.id,
          type: 'step.log',
          payload: JSON.stringify({ msg, data }),
          level: 'info',
        })
      },
      emit: async (type, payload = {}) => {
        await query(
          `INSERT INTO events (id, workflow_id, step_id, type, payload, level)
           VALUES ($1,$2,$3,$4,$5,'info')`,
          [nanoid(), workflowId, claimed.id, type, JSON.stringify(payload)]
        )
      }
    }

    const startMs = Date.now()
    try {
      logger.info({ workflowId, stepName }, 'executing step')
      await ctx.emit('step.started', { step: stepName })

      let runPromise = stepDef.run(wf.input, ctx)
      if (stepDef.timeout && stepDef.timeout > 0) {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Step execution timed out after ${stepDef.timeout}ms`)), stepDef.timeout)
        )
        runPromise = Promise.race([runPromise, timeoutPromise])
      }

      const output = await runPromise
      const durationMs = Date.now() - startMs

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE steps SET status='success', output=$1, finished_at=NOW(), duration_ms=$2
           WHERE id=$3`,
          [JSON.stringify(output || {}), durationMs, claimed.id]
        )
        await client.query(
          `INSERT INTO events (id, workflow_id, step_id, type, payload, level)
           VALUES ($1,$2,$3,'step.completed',$4,'success')`,
          [nanoid(), workflowId, claimed.id, JSON.stringify({ step: stepName, output, durationMs })]
        )
        await client.query(
          `INSERT INTO metrics (workflow_id, name, value, tags)
           VALUES ($1,'step.duration',$2,$3)`,
          [workflowId, durationMs, JSON.stringify({ step: stepName, status: 'success' })]
        )
      })

      await this.checkWorkflowComplete(workflowId, def)

    } catch (err: any) {
      const durationMs = Date.now() - startMs
      if (err instanceof PauseSignal || err.message === 'PAUSE_SIGNAL' || err.name === 'PauseSignal') {
        logger.info({ workflowId, stepName }, 'step execution paused')
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE steps SET status='paused', duration_ms=$1 WHERE id=$2`,
            [durationMs, claimed.id]
          )
          await client.query(
            `UPDATE workflows SET status='paused', updated_at=NOW() WHERE id=$1`,
            [workflowId]
          )
          await client.query(
            `INSERT INTO events (id, workflow_id, step_id, type, payload, level)
             VALUES ($1,$2,$3,'step.paused',$4,'info')`,
            [nanoid(), workflowId, claimed.id, JSON.stringify({ step: stepName, message: 'Awaiting admin manual review' })]
          )
        })
        return
      }

      const retry = claimed.retry_count < (stepDef.maxRetries || 3)

      if (retry) {
        const delay = Math.pow(2, claimed.retry_count) * 1000
        const runAt = new Date(Date.now() + delay)
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE steps SET status='pending', retry_count=retry_count+1, run_at=$1
             WHERE id=$2`,
            [runAt, claimed.id]
          )
          await client.query(
            `INSERT INTO events (id, workflow_id, step_id, type, payload, level)
             VALUES ($1,$2,$3,'step.retrying',$4,'warn')`,
            [nanoid(), workflowId, claimed.id, JSON.stringify({ step: stepName, error: err.message, retryIn: delay })]
          )
        })
      } else {
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE steps SET status='failed', error=$1, finished_at=NOW(), duration_ms=$2 WHERE id=$3`,
            [err.message, durationMs, claimed.id]
          )
          await client.query(
            `INSERT INTO events (id, workflow_id, step_id, type, payload, level)
             VALUES ($1,$2,$3,'step.failed',$4,'error')`,
            [nanoid(), workflowId, claimed.id, JSON.stringify({ step: stepName, error: err.message })]
          )
          await client.query(`INSERT INTO metrics (workflow_id,name,value,tags) VALUES ($1,'step.duration',$2,$3)`,
            [workflowId, durationMs, JSON.stringify({ step: stepName, status: 'failed' })]
          )
        })
        await this.startCompensation(workflowId, stepName, def)
      }
    }
  }

  private async checkWorkflowComplete(workflowId: string, def: WorkflowDefinition) {
    const steps = await query<Step>('SELECT * FROM steps WHERE workflow_id=$1', [workflowId])
    const allDone = steps.every(s => s.status === 'success' || s.status === 'skipped')
    if (!allDone) return

    const output: Record<string, any> = {}
    steps.forEach(s => { output[s.name] = s.output })

    await withTransaction(async (client) => {
      // conditional UPDATE so only one caller wins if two steps finish at once
      const { rows } = await client.query(
        `UPDATE workflows SET status='completed', finished_at=NOW(), output=$1
         WHERE id=$2 AND status='running'
         RETURNING *`,
        [JSON.stringify(output), workflowId]
      )
      if (rows.length === 0) return // Another worker already transitioned

      await client.query(
        `INSERT INTO events (id,workflow_id,type,payload,level) VALUES ($1,$2,'workflow.completed',$3,'success')`,
        [nanoid(), workflowId, JSON.stringify({ output })]
      )
      await client.query(
        `INSERT INTO metrics (workflow_id,name,value) VALUES ($1,'workflow.completed',1)`,
        [workflowId]
      )
    })

    logger.info({ workflowId }, 'workflow completed')
  }

  async startCompensation(workflowId: string, failedStep: string, def: WorkflowDefinition) {
    const claimed = await queryOne<Workflow>(
      `UPDATE workflows SET status='compensating'
       WHERE id=$1 AND status='running'
       RETURNING *`,
      [workflowId]
    )
    if (!claimed) return

    await query(
      `INSERT INTO events (id,workflow_id,type,payload,level) VALUES ($1,$2,'workflow.compensating',$3,'warn')`,
      [nanoid(), workflowId, JSON.stringify({ failedStep })]
    )

    // Only roll back steps that the failed step actually depended on. A step
    // in an unrelated branch that already succeeded shouldn't be touched just
    // because something else in the workflow blew up. We find that ancestor
    // set with a plain BFS over dependsOn, then compensate in reverse order.
    const depMap = new Map<string, string[]>()
    def.steps.forEach(s => depMap.set(s.name, s.dependsOn || []))

    const causalAncestors = new Set<string>()
    const queue = [...(depMap.get(failedStep) || [])]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (!causalAncestors.has(current)) {
        causalAncestors.add(current)
        const parents = depMap.get(current) || []
        for (const parent of parents) {
          if (!causalAncestors.has(parent)) {
            queue.push(parent)
          }
        }
      }
    }

    const succeededSteps = await query<Step>(
      "SELECT name, output FROM steps WHERE workflow_id=$1 AND status='success'",
      [workflowId]
    )
    const succeededNames = new Set(succeededSteps.map(s => s.name))

    const toCompensate = def.steps
      .filter(s => succeededNames.has(s.name) && causalAncestors.has(s.name))
      .reverse()

    let compensationFailed = false
    for (const stepDef of toCompensate) {
      if (!stepDef.compensate) continue
      const step = await queryOne<Step>(
        'SELECT * FROM steps WHERE workflow_id=$1 AND name=$2 AND status=$3',
        [workflowId, stepDef.name, 'success']
      )
      if (!step) continue

      await query(`UPDATE steps SET status='compensating' WHERE id=$1`, [step.id])
      await query(
        `INSERT INTO events (id,workflow_id,step_id,type,payload,level) VALUES ($1,$2,$3,'step.compensating',$4,'warn')`,
        [nanoid(), workflowId, step.id, JSON.stringify({ step: stepDef.name })]
      )

      try {
        const wf = await queryOne<Workflow>('SELECT * FROM workflows WHERE id=$1', [workflowId])
        const ctx: StepContext = {
          workflowId, stepId: step.id, retryCount: 0,
          log: async (msg, data) => {
            await query(
              `INSERT INTO events (id,workflow_id,step_id,type,payload,level) VALUES ($1,$2,$3,'step.log',$4,'info')`,
              [nanoid(), workflowId, step.id, JSON.stringify({ msg, data })]
            )
          },
          emit: async (type, payload = {}) => {
            await query(`INSERT INTO events (id,workflow_id,step_id,type,payload,level) VALUES ($1,$2,$3,$4,$5,'info')`,
              [nanoid(), workflowId, step.id, type, JSON.stringify(payload)])
          }
        }
        await stepDef.compensate(wf!.input, step.output || {}, ctx)
        await query(`UPDATE steps SET status='compensated', finished_at=NOW() WHERE id=$1`, [step.id])
        await query(`INSERT INTO events (id,workflow_id,step_id,type,payload,level) VALUES ($1,$2,$3,'step.compensated',$4,'info')`,
          [nanoid(), workflowId, step.id, JSON.stringify({ step: stepDef.name })])
      } catch (err: any) {
        compensationFailed = true
        await query(`UPDATE steps SET status='failed', error=$1 WHERE id=$2`, [err.message, step.id])
        await query(`INSERT INTO events (id,workflow_id,step_id,type,payload,level) VALUES ($1,$2,$3,'step.compensation_failed',$4,'error')`,
          [nanoid(), workflowId, step.id, JSON.stringify({ step: stepDef.name, error: err.message })])
        break
      }
    }

    const finalStatus = compensationFailed ? 'compensation_failed' : 'compensated'
    await query(`UPDATE workflows SET status=$1, finished_at=NOW() WHERE id=$2`, [finalStatus, workflowId])
    await query(`INSERT INTO events (id,workflow_id,type,payload,level) VALUES ($1,$2,$3,$4,$5)`,
      [nanoid(), workflowId, `workflow.${finalStatus}`, JSON.stringify({ failedStep }), compensationFailed ? 'error' : 'warn'])
    await query(`INSERT INTO metrics (workflow_id,name,value) VALUES ($1,'workflow.compensated',1)`, [workflowId])
  }

  async getReadySteps(workflowId: string): Promise<Step[]> {
    const steps = await query<Step>('SELECT * FROM steps WHERE workflow_id=$1', [workflowId])
    const done = new Set(steps.filter(s => s.status === 'success' || s.status === 'skipped').map(s => s.name))
    const now = Date.now()
    return steps.filter(s =>
      s.status === 'pending' &&
      (!s.run_at || new Date(s.run_at).getTime() <= now) &&
      (s.depends_on as unknown as string[]).every(dep => done.has(dep))
    )
  }

  // Grabs the next ready step across all running workflows in one round trip.
  // FOR UPDATE SKIP LOCKED means multiple workers can call this concurrently
  // without blocking each other or double-claiming the same row.
  async claimNextReadyStep(): Promise<Step | null> {
    return queryOne<Step>(`
      WITH ready_step AS (
        SELECT s.id
        FROM steps s
        JOIN workflows w ON s.workflow_id = w.id
        WHERE s.status = 'pending'
          AND w.status = 'running'
          AND s.run_at <= NOW()
          AND NOT EXISTS (
            SELECT 1 FROM unnest(s.depends_on) dep
            JOIN steps d ON d.workflow_id = s.workflow_id AND d.name = dep
            WHERE d.status NOT IN ('success', 'skipped')
          )
        ORDER BY s.run_at ASC
        FOR UPDATE OF s SKIP LOCKED
        LIMIT 1
      )
      UPDATE steps
      SET status = 'running', started_at = NOW()
      FROM ready_step
      WHERE steps.id = ready_step.id
      RETURNING steps.*
    `)
  }
}

export const engine = new WorkflowEngine()
