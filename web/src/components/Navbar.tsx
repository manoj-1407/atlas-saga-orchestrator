
import { useStore } from '../store'
import { useTheme, Theme } from '../context/ThemeContext'
import { useState } from 'react'

interface Props {
  page: string
  onPage: (p: string) => void
  onOpenBuilder?: () => void
}

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: '⬡' },
  { id: 'workflows', label: 'Workflows', icon: '≡' },
  { id: 'metrics', label: 'Metrics', icon: '◈' },
  { id: 'replay', label: 'Replay', icon: '↺' },
]

export function Navbar({ page, onPage, onOpenBuilder }: Props) {
  const { workflows, wsStatus } = useStore()
  const { theme, setTheme } = useTheme()
  const [showThemeMenu, setShowThemeMenu] = useState(false)

  const total = workflows.size
  const running = Array.from(workflows.values()).filter(e => e.wf.status === 'running').length
  const paused = Array.from(workflows.values()).filter(e => e.wf.status === 'paused').length
  const live = wsStatus === 'live'
  const err = wsStatus === 'error' || wsStatus === 'disconnected'

  const themeIcons: Record<Theme, string> = {
    dark: '🌙',
    light: '☀️',
    system: '💻'
  }

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, height: 56,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px',
      background: 'var(--nav-bg)', backdropFilter: 'blur(24px)',
      borderBottom: '1px solid var(--border-color)',
      transition: 'all 0.3s ease'
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width="32" height="32" viewBox="0 0 32 32">
          <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="rgba(129,140,248,0.08)" stroke="#818cf8" strokeWidth="1.5"/>
          <polygon points="16,7 23,11 23,21 16,25 9,21 9,11" fill="none" stroke="rgba(129,140,248,0.25)" strokeWidth="1"/>
          <circle cx="16" cy="16" r="4" fill="none" stroke="#34d399" strokeWidth="1.5"/>
          <circle cx="16" cy="16" r="1.5" fill="#818cf8"/>
        </svg>
        <div>
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, letterSpacing: -0.3, color: 'var(--text-primary)', lineHeight: 1 }}>Atlas</div>
          <div className="mono" style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px', marginTop: 2 }}>Workflow Engine</div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display: 'flex', gap: 2 }}>
        {PAGES.map(p => (
          <button key={p.id} onClick={() => onPage(p.id)} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 12, fontFamily: 'Inter, sans-serif', fontWeight: page === p.id ? 600 : 400,
            background: page === p.id ? 'var(--glow-color)' : 'transparent',
            color: page === p.id ? 'var(--accent-color)' : 'var(--text-muted)',
            transition: 'all .2s', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 11, opacity: 0.7 }}>{p.icon}</span>
            {p.label}
          </button>
        ))}
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {onOpenBuilder && (
          <button
            onClick={onOpenBuilder}
            style={{
              padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-color)',
              background: 'var(--glow-color)', color: 'var(--accent-color)',
              fontFamily: 'Space Grotesk, sans-serif', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s'
            }}
          >
            <span>+</span> Custom Workflow
          </button>
        )}

        {/* Theme Toggle Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            style={{
              padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border-color)',
              background: 'var(--input-bg)', color: 'var(--text-primary)',
              fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
            }}
            title="Switch Theme (Dark/Light/System)"
          >
            <span>{themeIcons[theme]}</span>
            <span style={{ textTransform: 'capitalize', fontSize: 11 }}>{theme}</span>
          </button>

          {showThemeMenu && (
            <div style={{
              position: 'absolute', top: 38, right: 0, width: 120,
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', padding: 4, zIndex: 200
            }}>
              {(['dark', 'light', 'system'] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTheme(t); setShowThemeMenu(false); }}
                  style={{
                    width: '100%', padding: '6px 10px', textAlign: 'left', borderRadius: 6,
                    border: 'none', background: theme === t ? 'var(--glow-color)' : 'transparent',
                    color: theme === t ? 'var(--accent-color)' : 'var(--text-primary)',
                    fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  <span>{themeIcons[t]}</span>
                  <span style={{ textTransform: 'capitalize' }}>{t}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {paused > 0 && (
          <div className="mono" style={{
            fontSize: 9, padding: '4px 12px', borderRadius: 999, fontWeight: 600,
            border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8',
            background: 'rgba(56,189,248,0.08)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 6px #38bdf8', animation: 'glow-pulse 1.5s ease-in-out infinite' }}/>
            {paused} awaiting
          </div>
        )}
        {running > 0 && (
          <div className="mono" style={{
            fontSize: 9, padding: '4px 12px', borderRadius: 999, fontWeight: 600,
            border: '1px solid rgba(129,140,248,0.25)', color: '#a5b4fc',
            background: 'rgba(129,140,248,0.07)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#818cf8', boxShadow: '0 0 6px #818cf8', animation: 'glow-pulse 1.5s ease-in-out infinite' }}/>
            {running} running
          </div>
        )}
        <div className="mono" style={{
          fontSize: 9, padding: '4px 12px', borderRadius: 999,
          border: '1px solid var(--border-color)',
          color: 'var(--text-muted)', background: 'var(--input-bg)',
        }}>
          {total} workflow{total !== 1 ? 's' : ''}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 999,
          fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 500,
          border: `1px solid ${live ? 'rgba(52,211,153,0.25)' : err ? 'rgba(248,113,113,0.25)' : 'var(--border-color)'}`,
          color: live ? '#34d399' : err ? '#f87171' : 'var(--text-muted)',
          background: live ? 'rgba(52,211,153,0.06)' : err ? 'rgba(248,113,113,0.06)' : 'var(--input-bg)',
          transition: 'all 0.3s',
        }}>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: live ? '#34d399' : err ? '#f87171' : 'var(--text-muted)',
            boxShadow: live ? '0 0 6px #34d399' : 'none',
            transition: 'all 0.3s',
          }}/>
          {wsStatus}
        </div>
      </div>
    </nav>
  )
}
