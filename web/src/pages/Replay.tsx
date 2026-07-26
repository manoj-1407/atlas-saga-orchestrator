
import React, { useState } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { STATUS_COLOR, STATUS_LABEL } from '../lib/colors'
import type { Workflow } from '../types'

function timeSince(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  return Math.floor(s / 3600) + 'h ago'
}

const TYPE_ICONS: Record<string, string> = {
  'ecommerce-checkout': '🛒',
  'kyc-verification': '🪪',
  'loan-disbursement': '💰',
  'user-onboarding': '👤'
}

export function Replay() {
  const { workflows, refreshWorkflow, fetchAll } = useStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [overrides, setOverrides] = useState('{}')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Workflow | null>(null)
  const [error, setError] = useState('')
  const [jsonError, setJsonError] = useState('')

  // Show all terminal workflows as candidates
  const candidates = Array.from(workflows.values())
    .filter(e => ['failed', 'compensation_failed', 'compensated', 'completed'].includes(e.wf.status))
    .sort((a, b) => new Date(b.wf.started_at).getTime() - new Date(a.wf.started_at).getTime())

  const selectedEntry = selectedId ? workflows.get(selectedId) : null

  function selectWorkflow(wf: Workflow) {
    setSelectedId(wf.id)
    setResult(null)
    setError('')
    // Pre-fill overrides with original input, removing failure simulation
    const cleanInput = { ...wf.input }
    delete cleanInput.simulateFailureAt
    delete cleanInput.simulateCompensationFailureAt
    setOverrides(JSON.stringify(cleanInput, null, 2))
    setJsonError('')
  }

  function validateJson() {
    try { JSON.parse(overrides); setJsonError(''); return true }
    catch (e: any) { setJsonError('Invalid JSON: ' + e.message); return false }
  }

  async function doReplay() {
    if (!selectedId || !validateJson()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const input = JSON.parse(overrides)
      const wf = await api.workflows.replay(selectedId, input)
      await refreshWorkflow(wf.id)
      fetchAll()
      setResult(wf)
    } catch (e: any) {
      setError(e.message || 'Replay failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ paddingTop: 56, height: 'calc(100vh - 56px)', overflowY: 'auto', padding: '24px 24px', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 24, color: 'var(--text-primary)', letterSpacing: -.3, marginBottom: 6 }}>
            Workflow Replay Center
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
            Rerun any terminal workflow with modified input configurations. Use presets or direct edits below.<br/>
            Replaying generates a brand new workflow instance with the overrides, keeping original execution logs intact.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Left — workflow selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="glass-card" style={{ padding: '16px 20px' }}>
              <div className="section-label">
                Select Workflow to Replay
              </div>
              {candidates.length === 0 ? (
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', padding: '32px 0', textAlign: 'center', lineHeight: 1.8 }}>
                  No terminal workflows found.<br/>Execute some workflows to terminal states first.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
                  {candidates.map(({ wf }) => {
                    const col = STATUS_COLOR[wf.status] || 'var(--text-muted)'
                    const isSelected = selectedId === wf.id
                    return (
                      <div key={wf.id} onClick={() => selectWorkflow(wf)}
                        style={{
                          padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                          border: `1px solid ${isSelected ? col + '60' : 'var(--border-color)'}`,
                          background: isSelected ? `var(--glow-color)` : 'var(--input-bg)',
                          transition: 'all .2s',
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13 }}>{TYPE_ICONS[wf.workflow_type] || '⬡'}</span>
                            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-primary)', fontWeight: 600 }}>{wf.name}</span>
                          </div>
                          <span className="status-pill" style={{ background: `${col}15`, color: col, border: `1px solid ${col}33` }}>
                            {STATUS_LABEL[wf.status] || wf.status}
                          </span>
                        </div>
                        <div className="mono" style={{ fontSize: 8.5, color: 'var(--text-muted)' }}>
                          {wf.workflow_type.replace(/-/g, ' ')} • {timeSince(wf.started_at)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Original input preview */}
            {selectedEntry && (
              <div className="glass-card" style={{ padding: '16px 20px' }}>
                <div className="section-label">
                  Original Input Payload
                </div>
                <pre className="mono" style={{ fontSize: 9.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, lineHeight: 1.7, background: 'var(--input-bg)', padding: '10px', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                  {JSON.stringify(selectedEntry.wf.input, null, 2)}
                </pre>
                {selectedEntry.wf.error && (
                  <div style={{ marginTop: 12, padding: '10px', background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 8 }}>
                    <div className="mono" style={{ fontSize: 8.5, color: '#f87171', marginBottom: 4, fontWeight: 600 }}>TERMINATION REASON</div>
                    <div className="mono" style={{ fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{selectedEntry.wf.error}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right — override editor + result */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
              <div className="section-label">
                Input Overrides
              </div>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
                Edit the JSON payload below. These will replace/override original settings. Remove <span style={{ color: '#fbbf24' }}>simulateFailureAt</span> to execute a successful run.
              </div>
              <textarea
                value={overrides}
                onChange={e => { setOverrides(e.target.value); setJsonError('') }}
                onBlur={validateJson}
                className="atlas-input"
                style={{
                  height: 220,
                  border: `1px solid ${jsonError ? 'rgba(248,113,113,0.3)' : 'var(--border-color)'}`,
                  resize: 'vertical', lineHeight: 1.7,
                }}
              />
              {jsonError && <div className="mono" style={{ fontSize: 9.5, color: '#f87171', marginTop: 6 }}>✗ {jsonError}</div>}
            </div>

            {/* Quick fix presets */}
            {selectedEntry && (
              <div className="glass-card" style={{ padding: '14px 18px' }}>
                <div className="section-label">
                  Quick Fix Presets
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { label: 'Clean Failure Injections', fn: () => { const i = { ...JSON.parse(overrides) }; delete i.simulateFailureAt; delete i.simulateCompensationFailureAt; setOverrides(JSON.stringify(i, null, 2)) } },
                    { label: 'Re-use Original Input', fn: () => setOverrides(JSON.stringify(selectedEntry.wf.input, null, 2)) },
                    { label: 'Reset to Defaults', fn: () => setOverrides('{}') },
                  ].map(p => (
                    <button key={p.label} className="btn-ghost" onClick={() => { try { p.fn(); setJsonError('') } catch { setJsonError('Invalid JSON — fix it first') } }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button className="btn-primary" onClick={doReplay} disabled={!selectedId || loading || !!jsonError}>
              {loading ? (
                <>
                  <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite' }}/>
                  Starting Replay...
                </>
              ) : '↺  Replay Workflow'}
            </button>

            {error && (
              <div style={{ background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: '12px 14px' }}>
                <div className="mono" style={{ fontSize: 10, color: '#f87171', marginBottom: 4, fontWeight: 600 }}>✗ Replay execution failed</div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{error}</div>
              </div>
            )}

            {result && (
              <div style={{ background: 'rgba(52,211,153,0.04)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 10, padding: '14px' }}>
                <div className="mono" style={{ fontSize: 10, color: '#34d399', marginBottom: 8, fontWeight: 600 }}>✓ Replay Instance Created</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[
                    ['Name', result.name],
                    ['ID', result.id],
                    ['Type', result.workflow_type.replace(/-/g, ' ')],
                    ['Status', result.status],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: 10, fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5 }}>
                      <span style={{ color: 'var(--text-muted)', width: 60, flexShrink: 0 }}>{k}</span>
                      <span style={{ color: 'var(--text-primary)' }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div className="mono" style={{ marginTop: 10, fontSize: 9.5, color: 'var(--text-muted)' }}>
                  Navigate back to the Dashboard to monitor execution.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
