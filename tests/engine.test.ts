
import { WorkflowEngine } from '../packages/engine'
import type { WorkflowDefinition, StepDefinition } from '../packages/types'

describe('WorkflowEngine', () => {
  it('registers workflow definitions', () => {
    const eng = new WorkflowEngine()
    eng.register('test-workflow', {
      name: 'Test Workflow',
      steps: [
        { name: 'step_one', async run() { return { done: true } } }
      ]
    })
    expect(eng.getRegistered()).toContain('test-workflow')
    expect(eng.getDefinition('test-workflow')).toBeDefined()
  })

  it('returns undefined for unknown workflow type', () => {
    const eng = new WorkflowEngine()
    expect(eng.getDefinition('unknown')).toBeUndefined()
  })

  it('creates correct step definitions with dependency ordering', () => {
    const eng = new WorkflowEngine()
    eng.register('checkout', {
      name: 'Checkout',
      steps: [
        { name: 'step_a', async run() { return {} } },
        { name: 'step_b', dependsOn: ['step_a'], async run() { return {} } },
        { name: 'step_c', dependsOn: ['step_a', 'step_b'], async run() { return {} } },
      ]
    })
    const def = eng.getDefinition('checkout')!
    expect(def.steps).toHaveLength(3)
    expect(def.steps[1].dependsOn).toEqual(['step_a'])
    expect(def.steps[2].dependsOn).toEqual(['step_a', 'step_b'])
  })

  it('registers multiple workflow types independently', () => {
    const eng = new WorkflowEngine()
    eng.register('type-a', {
      name: 'Type A',
      steps: [{ name: 's1', async run() { return {} } }]
    })
    eng.register('type-b', {
      name: 'Type B',
      steps: [{ name: 's1', async run() { return {} } }]
    })
    expect(eng.getRegistered()).toContain('type-a')
    expect(eng.getRegistered()).toContain('type-b')
    expect(eng.getRegistered()).toHaveLength(2)
  })

  it('overwrites existing definition on re-registration', () => {
    const eng = new WorkflowEngine()
    eng.register('wf', {
      name: 'V1',
      steps: [{ name: 's1', async run() { return {} } }]
    })
    eng.register('wf', {
      name: 'V2',
      steps: [
        { name: 's1', async run() { return {} } },
        { name: 's2', async run() { return {} } },
      ]
    })
    const def = eng.getDefinition('wf')!
    expect(def.name).toBe('V2')
    expect(def.steps).toHaveLength(2)
  })

  it('preserves step metadata (maxRetries, timeout)', () => {
    const eng = new WorkflowEngine()
    eng.register('meta-test', {
      name: 'Meta Test',
      steps: [
        { name: 'retry_step', maxRetries: 5, timeout: 10000, async run() { return {} } },
        { name: 'default_step', async run() { return {} } },
      ]
    })
    const def = eng.getDefinition('meta-test')!
    expect(def.steps[0].maxRetries).toBe(5)
    expect(def.steps[0].timeout).toBe(10000)
    expect(def.steps[1].maxRetries).toBeUndefined()
    expect(def.steps[1].timeout).toBeUndefined()
  })

  it('supports steps with compensation functions', () => {
    const eng = new WorkflowEngine()
    eng.register('saga-test', {
      name: 'Saga Test',
      steps: [
        {
          name: 'charge_payment',
          async run() { return { chargeId: 'ch_123' } },
          async compensate(input, output) { /* refund logic */ }
        },
        {
          name: 'send_email',
          async run() { return { sent: true } },
          // No compensation — email can't be un-sent
        }
      ]
    })
    const def = eng.getDefinition('saga-test')!
    expect(def.steps[0].compensate).toBeDefined()
    expect(typeof def.steps[0].compensate).toBe('function')
    expect(def.steps[1].compensate).toBeUndefined()
  })
})

describe('WorkflowEngine — DAG Analysis', () => {
  it('detects fan-out dependency pattern', () => {
    const eng = new WorkflowEngine()
    eng.register('fan-out', {
      name: 'Fan Out',
      steps: [
        { name: 'init', async run() { return {} } },
        { name: 'parallel_a', dependsOn: ['init'], async run() { return {} } },
        { name: 'parallel_b', dependsOn: ['init'], async run() { return {} } },
        { name: 'parallel_c', dependsOn: ['init'], async run() { return {} } },
      ]
    })
    const def = eng.getDefinition('fan-out')!
    const fanOutChildren = def.steps.filter(s =>
      s.dependsOn?.includes('init')
    )
    expect(fanOutChildren).toHaveLength(3)
  })

  it('detects fan-in (join) dependency pattern', () => {
    const eng = new WorkflowEngine()
    eng.register('fan-in', {
      name: 'Fan In',
      steps: [
        { name: 'step_a', async run() { return {} } },
        { name: 'step_b', async run() { return {} } },
        { name: 'join', dependsOn: ['step_a', 'step_b'], async run() { return {} } },
      ]
    })
    const def = eng.getDefinition('fan-in')!
    const joinStep = def.steps.find(s => s.name === 'join')!
    expect(joinStep.dependsOn).toEqual(['step_a', 'step_b'])
  })

  it('rejects workflow registration with circular dependencies', () => {
    const eng = new WorkflowEngine()
    expect(() => {
      eng.register('cycle-workflow', {
        name: 'Cycle Workflow',
        steps: [
          { name: 'step_a', dependsOn: ['step_b'], async run() { return {} } },
          { name: 'step_b', dependsOn: ['step_a'], async run() { return {} } },
        ]
      })
    }).toThrow('Circular dependency detected')
  })

  it('rejects 3-node cycle (A→B→C→A)', () => {
    const eng = new WorkflowEngine()
    expect(() => {
      eng.register('3-cycle', {
        name: '3-node Cycle',
        steps: [
          { name: 'a', dependsOn: ['c'], async run() { return {} } },
          { name: 'b', dependsOn: ['a'], async run() { return {} } },
          { name: 'c', dependsOn: ['b'], async run() { return {} } },
        ]
      })
    }).toThrow('Circular dependency detected')
  })

  it('computes causal predecessor set isolating failed branch from independent branches', () => {
    const steps: StepDefinition[] = [
      // Branch 1 (Causal chain for step_c)
      { name: 'step_a', async run() { return {} }, async compensate() {} },
      { name: 'step_b', dependsOn: ['step_a'], async run() { return {} }, async compensate() {} },
      { name: 'step_c', dependsOn: ['step_b'], async run() { return {} }, async compensate() {} },
      // Branch 2 (Independent parallel branch)
      { name: 'branch2_d', async run() { return {} }, async compensate() {} },
      { name: 'branch2_e', dependsOn: ['branch2_d'], async run() { return {} }, async compensate() {} },
    ]

    const failedStep = 'step_c'
    const depMap = new Map<string, string[]>()
    steps.forEach(s => depMap.set(s.name, s.dependsOn || []))

    // Traverse transitive causal ancestors of failedStep
    const causalAncestors = new Set<string>()
    const queue = [...(depMap.get(failedStep) || [])]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (!causalAncestors.has(current)) {
        causalAncestors.add(current)
        const parents = depMap.get(current) || []
        for (const parent of parents) {
          if (!causalAncestors.has(parent)) queue.push(parent)
        }
      }
    }

    const succeededNames = new Set(['step_a', 'step_b', 'branch2_d', 'branch2_e'])
    const toCompensate = steps
      .filter(s => succeededNames.has(s.name) && causalAncestors.has(s.name))
      .reverse()

    // Should compensate ONLY Branch 1 ancestors (step_b -> step_a) and leave Branch 2 untouched!
    expect(toCompensate.map(s => s.name)).toEqual(['step_b', 'step_a'])
    expect(toCompensate.map(s => s.name)).not.toContain('branch2_d')
    expect(toCompensate.map(s => s.name)).not.toContain('branch2_e')
  })
})

describe('EventBatcher', () => {
  // Test the EventBatcher logic in isolation (without database)
  it('can be imported from engine module', async () => {
    const { eventBatcher } = await import('../packages/engine')
    expect(eventBatcher).toBeDefined()
    expect(typeof eventBatcher.push).toBe('function')
    expect(typeof eventBatcher.shutdown).toBe('function')
  })
})

describe('Database module', () => {
  it('exports pool health check utilities', async () => {
    const { getPoolStats, healthCheck } = await import('../packages/db')
    expect(typeof getPoolStats).toBe('function')
    expect(typeof healthCheck).toBe('function')

    const stats = getPoolStats()
    expect(stats).toHaveProperty('totalCount')
    expect(stats).toHaveProperty('idleCount')
    expect(stats).toHaveProperty('waitingCount')
  })
})

describe('Auth module', () => {
  it('exports RBAC role types and middleware', async () => {
    const auth = await import('../packages/auth')
    expect(typeof auth.authMiddleware).toBe('function')
    expect(typeof auth.requireRole).toBe('function')
    expect(typeof auth.generateApiKey).toBe('function')
  })

  it('generates API keys with correct prefix', async () => {
    const { generateApiKey } = await import('../packages/auth')
    const key = generateApiKey()
    expect(key.startsWith('atl_')).toBe(true)
    expect(key.length).toBeGreaterThan(40) // 'atl_' + 64 hex chars
  })

  it('requireRole returns a middleware function', async () => {
    const { requireRole } = await import('../packages/auth')
    const mw = requireRole('admin', 'operator')
    expect(typeof mw).toBe('function')
  })

  it('requireRole blocks requests with insufficient role', async () => {
    const { requireRole } = await import('../packages/auth')
    const mw = requireRole('admin')
    const req: any = { auth: { userId: 'test', role: 'viewer' } }
    const res: any = {
      statusCode: null,
      jsonBody: null,
      status(code: number) { this.statusCode = code; return this },
      json(body: any) { this.jsonBody = body },
    }
    const next = jest.fn()
    mw(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.jsonBody.error).toBe('Forbidden')
  })

  it('requireRole passes requests with sufficient role', async () => {
    const { requireRole } = await import('../packages/auth')
    const mw = requireRole('admin', 'operator')
    const req: any = { auth: { userId: 'test', role: 'operator' } }
    const res: any = {}
    const next = jest.fn()
    mw(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('requireRole blocks requests with no auth context', async () => {
    const { requireRole } = await import('../packages/auth')
    const mw = requireRole('admin')
    const req: any = {}
    const res: any = {
      statusCode: null,
      status(code: number) { this.statusCode = code; return this },
      json(body: any) {},
    }
    const next = jest.fn()
    mw(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })
})

describe('Idempotency key', () => {
  const testDef: WorkflowDefinition = {
    name: 'Checkout',
    steps: [{ name: 'step_one', async run() { return {} } }],
  }

  it('returns the existing workflow instead of inserting a new one', async () => {
    const existing = { id: 'wf-existing', workflow_type: 'checkout', status: 'running' }
    let MockedEngine: any
    jest.isolateModules(() => {
      jest.doMock('../packages/db', () => ({
        query: jest.fn(),
        queryOne: jest.fn().mockResolvedValue(existing),
        withTransaction: jest.fn(),
      }))
      MockedEngine = require('../packages/engine').WorkflowEngine
      const { withTransaction } = require('../packages/db')
      ;(global as any).__withTransaction = withTransaction
    })

    const eng = new MockedEngine()
    eng.register('checkout', testDef)
    const result = await eng.create('checkout', { idempotencyKey: 'order-1' })

    expect(result).toBe(existing)
    expect((global as any).__withTransaction).not.toHaveBeenCalled()
  })

  it('creates a new workflow when no match exists for the key', async () => {
    const newRow = { id: 'wf-new', workflow_type: 'checkout', status: 'running' }
    let MockedEngine: any
    jest.isolateModules(() => {
      jest.doMock('../packages/db', () => ({
        query: jest.fn(),
        queryOne: jest.fn().mockResolvedValue(null),
        withTransaction: jest.fn((fn: any) => fn({ query: jest.fn().mockResolvedValue({ rows: [newRow] }) })),
      }))
      MockedEngine = require('../packages/engine').WorkflowEngine
    })

    const eng = new MockedEngine()
    eng.register('checkout', testDef)
    const result = await eng.create('checkout', { idempotencyKey: 'order-2' })

    expect(result.id).toBe('wf-new')
  })

  it('recovers the winning row when two concurrent creates race on the same key', async () => {
    // Simulates two requests with the same idempotencyKey arriving at once:
    // both pass the pre-check (nothing exists yet), both try to insert, the
    // DB's unique index lets one through and rejects the other with 23505.
    // The loser should return the winner's workflow, not throw or duplicate it.
    const winner = { id: 'wf-winner', workflow_type: 'checkout', status: 'running' }
    const conflict: any = new Error('duplicate key value violates unique constraint "idx_workflows_idempotency"')
    conflict.code = '23505'

    let MockedEngine: any
    jest.isolateModules(() => {
      jest.doMock('../packages/db', () => ({
        query: jest.fn(),
        queryOne: jest.fn()
          .mockResolvedValueOnce(null)   // pre-check finds nothing
          .mockResolvedValueOnce(winner), // recovery lookup after losing the race
        withTransaction: jest.fn().mockRejectedValue(conflict),
      }))
      MockedEngine = require('../packages/engine').WorkflowEngine
    })

    const eng = new MockedEngine()
    eng.register('checkout', testDef)
    const result = await eng.create('checkout', { idempotencyKey: 'order-3' })

    expect(result).toBe(winner)
  })

  it('propagates non-conflict errors instead of swallowing them', async () => {
    const dbDown = new Error('connection terminated unexpectedly')
    let MockedEngine: any
    jest.isolateModules(() => {
      jest.doMock('../packages/db', () => ({
        query: jest.fn(),
        queryOne: jest.fn().mockResolvedValue(null),
        withTransaction: jest.fn().mockRejectedValue(dbDown),
      }))
      MockedEngine = require('../packages/engine').WorkflowEngine
    })

    const eng = new MockedEngine()
    eng.register('checkout', testDef)
    await expect(eng.create('checkout', { idempotencyKey: 'order-4' })).rejects.toThrow('connection terminated')
  })
})
