
export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'compensating' | 'compensated' | 'compensation_failed' | 'paused'
export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'compensating' | 'compensated' | 'skipped' | 'paused'
export type EventLevel = 'info' | 'warn' | 'error' | 'success'

export interface Workflow {
  id: string
  name: string
  workflow_type: string
  status: WorkflowStatus
  input: Record<string, any>
  output?: Record<string, any>
  error?: string
  started_at: string
  finished_at?: string
  updated_at: string
}

export interface Step {
  id: string
  workflow_id: string
  name: string
  status: StepStatus
  input: Record<string, any>
  output?: Record<string, any>
  error?: string
  retry_count: number
  max_retries: number
  depends_on: string[]
  started_at?: string
  finished_at?: string
  duration_ms?: number
  run_at?: string
  created_at: string
}

export interface Event {
  id: string
  workflow_id: string
  step_id?: string
  type: string
  payload: Record<string, any>
  level: EventLevel
  created_at: string
}

export interface StepDefinition {
  name: string
  dependsOn?: string[]
  maxRetries?: number
  timeout?: number
  run: (input: any, ctx: StepContext) => Promise<any>
  compensate?: (input: any, output: any, ctx: StepContext) => Promise<void>
}

export interface StepContext {
  workflowId: string
  stepId: string
  retryCount: number
  log: (msg: string, data?: any) => Promise<void>
  emit: (type: string, payload?: any) => Promise<void>
}

export interface WorkflowDefinition {
  name: string
  steps: StepDefinition[]
  onComplete?: (output: Record<string, any>) => Promise<void>
}

export interface MetricPoint {
  name: string
  value: number
  workflow_id?: string
  tags?: Record<string, string>
}
