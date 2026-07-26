
import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useStore } from '../store'
import { WorkflowGraph } from '../components/WorkflowGraph'
import { Canvas3DVisualizer } from '../components/Canvas3DVisualizer'
import { WorkflowBuilderModal } from '../components/WorkflowBuilderModal'
import { Timeline } from '../components/Timeline'
import { api } from '../lib/api'
import { STATUS_COLOR, STATUS_LABEL, WF_COLOR } from '../lib/colors'
import type { Event } from '../types'

const TYPE_LABELS: Record<string, string> = {
  'ecommerce-checkout': 'E-commerce Checkout',
  'kyc-verification': 'KYC Verification',
  'loan-disbursement': 'Loan Disbursement',
  'user-onboarding': 'User Onboarding',
}
const TYPE_ICONS: Record<string, string> = {
  'ecommerce-checkout': '🛒',
  'kyc-verification': '🪪',
  'loan-disbursement': '💰',
  'user-onboarding': '👤',
}
const FAILURE_POINTS: Record<string, string[]> = {
  'ecommerce-checkout': ['validate_order','reserve_inventory','fraud_check','charge_payment','book_shipment','send_confirmation'],
  'kyc-verification': ['collect_documents','verify_identity','check_blacklist','approve_account'],
  'loan-disbursement': ['credit_score_check','income_verification','loan_approval','disburse_funds'],
  'user-onboarding': ['collect_user_info','verify_email_domain','create_user_account'],
}
const COMP_POINTS: Record<string, string[]> = {
  'ecommerce-checkout': ['reserve_inventory','charge_payment'],
  'kyc-verification': [],
  'loan-disbursement': ['loan_approval','disburse_funds'],
  'user-onboarding': ['create_user_account'],
}

function timeSince(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  return Math.floor(s / 3600) + 'h ago'
}

function formatTerminalLine(type: string, payload: any, ts: number) {
  const time = new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  let color = '#94a3b8'
  let prefix = 'INFO'
  let message = ''

  if (type === 'workflow.created') {
    color = '#818cf8'
    prefix = 'SYS'
    message = `Workflow started: '${payload.name}' of type '${payload.type}'`
  } else if (type === 'step.started') {
    color = '#c084fc'
    prefix = 'RUN'
    message = `Step started: ${payload.step}`
  } else if (type === 'step.completed') {
    color = '#34d399'
    prefix = 'OK'
    message = `Step completed: ${payload.step} in ${payload.durationMs || 0}ms`
  } else if (type === 'step.failed') {
    color = '#f87171'
    prefix = 'ERR'
    message = `Step failed: ${payload.step} — ${payload.error}`
  } else if (type === 'step.paused') {
    color = '#38bdf8'
    prefix = 'WAIT'
    message = `Step paused: ${payload.step} — awaiting manual user approval`
  } else if (type === 'step.approved') {
    color = '#34d399'
    prefix = 'APPR'
    message = `Step approved manually: ${payload.step}`
  } else if (type === 'step.retrying') {
    color = '#fbbf24'
    prefix = 'RETRY'
    message = `Step retrying: ${payload.step} — retry count increased (waiting backoff)`
  } else if (type === 'workflow.completed') {
    color = '#34d399'
    prefix = 'DONE'
    message = `Workflow completed successfully!`
  } else if (type === 'workflow.compensating') {
    color = '#fbbf24'
    prefix = 'ROLL'
    message = `Workflow compensating: initiating saga compensation due to failure at step '${payload.failedStep}'`
  } else if (type === 'workflow.compensated') {
    color = '#a78bfa'
    prefix = 'RBACK'
    message = `Workflow rolled back successfully.`
  } else if (type === 'workflow.compensation_failed') {
    color = '#f87171'
    prefix = 'FATAL'
    message = `Workflow compensation failed! System requires manual operational sync.`
  } else {
    prefix = type.split('.').pop()?.toUpperCase() || 'INFO'
    message = JSON.stringify(payload)
  }

  return { time, color, prefix, message }
}

export function Dashboard() {
  const { workflows, refreshWorkflow, fetchAll, wsEvents } = useStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [type, setType] = useState('ecommerce-checkout')
  const [fail, setFail] = useState('')
  const [comp, setComp] = useState('')
  const [params, setParams] = useState<Record<string, string>>({ sku: 'SKU-3003', qty: '1', amount: '1299' })
  const [loading, setLoading] = useState(false)
  const [events, setEvents] = useState<Event[]>([])
  const [evLoading, setEvLoading] = useState(false)
  const [lastError, setLastError] = useState('')
  const [approveLoading, setApproveLoading] = useState(false)
  const [viewTab, setViewTab] = useState<'timeline' | 'console'>('timeline')
  const [graphMode, setGraphMode] = useState<'flow' | 'canvas3d'>('flow')
  const [showBuilderModal, setShowBuilderModal] = useState(false)

  const entries = useMemo(() =>
    Array.from(workflows.values())
      .sort((a, b) => new Date(b.wf.started_at).getTime() - new Date(a.wf.started_at).getTime()),
    [workflows]
  )

  const selectedEntry = selectedId ? workflows.get(selectedId) : null

  // Find paused step for approval UI
  const pausedStep = useMemo(() => {
    if (!selectedEntry) return null
    return selectedEntry.steps.find(s => s.status === 'paused')
  }, [selectedEntry])

  const loadEvents = useCallback(async (id: string) => {
    setEvLoading(true)
    try {
      const evs = await api.workflows.events(id)
      setEvents(evs)
    } catch (e) {
      console.warn('loadEvents failed', e)
    } finally {
      setEvLoading(false)
    }
  }, [])

  // Auto-refresh events when selected workflow status changes
  useEffect(() => {
    if (!selectedId) return
    loadEvents(selectedId)
  }, [selectedId, selectedEntry?.wf.status, selectedEntry?.steps.map(s => s.status).join(',')])

  // Update default params when type changes
  useEffect(() => {
    if (type === 'ecommerce-checkout') {
      setParams({ sku: 'SKU-3003', qty: '1', amount: '1299' })
    } else if (type === 'user-onboarding') {
      setParams({ username: 'john_doe', email: 'john@example.com', role: 'admin' })
    } else {
      setParams({ amount: '50000', email: 'user@example.com' })
    }
    setFail('')
    setComp('')
  }, [type])

  async function run() {
    setLoading(true)
    setLastError('')
    try {
      const input: Record<string, any> = {}
      Object.entries(params).forEach(([k, v]) => {
        input[k] = isNaN(Number(v)) || v === '' ? v : Number(v)
      })
      if (fail) input.simulateFailureAt = fail
      if (comp) input.simulateCompensationFailureAt = comp
      const wf = await api.workflows.create(type, input)
      await refreshWorkflow(wf.id)
      setSelectedId(wf.id)
    } catch (e: any) {
      setLastError(e.message || 'Failed to start workflow')
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove() {
    if (!selectedEntry || !pausedStep) return
    setApproveLoading(true)
    try {
      await api.workflows.approve(selectedEntry.wf.id, pausedStep.name)
      await refreshWorkflow(selectedEntry.wf.id)
    } catch (e: any) {
      setLastError(e.message)
    } finally {
      setApproveLoading(false)
    }
  }

  async function handleReject() {
    if (!selectedEntry || !pausedStep) return
    setApproveLoading(true)
    try {
      await api.workflows.reject(selectedEntry.wf.id, pausedStep.name, 'Rejected by admin')
      await refreshWorkflow(selectedEntry.wf.id)
    } catch (e: any) {
      setLastError(e.message)
    } finally {
      setApproveLoading(false)
    }
  }

  const stats = useMemo(() => {
    const all = Array.from(workflows.values())
    return {
      total: all.length,
      running: all.filter(e => e.wf.status === 'running').length,
      completed: all.filter(e => e.wf.status === 'completed').length,
      failed: all.filter(e => ['failed', 'compensation_failed'].includes(e.wf.status)).length,
      paused: all.filter(e => e.wf.status === 'paused').length,
      compensating: all.filter(e => ['compensating', 'compensated'].includes(e.wf.status)).length,
    }
  }, [workflows])

  const terminalLines = useMemo(() => {
    const lines = [
      { time: 'System', color: '#64748b', prefix: 'INIT', message: 'Atlas engine terminal shell active.' }
    ]

    if (selectedEntry) {
      const historical = events.map(ev => formatTerminalLine(ev.type, ev.payload, new Date(ev.created_at).getTime()))
      lines.push(...historical)

      const live = wsEvents
        .filter(ev => ev.workflowId === selectedEntry.wf.id)
        .map(ev => formatTerminalLine(ev.type, ev.payload, ev.ts))
      
      const seen = new Set<string>()
      const merged: typeof lines = []
      
      lines.concat(live).forEach(l => {
        const key = `${l.time}-${l.prefix}-${l.message}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(l)
        }
      })
      return merged
    }

    return lines
  }, [events, wsEvents, selectedEntry?.wf.id])

  return (
    <div style={{ paddingTop: 56, display: 'grid', gridTemplateColumns: '1fr 1.2fr 360px', height: 'calc(100vh - 56px)', overflow: 'hidden' }}>

      {/* ═══ LEFT — Workflow List ═══ */}
      <div style={{ borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', flexShrink: 0, borderBottom: '1px solid var(--border-color)' }}>
          {[
            { label: 'Total', value: stats.total, color: 'var(--accent-color)' },
            { label: 'Running', value: stats.running, color: '#a78bfa' },
            { label: 'Done', value: stats.completed, color: '#34d399' },
            { label: 'Paused', value: stats.paused, color: '#38bdf8' },
            { label: 'Failed', value: stats.failed, color: '#f87171' },
          ].map(s => (
            <div key={s.label} className="stat-card" style={{ '--accent': s.color + '30' } as React.CSSProperties}>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', marginTop: 4, fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Workflow list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 36, opacity: .12 }} className="animate-float">⬡</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                No workflows yet<br/>Trigger one from the right panel →
              </div>
            </div>
          ) : entries.map(({ wf, steps }, idx) => {
            const col = STATUS_COLOR[wf.status] || '#475569'
            const typeCol = WF_COLOR[wf.workflow_type] || '#818cf8'
            const isSelected = selectedId === wf.id
            const done = steps.filter(s => ['success', 'compensated'].includes(s.status)).length
            const total = steps.length
            const hasPaused = steps.some(s => s.status === 'paused')

            return (
              <div key={wf.id} onClick={() => setSelectedId(wf.id)}
                className="animate-slide-up"
                style={{
                  padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                  border: `1px solid ${isSelected ? col + '50' : 'var(--border-color)'}`,
                  background: isSelected ? `var(--glow-color)` : 'var(--bg-secondary)',
                  boxShadow: isSelected ? `0 4px 16px ${col}12` : 'none',
                  transition: 'all .22s', position: 'relative', overflow: 'hidden',
                  animationDelay: `${idx * 0.03}s`,
                }}>
                {/* top glow line */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1.5, background: `linear-gradient(90deg,transparent,${col},transparent)`, opacity: isSelected ? .75 : .1 }}/>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 14 }}>{TYPE_ICONS[wf.workflow_type] || '⬡'}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-primary)', fontWeight: 600 }}>{wf.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {hasPaused && (
                      <span className="status-pill" style={{ background: 'rgba(56,189,248,.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,.2)' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#38bdf8', animation: 'pulse-cyan 1.5s ease-in-out infinite' }}/>
                        NEEDS APPROVAL
                      </span>
                    )}
                    <span className="status-pill" style={{ background: `${col}15`, color: col, border: `1px solid ${col}33` }}>
                      {STATUS_LABEL[wf.status] || wf.status}
                    </span>
                    <span className="mono" style={{ fontSize: 9, color: 'var(--text-muted)' }}>{timeSince(wf.started_at)}</span>
                  </div>
                </div>
                {/* Progress bar */}
                <div style={{ height: 4, background: 'var(--input-bg)', borderRadius: 2, overflow: 'hidden', margin: '8px 0 6px' }}>
                  <div style={{ height: '100%', borderRadius: 2, transition: 'width .6s cubic-bezier(.22,1,.36,1)', width: `${total > 0 ? done / total * 100 : 0}%`, background: `linear-gradient(90deg,${typeCol},${col})` }}/>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-secondary)' }}>{TYPE_LABELS[wf.workflow_type] || wf.workflow_type}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{done}/{total} steps</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══ CENTER — Graph + Timeline ═══ */}
      <div style={{ borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: '0 0 55%', borderBottom: '1px solid var(--border-color)', position: 'relative', background: 'var(--bg-primary)' }}>
          {selectedEntry ? (
            <>
              {graphMode === 'flow' ? (
                <WorkflowGraph steps={selectedEntry.steps} />
              ) : (
                <Canvas3DVisualizer steps={selectedEntry.steps} workflowStatus={selectedEntry.wf.status} />
              )}
              {/* Overlay header & Mode Selector */}
              <div style={{ position: 'absolute', top: 10, left: 12, display: 'flex', gap: 8, alignItems: 'center', zIndex: 20 }}>
                <div className="glass-card" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13 }}>{TYPE_ICONS[selectedEntry.wf.workflow_type] || '⬡'}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-primary)', fontWeight: 600 }}>{selectedEntry.wf.name}</span>
                  <span className="status-pill" style={{ background: `${STATUS_COLOR[selectedEntry.wf.status]}15`, color: STATUS_COLOR[selectedEntry.wf.status], border: `1px solid ${STATUS_COLOR[selectedEntry.wf.status]}33` }}>
                    {STATUS_LABEL[selectedEntry.wf.status]}
                  </span>
                </div>

                {/* Graph View Toggle */}
                <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 8, padding: 2, border: '1px solid var(--border-color)' }}>
                  <button
                    onClick={() => setGraphMode('flow')}
                    style={{
                      padding: '4px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      fontSize: 10, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600,
                      background: graphMode === 'flow' ? 'var(--glow-color)' : 'transparent',
                      color: graphMode === 'flow' ? 'var(--accent-color)' : 'var(--text-muted)'
                    }}
                  >
                    React Flow
                  </button>
                  <button
                    onClick={() => setGraphMode('canvas3d')}
                    style={{
                      padding: '4px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      fontSize: 10, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600,
                      background: graphMode === 'canvas3d' ? 'var(--glow-color)' : 'transparent',
                      color: graphMode === 'canvas3d' ? 'var(--accent-color)' : 'var(--text-muted)'
                    }}
                  >
                    3D Physics Canvas
                  </button>
                </div>
              </div>
              {/* Action buttons */}
              <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 6, zIndex: 20 }}>
                {['failed', 'compensation_failed'].includes(selectedEntry.wf.status) && (
                  <button className="btn-ghost" onClick={() => api.workflows.retry(selectedEntry.wf.id).then(() => refreshWorkflow(selectedEntry.wf.id))}>
                    ↻ Retry
                  </button>
                )}
                {selectedEntry.wf.status === 'running' && (
                  <button className="btn-reject" style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => api.workflows.cancel(selectedEntry.wf.id).then(() => refreshWorkflow(selectedEntry.wf.id))}>
                    ✕ Cancel
                  </button>
                )}
              </div>
              {/* Manual Approval Banner */}
              {pausedStep && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'linear-gradient(180deg, transparent, var(--bg-primary) 30%)',
                  padding: '32px 20px 16px',
                }}>
                  <div className="glass-card" style={{
                    padding: '14px 18px',
                    border: '1px solid rgba(56,189,248,.18)',
                    background: 'rgba(56,189,248,.04)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 16 }}>🔐</span>
                        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 13, color: '#38bdf8' }}>
                          Manual Approval Required
                        </span>
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        Step "{pausedStep.name.replace(/_/g, ' ')}" is waiting for admin review
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-reject" onClick={handleReject} disabled={approveLoading}>
                        ✕ Reject
                      </button>
                      <button className="btn-approve" onClick={handleApprove} disabled={approveLoading}>
                        {approveLoading ? '...' : '✓ Approve'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
              <div style={{ fontSize: 52, opacity: .06 }} className="animate-float">⬡</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 2 }}>
                Click a workflow to<br/>visualize its execution graph
              </div>
            </div>
          )}
        </div>

        {/* Section Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 16px', flexShrink: 0, justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', height: 38 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <button onClick={() => setViewTab('timeline')} style={{ background: 'transparent', border: 'none', color: viewTab === 'timeline' ? 'var(--accent-color)' : 'var(--text-muted)', fontSize: 10, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', cursor: 'pointer', padding: '8px 0', borderBottom: viewTab === 'timeline' ? '2px solid var(--accent-color)' : 'none', transition: 'all 0.2s' }}>
              Causal Timeline
            </button>
            <button onClick={() => setViewTab('console')} style={{ background: 'transparent', border: 'none', color: viewTab === 'console' ? 'var(--accent-color)' : 'var(--text-muted)', fontSize: 10, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', cursor: 'pointer', padding: '8px 0', borderBottom: viewTab === 'console' ? '2px solid var(--accent-color)' : 'none', transition: 'all 0.2s' }}>
              Live Engine Console
            </button>
          </div>
          {viewTab === 'console' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 6px #34d399', animation: 'glow-pulse 1.2s infinite' }}/>
              <span className="mono" style={{ fontSize: 8.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>STREAMING</span>
            </div>
          )}
        </div>

        {/* Timeline & Console Views */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {!selectedEntry ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }} className="mono" >
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Select a workflow to see logs/timeline</span>
            </div>
          ) : viewTab === 'timeline' ? (
            evLoading ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }} className="mono" >
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading events...</span>
              </div>
            ) : (
              <Timeline events={events} steps={selectedEntry.steps} baseTime={selectedEntry.wf.started_at} />
            )
          ) : (
            <div style={{ background: '#03050a', borderRadius: 8, padding: '12px 14px', border: '1px solid rgba(52,211,153,0.1)', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5, minHeight: 180 }}>
              {terminalLines.map((line, i) => (
                <div key={i} className="mono" style={{ fontSize: 9.5, lineHeight: 1.5, color: line.color, display: 'flex', gap: 8 }}>
                  <span style={{ color: '#475569' }}>[{line.time}]</span>
                  <span style={{ color: line.color, fontWeight: 600 }}>{line.prefix}</span>
                  <span style={{ color: '#475569' }}>›</span>
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line.message}</span>
                </div>
              ))}
              <div className="mono" style={{ fontSize: 9.5, color: '#34d399', display: 'flex', gap: 4, marginTop: 4 }}>
                <span>admin@atlas:~$</span>
                <span style={{ animation: 'breathe 1.2s infinite', fontWeight: 700 }}>█</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ RIGHT — Control Panel ═══ */}
      <div style={{ overflowY: 'auto', background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)' }}>
        {/* Workflow Type Selector */}
        <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid var(--border-color)' }}>
          <div className="section-label">Workflow Type</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <button key={k} onClick={() => setType(k)}
                style={{
                  padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 10,
                  border: `1px solid ${type === k ? (WF_COLOR[k] || '#818cf8') + '60' : 'var(--border-color)'}`,
                  background: type === k ? `${WF_COLOR[k] || '#818cf8'}15` : 'var(--input-bg)',
                  color: type === k ? 'var(--text-primary)' : 'var(--text-secondary)',
                  transition: 'all .2s',
                }}>
                <span style={{ fontSize: 16 }}>{TYPE_ICONS[k]}</span>
                <div>
                  <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 12, fontWeight: type === k ? 600 : 400 }}>{v}</div>
                  {k === 'user-onboarding' && (
                    <div className="mono" style={{ fontSize: 8, color: '#38bdf8', marginTop: 2 }}>MANUAL APPROVAL</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Parameters */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
          <div className="section-label">Parameters</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {type === 'ecommerce-checkout' ? (
              <>
                <div>
                  <div className="label-dim" style={{ marginBottom: 5 }}>Product SKU</div>
                  <input className="atlas-input" value={params.sku || ''} onChange={e => setParams(p => ({ ...p, sku: e.target.value }))} placeholder="SKU-3003"/>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div className="label-dim" style={{ marginBottom: 5 }}>Qty</div>
                    <input className="atlas-input" type="number" min={1} value={params.qty || ''} onChange={e => setParams(p => ({ ...p, qty: e.target.value }))} placeholder="1"/>
                  </div>
                  <div>
                    <div className="label-dim" style={{ marginBottom: 5 }}>Amount (₹)</div>
                    <input className="atlas-input" type="number" value={params.amount || ''} onChange={e => setParams(p => ({ ...p, amount: e.target.value }))} placeholder="1299"/>
                  </div>
                </div>
              </>
            ) : type === 'user-onboarding' ? (
              <>
                <div>
                  <div className="label-dim" style={{ marginBottom: 5 }}>Username</div>
                  <input className="atlas-input" value={params.username || ''} onChange={e => setParams(p => ({ ...p, username: e.target.value }))} placeholder="john_doe"/>
                </div>
                <div>
                  <div className="label-dim" style={{ marginBottom: 5 }}>Email</div>
                  <input className="atlas-input" value={params.email || ''} onChange={e => setParams(p => ({ ...p, email: e.target.value }))} placeholder="john@example.com"/>
                </div>
                <div>
                  <div className="label-dim" style={{ marginBottom: 5 }}>Role</div>
                  <input className="atlas-input" value={params.role || ''} onChange={e => setParams(p => ({ ...p, role: e.target.value }))} placeholder="admin"/>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="label-dim" style={{ marginBottom: 5 }}>Amount (₹)</div>
                  <input className="atlas-input" type="number" value={params.amount || ''} onChange={e => setParams(p => ({ ...p, amount: e.target.value }))} placeholder="50000"/>
                </div>
                <div>
                  <div className="label-dim" style={{ marginBottom: 5 }}>Email</div>
                  <input className="atlas-input" value={params.email || ''} onChange={e => setParams(p => ({ ...p, email: e.target.value }))} placeholder="user@example.com"/>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Failure Injection */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
          <div className="section-label" style={{ color: '#f87171' }}>Failure Injection</div>
          {[
            ['Forward Failure', fail, setFail, FAILURE_POINTS[type] || []] as const,
            ['Compensation Failure', comp, setComp, COMP_POINTS[type] || []] as const,
          ].map(([label, val, fn, opts]) => (
            <div key={label} style={{ marginBottom: 8, background: 'rgba(248,113,113,0.03)', border: '1px solid rgba(248,113,113,0.08)', borderRadius: 8, padding: '10px 11px' }}>
              <div className="mono" style={{ fontSize: 9, color: '#f87171', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 6, fontWeight: 600 }}>{label}</div>
              <select className="atlas-select" value={val} onChange={e => fn(e.target.value)}
                style={{ borderColor: 'rgba(248,113,113,0.12)' }}>
                <option value="">— none —</option>
                {opts.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          ))}
          {lastError && <div className="mono" style={{ fontSize: 10, color: '#f87171', marginBottom: 8, padding: '6px 8px', background: 'rgba(248,113,113,.06)', borderRadius: 6, border: '1px solid rgba(248,113,113,.12)' }}>✗ {lastError}</div>}
          <button className="btn-primary" onClick={run} disabled={loading} style={{ width: '100%' }}>
            {loading ? (
              <>
                <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite' }}/>
                Starting...
              </>
            ) : '▶  Run Workflow'}
          </button>
        </div>

        {/* Quick Scenarios */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
          <div className="section-label">Scenarios</div>
          {[
            { label: 'Happy Path', desc: 'All steps succeed', color: '#34d399', fail: '', comp: '' },
            { label: 'Rollback Demo', desc: 'Payment fails → auto refund', color: '#fbbf24', fail: type === 'ecommerce-checkout' ? 'charge_payment' : type === 'loan-disbursement' ? 'disburse_funds' : type === 'user-onboarding' ? 'create_user_account' : 'verify_identity', comp: '' },
            { label: 'Stuck Saga', desc: 'Compensation itself fails', color: '#f87171', fail: type === 'ecommerce-checkout' ? 'book_shipment' : type === 'loan-disbursement' ? 'disburse_funds' : type === 'user-onboarding' ? '' : 'approve_account', comp: type === 'ecommerce-checkout' ? 'charge_payment' : type === 'loan-disbursement' ? 'disburse_funds' : type === 'user-onboarding' ? 'create_user_account' : '' },
            { label: 'Early Fail', desc: 'Fails at first step', color: '#c084fc', fail: type === 'ecommerce-checkout' ? 'validate_order' : type === 'loan-disbursement' ? 'credit_score_check' : type === 'user-onboarding' ? 'collect_user_info' : 'collect_documents', comp: '' },
          ].map(p => (
            <div key={p.label} onClick={() => { setFail(p.fail); setComp(p.comp) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 8,
                border: '1px solid var(--border-color)', cursor: 'pointer', marginBottom: 5,
                background: 'var(--input-bg)', transition: 'all .2s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${p.color}22`; (e.currentTarget as HTMLElement).style.transform = 'translateX(3px)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)'; (e.currentTarget as HTMLElement).style.transform = 'none' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, boxShadow: `0 0 8px ${p.color}`, flexShrink: 0 }}/>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>{p.label}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{p.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Engine Info */}
        <div style={{ padding: '14px 16px' }}>
          <div className="section-label">Engine</div>
          {[
            ['Pattern', 'SAGA + DAG', 'var(--text-muted)'],
            ['Concurrency', 'SKIP LOCKED', '#34d399'],
            ['Idempotency', 'per-step keys', '#34d399'],
            ['Retries', 'exp. backoff', 'var(--text-muted)'],
            ['Compensation', 'auto rollback', 'var(--text-muted)'],
            ['Transport', 'pg_notify → WS', 'var(--text-muted)'],
            ['Approval', 'human-in-loop', '#38bdf8'],
          ].map(([k, v, c]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-color)' }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{k}</span>
              <span className="mono" style={{ fontSize: 10, color: c }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {showBuilderModal && (
        <WorkflowBuilderModal onClose={() => setShowBuilderModal(false)} />
      )}
    </div>
  )
}
