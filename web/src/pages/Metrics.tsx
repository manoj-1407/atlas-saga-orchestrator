
import React, { useEffect } from 'react'
import { useStore } from '../store'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Legend
} from 'recharts'

const PALETTE = ['#818cf8', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#38bdf8', '#fb923c']

const TT_STYLE = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 8, fontSize: 10,
  fontFamily: 'JetBrains Mono, monospace',
  color: 'var(--text-secondary)',
}

function Card({ title, children, span = 1 }: { title: string; children: React.ReactNode; span?: number }) {
  return (
    <div className="glass-card" style={{
      padding: '16px 20px', gridColumn: span > 1 ? `span ${span}` : undefined,
    }}>
      <div className="section-label" style={{ marginBottom: 16 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Empty() {
  return (
    <div className="mono" style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
      No data available yet. Start some workflows to populate metrics.
    </div>
  )
}

export function Metrics() {
  const { metrics, fetchMetrics } = useStore()

  useEffect(() => {
    fetchMetrics()
    const t = setInterval(fetchMetrics, 8000)
    return () => clearInterval(t)
  }, [])

  if (!metrics) return (
    <div style={{ paddingTop: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 56px)' }}>
      <div className="mono" style={{ fontSize: 12, color: '#475569' }}>Loading metrics...</div>
    </div>
  )

  const total = metrics.total || 0
  const completed = metrics.byStatus?.completed || 0
  const failed = (metrics.byStatus?.failed || 0) + (metrics.byStatus?.compensation_failed || 0)
  const running = metrics.byStatus?.running || 0
  const paused = metrics.byStatus?.paused || 0
  const successRate = total > 0 ? Math.round(completed / total * 100) : 0
  const avgDur = Math.round(parseFloat(String((metrics as any).avgDuration || 0)) || 0)

  const statusData = Object.entries(metrics.byStatus || {})
    .filter(([, v]) => v > 0)
    .map(([status, count]) => ({ status: status.replace(/_/g, ' '), count }))

  const typeData = (metrics.byType || []).map((t: any) => ({
    name: String(t.workflow_type || '').replace(/-/g, ' '),
    count: parseInt(t.count || '0'),
    completed: parseInt(t.completed || '0'),
    avgMs: Math.round(parseFloat(t.avg_ms || '0')),
  }))

  const throughput = [...(metrics.throughput || [])].reverse().map((t: any) => ({
    time: new Date(t.minute).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    total: parseInt(t.count || '0'),
    completed: parseInt(t.completed || '0'),
    failed: parseInt(t.failed || '0'),
  }))

  const kpis = [
    { label: 'Total Workflows', value: total, color: '#818cf8' },
    { label: 'Completed', value: completed, color: '#34d399' },
    { label: 'Running', value: running, color: '#a78bfa' },
    { label: 'Awaiting Approval', value: paused, color: '#38bdf8' },
    { label: 'Success Rate', value: successRate + '%', color: successRate >= 80 ? '#34d399' : successRate >= 50 ? '#fbbf24' : '#f87171' },
    { label: 'Avg Duration', value: avgDur > 0 ? (avgDur / 1000).toFixed(2) + 's' : '—', color: '#fbbf24' },
  ]

  return (
    <div style={{ paddingTop: 56, height: 'calc(100vh - 56px)', overflowY: 'auto', padding: '24px 24px', background: 'var(--bg-primary)' }}>
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 16 }}>
        {kpis.map(k => (
          <div key={k.label} className="stat-card" style={{ '--accent': k.color + '40' } as React.CSSProperties}>
            <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: k.color, lineHeight: 1, marginBottom: 6 }}>{k.value}</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Charts grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card title="Throughput — last 60 min">
          {throughput.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={throughput} margin={{ top: 5, right: 0, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#818cf8" stopOpacity={.25}/><stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={.2}/><stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={.2}/><stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}/>
                <YAxis tick={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}/>
                <Tooltip contentStyle={TT_STYLE}/>
                <Area type="monotone" dataKey="total" stroke="#818cf8" fill="url(#g1)" strokeWidth={2} dot={false} name="Total"/>
                <Area type="monotone" dataKey="completed" stroke="#34d399" fill="url(#g2)" strokeWidth={1.5} dot={false} name="Completed"/>
                <Area type="monotone" dataKey="failed" stroke="#f87171" fill="url(#g3)" strokeWidth={1.5} dot={false} name="Failed"/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Status Breakdown">
          {statusData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={statusData} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={4}>
                  {statusData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} opacity={.85}/>)}
                </Pie>
                <Tooltip contentStyle={TT_STYLE}/>
                <Legend iconSize={8} wrapperStyle={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}/>
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card title="Workflows by Type">
          {typeData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={typeData} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 7.5, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}/>
                <YAxis tick={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}/>
                <Tooltip contentStyle={TT_STYLE}/>
                <Bar dataKey="count" radius={[4,4,0,0]} name="Total">{typeData.map((_,i)=><Cell key={i} fill={PALETTE[i % PALETTE.length]} opacity={.85}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Avg Duration by Type (ms)">
          {typeData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={typeData} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 7.5, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}/>
                <YAxis tick={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}/>
                <Tooltip contentStyle={TT_STYLE}/>
                <Bar dataKey="avgMs" radius={[4,4,0,0]} name="Avg ms">{typeData.map((_,i)=><Cell key={i} fill={PALETTE[(i+2)%PALETTE.length]} opacity={.85}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Completion Rate by Type">
          {typeData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={typeData.map(t => ({ ...t, rate: t.count > 0 ? Math.round(t.completed / t.count * 100) : 0 }))} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 7.5, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}/>
                <YAxis tick={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }} domain={[0, 100]}/>
                <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => v + '%'}/>
                <Bar dataKey="rate" radius={[4,4,0,0]} name="Success %">{typeData.map((_,i)=><Cell key={i} fill="#34d399" opacity={.75}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Recent errors */}
      {(metrics.recentErrors || []).length > 0 && (
        <Card title="Recent Errors">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(metrics.recentErrors || []).slice(0, 6).map((e: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 12px', background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 8 }}>
                <div className="mono" style={{ fontSize: 10, color: '#f87171', flex: 1 }}>{e.type}</div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-secondary)' }}>{e.workflow_name}</div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)' }}>{new Date(e.created_at).toLocaleTimeString()}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
