
import { useEffect, memo } from 'react'
import ReactFlow, { Handle,
  Background, Controls, MiniMap, MarkerType,
  Node, Edge, Position, useNodesState, useEdgesState,
  BackgroundVariant, ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { Step } from '../types'
import { STATUS_COLOR, STATUS_GLOW, STEP_ICON, STATUS_LABEL } from '../lib/colors'

const StepNode = memo(({ data }: { data: { step: Step } }) => {
  const { step } = data
  const col = STATUS_COLOR[step.status] || '#475569'
  const glow = STATUS_GLOW[step.status] || 'transparent'
  const icon = STEP_ICON[step.name] || '○'
  const running = step.status === 'running'
  const compensating = step.status === 'compensating'
  const paused = step.status === 'paused'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 120, position: 'relative' }}>
      {step.depends_on?.length > 0 && (
        <div className="mono" style={{
          position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
          fontSize: 8, color: 'var(--text-muted)', whiteSpace: 'nowrap',
        }}>
          after {step.depends_on.slice(0, 1).join(',')}
        </div>
      )}

      <div style={{
        width: 60, height: 60, borderRadius: '50%',
        border: `2px solid ${col}`,
        background: `radial-gradient(circle at 30% 30%, ${col}18, ${col}08)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
        position: 'relative', transition: 'all .4s',
        boxShadow: `0 0 ${running || compensating || paused ? '24px' : '12px'} ${glow}`,
        animation: running ? 'pulse-ring 1.5s ease-in-out infinite' :
          compensating ? 'pulse-amber 1.5s ease-in-out infinite' :
          paused ? 'pulse-cyan 1.5s ease-in-out infinite' : 'none',
      }}>
        <span>{icon}</span>
        {step.retry_count > 0 && (
          <div className="mono" style={{
            position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%',
            background: '#fbbf24', color: '#000', fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(251,191,36,.4)',
          }}>
            {step.retry_count}
          </div>
        )}
        {step.duration_ms != null && (
          <div className="mono" style={{
            position: 'absolute', bottom: -18, left: '50%', transform: 'translateX(-50%)',
            fontSize: 8, color: 'var(--text-muted)', whiteSpace: 'nowrap',
            background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: 3,
            border: '1px solid var(--border-color)',
          }}>
            {step.duration_ms > 1000 ? (step.duration_ms / 1000).toFixed(1) + 's' : step.duration_ms + 'ms'}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: 'var(--text-primary)', lineHeight: 1.4, maxWidth: 110, wordBreak: 'break-word', fontWeight: 600 }}>
          {step.name.replace(/_/g, ' ')}
        </div>
        <div className="mono" style={{
          fontSize: 8, color: col, marginTop: 3,
          textTransform: 'uppercase', letterSpacing: .5, fontWeight: 600,
        }}>
          {STATUS_LABEL[step.status] || step.status}
        </div>
      </div>

      <Handle type="target" position={Position.Left} style={{ background: col, border: `2px solid ${col}`, width: 9, height: 9, left: -4 }}/>
      <Handle type="source" position={Position.Right} style={{ background: col, border: `2px solid ${col}`, width: 9, height: 9, right: -4 }}/>
    </div>
  )
})

const nodeTypes = { step: StepNode }

function buildGraph(steps: Step[]) {
  if (!steps.length) return { nodes: [], edges: [] }

  // Layout: group by dependency level
  const levels: Record<string, number> = {}

  function getLevel(name: string): number {
    if (levels[name] !== undefined) return levels[name]
    const step = steps.find(s => s.name === name)
    if (!step || !step.depends_on?.length) { levels[name] = 0; return 0 }
    const maxDep = Math.max(...step.depends_on.map(d => getLevel(d)))
    levels[name] = maxDep + 1
    return levels[name]
  }

  steps.forEach(s => getLevel(s.name))

  // Group by level
  const byLevel: Record<number, Step[]> = {}
  steps.forEach(s => {
    const l = levels[s.name] || 0
    if (!byLevel[l]) byLevel[l] = []
    byLevel[l].push(s)
  })

  const XGAP = 190, YGAP = 110
  const nodes: Node[] = []
  Object.entries(byLevel).forEach(([level, levelSteps]) => {
    const x = parseInt(level) * XGAP
    levelSteps.forEach((step, i) => {
      const yOffset = (levelSteps.length - 1) * YGAP / 2
      nodes.push({
        id: step.name, type: 'step',
        position: { x, y: i * YGAP - yOffset + 70 },
        data: { step },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      })
    })
  })

  const edges: Edge[] = []
  steps.forEach(step => {
    (step.depends_on || []).forEach(dep => {
      const fromStep = steps.find(s => s.name === dep)
      const active = fromStep?.status === 'success'
      const rollback = ['compensating', 'compensated'].includes(fromStep?.status || '')
      const paused = fromStep?.status === 'paused'
      const col = active ? '#34d399' :
        rollback ? '#fbbf24' :
        paused ? '#38bdf8' : 'var(--text-muted)'
      edges.push({
        id: `${dep}-${step.name}`, source: dep, target: step.name,
        animated: active || rollback || paused,
        style: { stroke: col, strokeWidth: active || rollback || paused ? 2.5 : 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: col, width: 14, height: 14 },
      })
    })
  })

  return { nodes, edges }
}

function Flow({ steps }: { steps: Step[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(steps)
    setNodes(n); setEdges(e)
  }, [JSON.stringify(steps.map(s => s.status + s.retry_count + s.duration_ms))])

  if (!steps.length) return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <div style={{ fontSize: 48, opacity: .08 }} className="animate-float">⬡</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 2 }}>
        Select a workflow to see its execution graph
      </div>
    </div>
  )

  return (
    <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .35, maxZoom: 1.2 }}
      proOptions={{ hideAttribution: true }} minZoom={.2} maxZoom={2}>
      <Background variant={BackgroundVariant.Dots} gap={30} size={1} color="var(--border-color)"/>
      <Controls showInteractive={false}/>
      <MiniMap nodeColor={n => STATUS_COLOR[(n.data as any)?.step?.status || 'pending']}
        maskColor="rgba(6,8,15,.15)"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10 }}/>
    </ReactFlow>
  )
}

export function WorkflowGraph({ steps }: { steps: Step[] }) {
  return (
    <ReactFlowProvider>
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Flow steps={steps}/>
      </div>
    </ReactFlowProvider>
  )
}
