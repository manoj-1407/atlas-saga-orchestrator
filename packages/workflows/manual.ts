import type { WorkflowDefinition } from '../types'
import { PauseSignal } from '../engine'

async function simulateDelay(min = 400, max = 1000) {
  if (process.env.NODE_ENV === 'test') return
  await new Promise(r => setTimeout(r, min + Math.random() * (max - min)))
}

export const userOnboarding: WorkflowDefinition = {
  name: 'User Onboarding & Approval',
  steps: [
    {
      name: 'collect_user_info',
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(200, 500)
        await ctx.emit('step.log', { msg: 'User info collected', username: input.username, email: input.email })
        if (!input.username) throw new Error('Username is required')
        if (!input.email) throw new Error('Email is required')
        return { collected: true, username: input.username, email: input.email }
      }
    },
    {
      name: 'verify_email_domain',
      dependsOn: ['collect_user_info'],
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(300, 800)
        await ctx.emit('step.log', { msg: 'Verifying email domain', email: input.email })
        if (input.email.endsWith('@blacklisted.com')) {
          throw new Error('Email domain is blacklisted')
        }
        const domain = input.email.split('@')[1]
        return { domain, verified: true }
      }
    },
    {
      name: 'admin_approval',
      dependsOn: ['verify_email_domain'],
      maxRetries: 1,
      async run(input, ctx) {
        await simulateDelay(100, 300)
        await ctx.emit('step.log', { msg: 'Awaiting admin manual review' })
        throw new PauseSignal()
      },
      async compensate(input, output, ctx) {
        await ctx.emit('step.log', { msg: 'Admin approval revoked' })
      }
    },
    {
      name: 'create_user_account',
      dependsOn: ['admin_approval'],
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(500, 1200)
        await ctx.emit('step.log', { msg: 'Creating user account in database' })
        if (input.simulateFailureAt === 'create_user_account') {
          throw new Error('Database integrity violation: username already exists')
        }
        const userId = 'USR-' + Math.random().toString(36).slice(2,8).toUpperCase()
        return { userId, status: 'active', role: input.role || 'user' }
      },
      async compensate(input, output, ctx) {
        await simulateDelay(300, 600)
        await ctx.emit('step.log', { msg: 'Deactivating user account', userId: output.userId })
        if (input.simulateCompensationFailureAt === 'create_user_account') {
          throw new Error('Failed to delete user account: Database connection lost')
        }
      }
    },
    {
      name: 'send_welcome_kit',
      dependsOn: ['create_user_account'],
      maxRetries: 3,
      async run(input, ctx) {
        await simulateDelay(300, 700)
        await ctx.emit('step.log', { msg: 'Sending welcome kit email' })
        return { emailSent: true, messageId: 'MSG-W-' + Date.now() }
      }
    }
  ]
}
