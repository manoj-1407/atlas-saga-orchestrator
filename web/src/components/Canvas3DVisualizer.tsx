import { useEffect, useRef } from 'react'
import type { Step } from '../types'

interface Props {
  steps: Step[]
  workflowStatus?: string
}

interface Particle {
  x: number
  y: number
  targetX: number
  targetY: number
  vx: number
  vy: number
  progress: number
  speed: number
  color: string
  size: number
}

export function Canvas3DVisualizer({ steps, workflowStatus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    const width = canvas.width
    const height = canvas.height

    // Calculate node coordinates in a layout grid
    const nodes = steps.map((s, idx) => {
      const col = idx % 3
      const row = Math.floor(idx / 3)
      const x = 120 + col * 200
      const y = 80 + row * 100
      return {
        ...s,
        x,
        y,
        color:
          s.status === 'success'
            ? '#34d399'
            : s.status === 'failed'
            ? '#f87171'
            : s.status === 'running' || s.status === 'compensating'
            ? '#818cf8'
            : '#64748b',
      }
    })

    // Spawn traveling execution pulses along dependency connections
    const particles: Particle[] = []
    nodes.forEach((n) => {
      if (n.depends_on && Array.isArray(n.depends_on)) {
        n.depends_on.forEach((depName) => {
          const parentNode = nodes.find((p) => p.name === depName)
          if (parentNode) {
            for (let i = 0; i < 3; i++) {
              particles.push({
                x: parentNode.x,
                y: parentNode.y,
                targetX: n.x,
                targetY: n.y,
                vx: 0,
                vy: 0,
                progress: Math.random(),
                speed: 0.008 + Math.random() * 0.008,
                color: n.color,
                size: 3 + Math.random() * 2
              })
            }
          }
        })
      }
    })

    let pulseTime = 0

    const render = () => {
      pulseTime += 0.03
      ctx.clearRect(0, 0, width, height)

      // Draw background grid lines with subtle depth effect
      ctx.strokeStyle = 'rgba(129, 140, 248, 0.05)'
      ctx.lineWidth = 1
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // Draw Connection Edges with animated dash energy flow
      nodes.forEach((n) => {
        if (n.depends_on && Array.isArray(n.depends_on)) {
          n.depends_on.forEach((depName) => {
            const parent = nodes.find((p) => p.name === depName)
            if (parent) {
              ctx.beginPath()
              ctx.moveTo(parent.x, parent.y)
              ctx.lineTo(n.x, n.y)
              ctx.strokeStyle = n.status === 'success' ? 'rgba(52, 211, 153, 0.35)' : 'rgba(129, 140, 248, 0.2)'
              ctx.lineWidth = 2
              ctx.setLineDash([6, 6])
              ctx.lineDashOffset = -pulseTime * 20
              ctx.stroke()
              ctx.setLineDash([])
            }
          })
        }
      })

      // Draw Dynamic Traveling Energy Particles
      particles.forEach((p) => {
        p.progress += p.speed
        if (p.progress > 1) p.progress = 0

        const curX = p.x + (p.targetX - p.x) * p.progress
        const curY = p.y + (p.targetY - p.y) * p.progress

        ctx.beginPath()
        ctx.arc(curX, curY, p.size, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.shadowBlur = 10
        ctx.shadowColor = p.color
        ctx.fill()
        ctx.shadowBlur = 0
      })

      // Draw 3D-Style Glowing Nodes
      nodes.forEach((n) => {
        const glowRadius = 24 + Math.sin(pulseTime + n.x) * 4

        // Outer Glow Ring
        const grad = ctx.createRadialGradient(n.x, n.y, 5, n.x, n.y, glowRadius)
        grad.addColorStop(0, n.color)
        grad.addColorStop(1, 'transparent')

        ctx.beginPath()
        ctx.arc(n.x, n.y, glowRadius, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()

        // Inner Core Circle (Hollow visual style matching current theme)
        const currentThemeBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#0f172a'
        ctx.beginPath()
        ctx.arc(n.x, n.y, 14, 0, Math.PI * 2)
        ctx.fillStyle = currentThemeBg
        ctx.strokeStyle = n.color
        ctx.lineWidth = 2.5
        ctx.fill()
        ctx.stroke()

        // Node Label
        ctx.font = '11px Space Grotesk, sans-serif'
        ctx.fillStyle = n.color
        ctx.textAlign = 'center'
        ctx.fillText(n.name, n.x, n.y + 32)
      })

      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [steps, workflowStatus])

  return (
    <div style={{ position: 'relative', width: '100%', height: 320, borderRadius: 12, overflow: 'hidden', background: 'var(--input-bg)', border: '1px solid var(--border-color)' }}>
      <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#818cf8', boxShadow: '0 0 8px #818cf8', animation: 'glow-pulse 1.5s infinite' }} />
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1.5 }}>
          Real-Time Physics Canvas Visualizer
        </span>
      </div>
      <canvas ref={canvasRef} width={650} height={320} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}
