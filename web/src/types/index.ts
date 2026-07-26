
export type WFStatus =
  | 'running' | 'completed' | 'failed'
  | 'compensating' | 'compensated' | 'compensation_failed'
  | 'paused' | 'cancelled'

export type StepStatus =
  | 'pending' | 'running' | 'success' | 'failed'
  | 'compensating' | 'compensated' | 'skipped' | 'paused'

export interface Workflow {
  id: string
  name: string
  workflow_type: string
  status: WFStatus
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
  created_at: string
}

export interface Event {
  id: string
  workflow_id: string
  step_id?: string
  type: string
  payload: Record<string, any>
  level: 'info' | 'warn' | 'error' | 'success'
  created_at: string
}

export interface WorkflowType {
  type: string
  name: string
  stepCount: number
  steps: {
    name: string
    dependsOn: string[]
    maxRetries: number
    hasCompensation: boolean
  }[]
}

export interface Metrics {
  total: number
  byStatus: Record<string, number>
  byType: {
    workflow_type: string
    count: string
    completed: string
    avg_ms: number
  }[]
  stepMetrics: {
    name: string
    avg_ms: number
  }
  throughput: {
    minute: string
    count: string
    completed: string
    failed: string
  }[]
  recentErrors: any[]
}
