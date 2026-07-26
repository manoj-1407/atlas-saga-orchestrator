
type Listener = (msg: any) => void

/**
 * AtlasWS — WebSocket client with auto-reconnect and event deduplication.
 *
 * Deduplication rationale:
 *   The server broadcasts events via pg_notify (database trigger → API listener
 *   → WS clients). Under normal operation each event fires once. However, if
 *   multiple API server replicas are running (e.g. in Docker Compose scaling),
 *   each replica listens on the same pg_notify channel and will forward the
 *   same event to its connected WS clients. A client connected to one replica
 *   receives one copy. A client connected through a load balancer that sticky-
 *   routes to one server also receives one copy. Dedup is a cheap safety net
 *   for any edge case where the same event ID arrives twice (e.g. reconnect
 *   burst). We keep a rolling window of the last 200 seen event IDs to bound
 *   memory usage.
 */
class AtlasWS {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private statusListeners = new Set<(s: string) => void>()
  private _status = 'connecting'

  // Rolling dedup window: stores event IDs seen in the last DEDUP_WINDOW events
  private seenEvents: string[] = []
  private static readonly DEDUP_WINDOW = 200

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    this.ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.setStatus('connecting')
    this.ws.onopen = () => this.setStatus('live')
    this.ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data)
        if (!this.isDuplicate(m)) {
          this.listeners.forEach(l => l(m))
        }
      } catch { /* ignore malformed frames */ }
    }
    this.ws.onclose = () => {
      this.setStatus('disconnected')
      setTimeout(() => this.connect(), 2500)
    }
    this.ws.onerror = () => this.setStatus('error')
  }

  /**
   * Check if this message has already been dispatched. Keyed on the event's
   * own row id, which is unique per event. We used to key on
   * workflowId:type:ts, but events inserted in the same batch (see
   * EventBatcher on the server) share one created_at timestamp — Postgres's
   * NOW() doesn't advance within a single statement — so that key collided
   * on real, distinct events and silently dropped them.
   */
  private isDuplicate(m: any): boolean {
    if (m.type !== 'workflow_update') return false
    const d = m.data
    if (!d?.id) return false
    if (this.seenEvents.includes(d.id)) return true
    this.seenEvents.push(d.id)
    if (this.seenEvents.length > AtlasWS.DEDUP_WINDOW) {
      this.seenEvents.shift()
    }
    return false
  }

  private setStatus(s: string) {
    this._status = s
    this.statusListeners.forEach(l => l(s))
  }

  on(l: Listener) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  onStatus(l: (s: string) => void) {
    this.statusListeners.add(l)
    return () => this.statusListeners.delete(l)
  }

  get status() { return this._status }
}

export const ws = new AtlasWS()
