
import dotenv from 'dotenv'
dotenv.config()

import { pool, query } from '../../../packages/db'
import { engine, eventBatcher } from '../../../packages/engine'
import { logger } from '../../../packages/logger'
import { ecommerceCheckout, kycVerification, loanDisbursement } from '../../../packages/workflows/ecommerce'
import { userOnboarding } from '../../../packages/workflows/manual'
import type { Workflow } from '../../../packages/types'

// Register all workflow definitions (must match server)
engine.register('ecommerce-checkout', ecommerceCheckout)
engine.register('kyc-verification', kycVerification)
engine.register('loan-disbursement', loanDisbursement)
engine.register('user-onboarding', userOnboarding)

const WORKER_ID = process.env.WORKER_ID || 'worker-1'
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || '500')
const MAX_CONCURRENT = 10

let activeSteps = 0
let pollCount = 0

logger.info({ workerId: WORKER_ID, pollMs: POLL_MS, maxConcurrent: MAX_CONCURRENT }, 'Atlas worker started')

async function poll(): Promise<void> {
  if (activeSteps >= MAX_CONCURRENT) return
  pollCount++

  try {
    // Hyper-Scale Atomic Step Claiming: 1 SQL round-trip to reserve next ready DAG step across all running workflows
    while (activeSteps < MAX_CONCURRENT) {
      const claimed = await engine.claimNextReadyStep()
      if (!claimed) break

      activeSteps++
      engine.executeClaimedStep(claimed)
        .catch(err => logger.error({ err: err.message, workflowId: claimed.workflow_id, step: claimed.name }, 'step error'))
        .finally(() => { activeSteps-- })
    }

    // Log stats every 100 polls
    if (pollCount % 100 === 0) {
      logger.info({ workerId: WORKER_ID, activeSteps, pollCount }, 'worker hyper-scale stats')
    }
  } catch (err: any) {
    logger.error({ err: err.message }, 'poll error')
  }
}

const interval = setInterval(poll, POLL_MS)

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal, activeSteps }, 'worker shutdown initiated')
  clearInterval(interval)

  // Wait for active steps to finish (max 30s)
  const deadline = Date.now() + 30000
  while (activeSteps > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200))
  }

  if (activeSteps > 0) logger.warn({ activeSteps }, 'forced shutdown with active steps')
  else logger.info('worker exited cleanly')

  await eventBatcher.shutdown()
  await pool.end()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'))
