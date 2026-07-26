
import { EventEmitter } from 'events'

class AtlasEventBus extends EventEmitter {
  emitWorkflowUpdate(workflowId: string, type: string, payload: any) {
    this.emit('workflow_update', { workflowId, type, payload, ts: Date.now() })
  }
}

export const eventBus = new AtlasEventBus()
eventBus.setMaxListeners(100)
