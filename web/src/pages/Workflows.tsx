
import React, { useState, useMemo } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { STATUS_COLOR, STATUS_LABEL } from '../lib/colors'
import type { Event } from '../types'

function timeSince(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  return Math.floor(s / 3600) + 'h ago'
}

const TYPE_ICONS: Record<string, string> = { 'ecommerce-checkout': '🛒', 'kyc-verification': '🪪', 'loan-disbursement': '💰', 'user-onboarding': '👤' }
const STATUSES = ['all', 'running', 'completed', 'failed', 'paused', 'compensating', 'compensated', 'compensation_failed']
const TYPES = ['all', 'ecommerce-checkout', 'kyc-verification', 'loan-disbursement', 'user-onboarding']

export function Workflows() {
  const { workflows, refreshWorkflow, fetchAll } = useStore()
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedEvents, setExpandedEvents] = useState<Event[]>([])
  const [evLoading, setEvLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const entries = useMemo(() => {
    let all = Array.from(workflows.values())
    if (statusFilter !== 'all') all = all.filter(e => e.wf.status === statusFilter)
    if (typeFilter !== 'all') all = all.filter(e => e.wf.workflow_type === typeFilter)
    return all.sort((a, b) => new Date(b.wf.started_at).getTime() - new Date(a.wf.started_at).getTime())
  }, [workflows, statusFilter, typeFilter])

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    setEvLoading(true)
    try {
      const evs = await api.workflows.events(id)
      setExpandedEvents(evs)
    } finally {
      setEvLoading(false)
    }
  }

  async function doAction(action: 'retry' | 'cancel' | 'replay', id: string) {
    setActionLoading(id + action)
    try {
      if (action === 'retry') await api.workflows.retry(id)
      else if (action === 'cancel') await api.workflows.cancel(id, 'manual')
      else if (action === 'replay') {
        const wf = await api.workflows.replay(id)
        await refreshWorkflow(wf.id)
      }
      await refreshWorkflow(id)
    } catch (e: any) { alert(e.message) }
    finally { setActionLoading(null) }
  }

  const thStyle = { padding: '10px 14px', textAlign: 'left' as const, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '1.2px', fontWeight: 600, background: 'var(--nav-bg)', position: 'sticky' as const, top: 0, zIndex: 1, borderBottom: '1px solid var(--border-color)' }

  return (
    <div style={{ paddingTop: 56, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 12, flexShrink: 0, background: 'var(--nav-bg)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{ padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', background: statusFilter === s ? 'var(--glow-color)' : 'transparent', color: statusFilter === s ? 'var(--accent-color)' : 'var(--text-muted)', transition: 'all .18s' }}>
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--border-color)' }}/>
        <div style={{ display: 'flex', gap: 2 }}>
          {TYPES.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              style={{ padding: '4px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', background: typeFilter === t ? 'var(--glow-color)' : 'transparent', color: typeFilter === t ? 'var(--accent-color)' : 'var(--text-muted)', transition: 'all .15s' }}>
              {t === 'all' ? 'all types' : t.replace(/-/g, ' ')}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--text-muted)' }}>{entries.length} workflows</span>
          <button onClick={fetchAll} style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 10, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['', 'Workflow', 'Type', 'Status', 'Progress', 'Started', 'Duration', 'Actions'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                No workflows match the filter
              </td></tr>
            )}
            {entries.map(({ wf, steps }) => {
              const col = STATUS_COLOR[wf.status] || 'var(--text-muted)'
              const done = steps.filter(s => ['success', 'compensated'].includes(s.status)).length
              const dur = wf.finished_at
                ? ((new Date(wf.finished_at).getTime() - new Date(wf.started_at).getTime()) / 1000).toFixed(1) + 's'
                : wf.status === 'running' ? '...' : '—'
              const isExp = expandedId === wf.id

              return (
                <React.Fragment key={wf.id}>
                  <tr
                    style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background .12s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--input-bg)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    onClick={() => toggleExpand(wf.id)}>
                    <td style={{ padding: '9px 14px', width: 24 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', transform: isExp ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}>▸</div>
                    </td>
                    <td style={{ padding: '9px 14px' }}>
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--text-primary)', fontWeight: 600 }}>{wf.name}</div>
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: 'var(--text-muted)', marginTop: 1 }}>#{wf.id.slice(-8)}</div>
                    </td>
                    <td style={{ padding: '9px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 13 }}>{TYPE_ICONS[wf.workflow_type] || '⬡'}</span>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: 'var(--text-secondary)' }}>{wf.workflow_type.replace(/-/g, ' ')}</span>
                      </div>
                    </td>
                    <td style={{ padding: '9px 14px' }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, textTransform: 'uppercase', letterSpacing: .4, padding: '2px 7px', borderRadius: 999, background: `${col}15`, color: col, border: `1px solid ${col}33` }}>
                        {STATUS_LABEL[wf.status] || wf.status}
                      </span>
                    </td>
                    <td style={{ padding: '9px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 56, height: 4, background: 'var(--input-bg)', borderRadius: 2, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                          <div style={{ height: '100%', background: col, transition: 'width .4s', width: `${steps.length ? done / steps.length * 100 : 0}%` }}/>
                        </div>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--text-secondary)' }}>{done}/{steps.length}</span>
                      </div>
                    </td>
                    <td style={{ padding: '9px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--text-secondary)' }}>{timeSince(wf.started_at)}</td>
                    <td style={{ padding: '9px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--text-secondary)' }}>{dur}</td>
                    <td style={{ padding: '9px 14px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {['failed', 'compensation_failed'].includes(wf.status) && (
                          <button onClick={() => doAction('retry', wf.id)} disabled={actionLoading === wf.id + 'retry'}
                            style={{ padding: '2px 7px', borderRadius: 4, border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.08)', color: '#818cf8', fontSize: 8.5, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>
                            retry
                          </button>
                        )}
                        {wf.status === 'running' && (
                          <button onClick={() => doAction('cancel', wf.id)} disabled={actionLoading === wf.id + 'cancel'}
                            style={{ padding: '2px 7px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.07)', color: '#ef4444', fontSize: 8.5, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>
                            cancel
                          </button>
                        )}
                        <button onClick={() => doAction('replay', wf.id)} disabled={actionLoading === wf.id + 'replay'}
                          style={{ padding: '2px 7px', borderRadius: 4, border: '1px solid rgba(0,255,148,0.2)', background: 'rgba(0,255,148,0.06)', color: '#00ff94', fontSize: 8.5, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>
                          replay
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isExp && (
                    <tr>
                      <td colSpan={8} style={{ padding: '0 14px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingTop: 10 }}>
                          {/* Steps */}
                          <div>
                            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8.5, color: 'var(--text-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Steps</div>
                            {steps.map(s => {
                              const sc = STATUS_COLOR[s.status] || 'var(--text-muted)'
                              return (
                                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border-color)' }}>
                                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: sc, boxShadow: `0 0 4px ${sc}`, flexShrink: 0 }}/>
                                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--text-secondary)', flex: 1 }}>{s.name.replace(/_/g, ' ')}</span>
                                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: sc }}>{s.status}</span>
                                  {s.duration_ms != null && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: 'var(--text-muted)' }}>{s.duration_ms}ms</span>}
                                  {s.retry_count > 0 && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: '#f59e0b' }}>↺{s.retry_count}</span>}
                                  {s.error && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 7.5, color: '#ef4444', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.error}>{s.error}</span>}
                                </div>
                              )
                            })}
                          </div>
                          {/* Events */}
                          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8.5, color: 'var(--text-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Recent Events</div>
                            {evLoading ? (
                              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--text-muted)' }}>Loading...</div>
                            ) : expandedEvents.slice(-15).map(ev => (
                              <div key={ev.id} style={{ padding: '3px 0', borderBottom: '1px solid var(--border-color)' }}>
                                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8.5, color: ev.level === 'error' ? '#ef4444' : ev.level === 'success' ? '#34d399' : ev.level === 'warn' ? '#fbbf24' : '#818cf8' }}>{ev.type}</div>
                                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 7.5, color: 'var(--text-muted)', marginTop: 1 }}>{new Date(ev.created_at).toLocaleTimeString()}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
