import React, { useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'

interface Props {
  onClose: () => void
}

interface StepForm {
  name: string
  dependsOn: string
  maxRetries: number
}

export function WorkflowBuilderModal({ onClose }: Props) {
  const { fetchTypes } = useStore()
  const [type, setType] = useState('custom-process')
  const [name, setName] = useState('Custom Process Workflow')
  const [steps, setSteps] = useState<StepForm[]>([
    { name: 'step_one', dependsOn: '', maxRetries: 3 },
    { name: 'step_two', dependsOn: 'step_one', maxRetries: 3 }
  ])

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleAddStep = () => {
    setSteps([...steps, { name: `step_${steps.length + 1}`, dependsOn: steps[steps.length - 1]?.name || '', maxRetries: 3 }])
  }

  const handleRemoveStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx))
  }

  const handleStepChange = (idx: number, field: keyof StepForm, value: any) => {
    const updated = [...steps]
    updated[idx] = { ...updated[idx], [field]: value }
    setSteps(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const payload = {
        type,
        name,
        steps: steps.map(s => ({
          name: s.name,
          dependsOn: s.dependsOn ? s.dependsOn.split(',').map(d => d.trim()).filter(Boolean) : [],
          maxRetries: Number(s.maxRetries)
        }))
      }

      await api.customType(payload)
      setMessage(`Workflow '${name}' successfully registered!`)
      await fetchTypes()
      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err: any) {
      setMessage(err.message || 'Failed to register custom workflow')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        width: '100%', maxWidth: 640, background: 'var(--bg-card)',
        border: '1px solid var(--border-color)', borderRadius: 16,
        padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'Space Grotesk, sans-serif', fontSize: 18, color: 'var(--text-primary)' }}>
              Create Custom Workflow DAG
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Define multi-step execution graphs dynamically with dependencies and retries.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="section-label">Workflow Identifier (Type)</label>
            <input
              type="text" className="atlas-input"
              value={type} onChange={e => setType(e.target.value)} required
              placeholder="e.g. data-pipeline-v1"
            />
          </div>

          <div>
            <label className="section-label">Display Name</label>
            <input
              type="text" className="atlas-input"
              value={name} onChange={e => setName(e.target.value)} required
              placeholder="e.g. Enterprise Data Pipeline"
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label className="section-label" style={{ marginBottom: 0 }}>DAG Steps Definition</label>
              <button type="button" onClick={handleAddStep} className="btn-ghost" style={{ padding: '4px 10px' }}>
                + Add Step
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {steps.map((s, idx) => (
                <div key={idx} style={{
                  padding: 12, borderRadius: 8, background: 'var(--input-bg)',
                  border: '1px solid var(--border-color)', display: 'grid',
                  gridTemplateColumns: '1fr 1fr 80px 32px', gap: 8, alignItems: 'center'
                }}>
                  <input
                    type="text" className="atlas-input" placeholder="Step Name"
                    value={s.name} onChange={e => handleStepChange(idx, 'name', e.target.value)} required
                  />
                  <input
                    type="text" className="atlas-input" placeholder="Depends On (comma separated)"
                    value={s.dependsOn} onChange={e => handleStepChange(idx, 'dependsOn', e.target.value)}
                  />
                  <input
                    type="number" className="atlas-input" placeholder="Retries" min={1} max={10}
                    value={s.maxRetries} onChange={e => handleStepChange(idx, 'maxRetries', e.target.value)} required
                  />
                  {steps.length > 1 && (
                    <button
                      type="button" onClick={() => handleRemoveStep(idx)}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {message && (
            <div style={{
              padding: 10, borderRadius: 8, fontSize: 12,
              background: message.includes('successfully') ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
              color: message.includes('successfully') ? '#34d399' : '#f87171',
              border: `1px solid ${message.includes('successfully') ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`
            }}>
              {message}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button type="button" onClick={onClose} className="btn-ghost" style={{ padding: '8px 16px' }}>
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Registering...' : 'Register Workflow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
