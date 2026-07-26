
import { create } from 'zustand'
import { api } from '../lib/api'
import type { Workflow, Step, WorkflowType, Metrics } from '../types'

interface Entry { wf: Workflow; steps: Step[] }

interface Store {
  workflows: Map<string, Entry>
  types: WorkflowType[]
  metrics: Metrics | null
  loading: boolean
  wsStatus: string
  setWsStatus: (s: string) => void
  fetchAll: () => Promise<void>
  refreshWorkflow: (id: string) => Promise<void>
  fetchTypes: () => Promise<void>
  fetchMetrics: () => Promise<void>
  removeWorkflow: (id: string) => void
  wsEvents: any[]
  addWsEvent: (ev: any) => void
}

export const useStore = create<Store>((set, get) => ({
  workflows: new Map(),
  types: [],
  metrics: null,
  loading: false,
  wsStatus: 'connecting',

  setWsStatus: (wsStatus) => set({ wsStatus }),

  fetchAll: async () => {
    set({ loading: true })
    try {
      const list = await api.workflows.list({ limit: '200' })
      const entries = await Promise.all(
        list.map(async (wf): Promise<[string, Entry]> => {
          const steps = await api.workflows.steps(wf.id)
          return [wf.id, { wf, steps }]
        })
      )
      set({ workflows: new Map(entries), loading: false })
    } catch (e) {
      console.error('fetchAll failed:', e)
      set({ loading: false })
    }
  },

  refreshWorkflow: async (id: string) => {
    try {
      const [wf, steps] = await Promise.all([
        api.workflows.get(id),
        api.workflows.steps(id),
      ])
      const m = new Map(get().workflows)
      m.set(id, { wf, steps })
      set({ workflows: m })
    } catch (e) {
      console.warn('refreshWorkflow failed:', id, e)
    }
  },

  fetchTypes: async () => {
    try {
      const types = await api.types()
      set({ types })
    } catch (e) {
      console.warn('fetchTypes failed:', e)
    }
  },

  fetchMetrics: async () => {
    try {
      const metrics = await api.metrics()
      set({ metrics })
    } catch (e) {
      console.warn('fetchMetrics failed:', e)
    }
  },

  removeWorkflow: (id: string) => {
    const m = new Map(get().workflows)
    m.delete(id)
    set({ workflows: m })
  },
  wsEvents: [] as any[],
  addWsEvent: (ev: any) => {
    set(state => ({
      wsEvents: [ev, ...state.wsEvents].slice(0, 100)
    }))
  },
}))
