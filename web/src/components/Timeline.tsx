
import { useState } from 'react'
import type { Event, Step } from '../types'
import { STATUS_COLOR } from '../lib/colors'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function relTime(iso: string, base: string) {
  const ms = new Date(iso).getTime() - new Date(base).getTime()
  if (ms < 1000) return '+' + ms + 'ms'
  return '+' + (ms / 1000).toFixed(1) + 's'
}

const LEVEL_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  info: { color: '#64748b', bg: 'rgba(100,116,139,.05)', border: 'rgba(100,116,139,.1)' },
  warn: { color: '#fbbf24', bg: 'rgba(251,191,36,.05)', border: 'rgba(251,191,36,.12)' },
  error: { color: '#f87171', bg: 'rgba(248,113,113,.05)', border: 'rgba(248,113,113,.12)' },
  success: { color: '#34d399', bg: 'rgba(52,211,153,.04)', border: 'rgba(52,211,153,.12)' },
}

export function Timeline({ events, steps, baseTime }: { events: Event[]; steps: Step[]; baseTime: string }) {
  const stepMap = Object.fromEntries(steps.map(s => [s.id, s]))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (events.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0' }} className="mono">
        <span style={{ fontSize: 11, color: '#334155' }}>No events recorded yet</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 0' }}>
      {events.map((ev, i) => {
        const style = LEVEL_STYLE[ev.level] || LEVEL_STYLE.info
        const step = ev.step_id ? stepMap[ev.step_id] : null
        const isExpanded = expandedId === ev.id
        const hasPayload = Object.keys(ev.payload).length > 0
        const isImportant = ev.level === 'error' || ev.level === 'success' ||
          ev.type.includes('completed') || ev.type.includes('failed') ||
          ev.type.includes('compensat') || ev.type.includes('paused') ||
          ev.type.includes('approved')

        return (
          <div key={ev.id}
            onClick={() => hasPayload && setExpandedId(isExpanded ? null : ev.id)}
            style={{
              display: 'flex', gap: 10, padding: '8px 12px', borderRadius: 8,
              background: style.bg, border: `1px solid ${style.border}`,
              cursor: hasPayload ? 'pointer' : 'default',
              animation: `slide-up .25s cubic-bezier(.22,1,.36,1) ${i * 0.015}s both`,
              transition: 'all .2s',
            }}>
            {/* Dot + line connector */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
              <div style={{
                width: isImportant ? 8 : 6, height: isImportant ? 8 : 6, borderRadius: '50%',
                background: style.color, marginTop: 3,
                boxShadow: isImportant ? `0 0 8px ${style.color}` : `0 0 4px ${style.color}`,
              }}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10, color: style.color, fontWeight: 600 }}>
                  {ev.type}
                </span>
                {step && (
                  <span className="mono" style={{
                    fontSize: 9, color: 'var(--text-secondary)',
                    background: 'var(--input-bg)', padding: '2px 7px',
                    borderRadius: 4, border: '1px solid var(--border-color)',
                  }}>
                    {step.name.replace(/_/g, ' ')}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {relTime(ev.created_at, baseTime)}
                  </span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {fmtTime(ev.created_at)}
                  </span>
                </span>
              </div>
              {hasPayload && isExpanded && (
                <pre className="mono" style={{
                  fontSize: 9.5, color: 'var(--text-secondary)', margin: '4px 0 0', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all', lineHeight: 1.7,
                  padding: '8px 10px', background: 'var(--input-bg)', borderRadius: 6,
                  border: '1px solid var(--border-color)',
                }}>
                  {JSON.stringify(ev.payload, null, 2)}
                </pre>
              )}
              {hasPayload && !isExpanded && (
                <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                  click to inspect payload ›
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
