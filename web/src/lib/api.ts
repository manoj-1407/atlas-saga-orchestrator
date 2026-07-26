
import type { Workflow, Step, Event, WorkflowType, Metrics } from '../types'

const BASE = '/api'

async function r<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error((e as any).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => r<{ status: string; version: string; workflows: string[] }>('/health'),

  types: () => r<WorkflowType[]>('/workflow-types'),

  workflows: {
    list: async (params?: Record<string, string>): Promise<Workflow[]> => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      const result = await r<{ data: Workflow[]; total: number } | Workflow[]>('/workflows' + qs)
      // Handle both old and new response format
      return Array.isArray(result) ? result : (result as any).data
    },
    get: (id: string) => r<Workflow>(`/workflows/${id}`),
    create: (type: string, input: Record<string, any>) =>
      r<Workflow>('/workflows', { method: 'POST', body: JSON.stringify({ type, input }) }),
    steps: (id: string) => r<Step[]>(`/workflows/${id}/steps`),
    events: (id: string) => r<Event[]>(`/workflows/${id}/events`),
    trace: (id: string) => r<{ workflow: Workflow; steps: Step[]; events: Event[] }>(`/workflows/${id}/trace`),
    replay: (id: string, input?: Record<string, any>) =>
      r<Workflow>(`/workflows/${id}/replay`, { method: 'POST', body: JSON.stringify({ input }) }),
    retry: (id: string) => r<{ ok: boolean }>(`/workflows/${id}/retry`, { method: 'POST' }),
    cancel: (id: string, reason?: string) =>
      r<{ ok: boolean }>(`/workflows/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
    approve: (id: string, stepName: string, output?: Record<string, any>) =>
      r<{ ok: boolean }>(`/workflows/${id}/steps/${stepName}/approve`, { method: 'POST', body: JSON.stringify({ output }) }),
    reject: (id: string, stepName: string, reason?: string) =>
      r<{ ok: boolean }>(`/workflows/${id}/steps/${stepName}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  },

  metrics: () => r<Metrics>('/metrics'),
  stepMetrics: () => r<any[]>('/metrics/steps'),

  customType: (payload: { type: string; name: string; steps: any[] }) =>
    r<{ ok: boolean }>('/workflow-types/custom', { method: 'POST', body: JSON.stringify(payload) }),
}
