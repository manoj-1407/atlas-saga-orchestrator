/**
 * Atlas SDK — trigger and monitor workflows from any Node.js app
 */

export interface AtlasConfig {
  baseUrl: string
  apiKey?: string
}

export interface WorkflowResult {
  id: string
  name: string
  status: string
  output?: Record<string, any>
  error?: string
  started_at: string
  finished_at?: string
}

export class AtlasClient {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(config: AtlasConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.headers = {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
    }
  }

  private async req<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers, ...opts })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return res.json() as Promise<T>
  }

  trigger(type: string, input: Record<string, any>): Promise<WorkflowResult> {
    return this.req<WorkflowResult>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({ type, input }),
    })
  }

  get(id: string): Promise<WorkflowResult> {
    return this.req<WorkflowResult>(`/api/workflows/${id}`)
  }

  async list(filters?: { status?: string; type?: string; limit?: number }): Promise<WorkflowResult[]> {
    const params: string[] = []
    if (filters?.status) params.push('status=' + encodeURIComponent(filters.status))
    if (filters?.type) params.push('type=' + encodeURIComponent(filters.type))
    if (filters?.limit !== undefined) params.push('limit=' + filters.limit)
    const qs = params.length ? '?' + params.join('&') : ''
    const res = await this.req<WorkflowResult[] | { data: WorkflowResult[] }>('/api/workflows' + qs)
    return Array.isArray(res) ? res : res.data
  }

  trace(id: string): Promise<{ workflow: WorkflowResult; steps: any[]; events: any[] }> {
    return this.req(`/api/workflows/${id}/trace`)
  }

  replay(id: string, inputOverrides?: Record<string, any>): Promise<WorkflowResult> {
    return this.req<WorkflowResult>(`/api/workflows/${id}/replay`, {
      method: 'POST',
      body: JSON.stringify({ input: inputOverrides }),
    })
  }

  async waitFor(id: string, opts?: { pollMs?: number; timeoutMs?: number }): Promise<WorkflowResult> {
    const { pollMs = 1000, timeoutMs = 120000 } = opts || {}
    const deadline = Date.now() + timeoutMs
    const terminal = new Set(['completed', 'failed', 'compensated', 'compensation_failed'])
    while (Date.now() < deadline) {
      const wf = await this.get(id)
      if (terminal.has(wf.status)) return wf
      await new Promise(r => setTimeout(r, pollMs))
    }
    throw new Error(`Workflow ${id} timed out after ${timeoutMs}ms`)
  }

  metrics(): Promise<any> {
    return this.req('/api/metrics')
  }
}
