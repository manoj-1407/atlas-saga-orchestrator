
import { useEffect, useState } from 'react'
import { Boot } from './components/Boot'
import { ParticleBg } from './components/ParticleBg'
import { Navbar } from './components/Navbar'
import { Dashboard } from './pages/Dashboard'
import { Workflows } from './pages/Workflows'
import { Metrics } from './pages/Metrics'
import { Replay } from './pages/Replay'
import { ws } from './lib/ws'
import { useStore } from './store'
import { ThemeProvider } from './context/ThemeContext'
import { WorkflowBuilderModal } from './components/WorkflowBuilderModal'

export default function App() {
  const [booted, setBooted] = useState(false)
  const [page, setPage] = useState('dashboard')
  const [showBuilderModal, setShowBuilderModal] = useState(false)
  const { fetchAll, refreshWorkflow, fetchTypes, setWsStatus } = useStore()

  useEffect(() => {
    ws.connect()

    const offMsg = ws.on((msg: any) => {
      if (msg.type === 'workflow_update') {
        const id = msg.data?.workflowId
        if (id) {
          refreshWorkflow(id)
          useStore.getState().addWsEvent({
            id: Math.random().toString(36).substring(2, 9),
            workflowId: id,
            type: msg.data.type,
            payload: msg.data.payload || {},
            ts: msg.data.ts || Date.now()
          })
        }
      }
    })

    const offStatus = ws.onStatus((status: string) => {
      setWsStatus(status)
    })

    fetchAll()
    fetchTypes()

    const t = setInterval(fetchAll, 8000)

    return () => {
      offMsg()
      offStatus()
      clearInterval(t)
    }
  }, [])

  if (!booted) return <Boot onDone={() => setBooted(true)} />

  const pages: Record<string, JSX.Element> = {
    dashboard: <Dashboard />,
    workflows: <Workflows />,
    metrics: <Metrics />,
    replay: <Replay />,
  }

  return (
    <ThemeProvider>
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        position: 'relative',
        fontFamily: 'Inter, system-ui, sans-serif',
        transition: 'all 0.3s ease'
      }}>
        {/* Scan line */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: '1px', zIndex: 200, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent, var(--glow-color), transparent)',
          animation: 'scan 10s linear infinite',
        }}/>
        <ParticleBg />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Navbar page={page} onPage={setPage} onOpenBuilder={() => setShowBuilderModal(true)} />
          <div key={page}>
            {pages[page] || <Dashboard />}
          </div>
        </div>
        {showBuilderModal && (
          <WorkflowBuilderModal onClose={() => setShowBuilderModal(false)} />
        )}
      </div>
    </ThemeProvider>
  )
}
