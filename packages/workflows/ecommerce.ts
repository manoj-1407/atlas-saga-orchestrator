
import type { WorkflowDefinition, StepContext } from '../types'

async function simulateDelay(min = 800, max = 2000) {
  if (process.env.NODE_ENV === 'test') return
  await new Promise(r => setTimeout(r, min + Math.random() * (max - min)))
}

export const ecommerceCheckout: WorkflowDefinition = {
  name: 'E-commerce Checkout',
  steps: [
    {
      name: 'validate_order',
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(200, 500)
        await ctx.emit('step.log', { msg: 'Validating order', sku: input.sku, qty: input.qty })
        if (input.simulateFailureAt === 'validate_order') throw new Error('Invalid order: SKU not found in catalog')
        if (!input.sku) throw new Error('SKU is required')
        if (input.qty < 1) throw new Error('Quantity must be at least 1')
        return { valid: true, sku: input.sku, qty: input.qty, unitPrice: input.amount / input.qty }
      }
    },
    {
      name: 'reserve_inventory',
      dependsOn: ['validate_order'],
      maxRetries: 3,
      async run(input, ctx) {
        await simulateDelay(500, 1200)
        await ctx.emit('step.log', { msg: 'Reserving inventory', sku: input.sku, qty: input.qty })
        if (input.simulateFailureAt === 'reserve_inventory') throw new Error('Insufficient inventory for SKU: ' + input.sku)
        const reservationId = 'RES-' + Math.random().toString(36).slice(2,8).toUpperCase()
        return { reservationId, sku: input.sku, qty: input.qty, warehouseLocation: 'WH-HYD-A3' }
      },
      async compensate(input, output, ctx) {
        await simulateDelay(300, 700)
        await ctx.emit('step.log', { msg: 'Releasing inventory reservation', reservationId: output.reservationId })
        if (input.simulateCompensationFailureAt === 'reserve_inventory') throw new Error('Failed to release reservation — warehouse system timeout')
      }
    },
    {
      name: 'fraud_check',
      dependsOn: ['validate_order'],
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(600, 1500)
        await ctx.emit('step.log', { msg: 'Running fraud analysis', amount: input.amount })
        if (input.simulateFailureAt === 'fraud_check') throw new Error('Transaction flagged: unusual purchase pattern detected')
        const score = Math.floor(Math.random() * 30) + 5
        return { approved: true, riskScore: score, riskLevel: score < 20 ? 'low' : 'medium', checkId: 'FRD-' + Date.now() }
      },
      async compensate(input, output, ctx) {
        await simulateDelay(200, 400)
        await ctx.emit('step.log', { msg: 'Clearing fraud hold', checkId: output.checkId })
      }
    },
    {
      name: 'charge_payment',
      dependsOn: ['reserve_inventory', 'fraud_check'],
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(800, 2000)
        await ctx.emit('step.log', { msg: 'Processing payment', amount: input.amount, currency: 'INR' })
        if (input.simulateFailureAt === 'charge_payment') throw new Error('Payment declined: insufficient funds')
        const paymentId = 'PAY-' + Math.random().toString(36).slice(2,10).toUpperCase()
        return { paymentId, amount: input.amount, currency: 'INR', gateway: input.razorpayKeyId ? 'razorpay' : 'simulated', status: 'captured' }
      },
      async compensate(input, output, ctx) {
        await simulateDelay(600, 1200)
        await ctx.emit('step.log', { msg: 'Initiating refund', paymentId: output.paymentId, amount: input.amount })
        if (input.simulateCompensationFailureAt === 'charge_payment') throw new Error('Refund failed: gateway timeout')
        const refundId = 'REF-' + Math.random().toString(36).slice(2,8).toUpperCase()
        await ctx.emit('payment.refunded', { refundId, paymentId: output.paymentId, amount: input.amount })
      }
    },
    {
      name: 'book_shipment',
      dependsOn: ['charge_payment'],
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(700, 1500)
        await ctx.emit('step.log', { msg: 'Booking shipment', address: input.address || 'Hyderabad, TG' })
        if (input.simulateFailureAt === 'book_shipment') throw new Error('No delivery partners available in this area')
        const trackingId = 'TRK-' + Math.random().toString(36).slice(2,10).toUpperCase()
        return { trackingId, carrier: 'Atlas Logistics', estimatedDelivery: '2-3 business days', pickupTime: '6pm today' }
      },
      async compensate(input, output, ctx) {
        await simulateDelay(300, 600)
        await ctx.emit('step.log', { msg: 'Cancelling shipment', trackingId: output.trackingId })
      }
    },
    {
      name: 'send_confirmation',
      dependsOn: ['book_shipment'],
      maxRetries: 3,
      async run(input, ctx) {
        await simulateDelay(300, 700)
        await ctx.emit('step.log', { msg: 'Sending confirmation', to: input.email || 'customer@example.com' })
        if (input.simulateFailureAt === 'send_confirmation') throw new Error('Email service unavailable')
        return { sent: true, to: input.email || 'customer@example.com', template: 'order_confirmed', messageId: 'MSG-' + Date.now() }
      }
    }
  ]
}

export const kycVerification: WorkflowDefinition = {
  name: 'KYC Verification',
  steps: [
    {
      name: 'collect_documents',
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(300, 800)
        if (input.simulateFailureAt === 'collect_documents') throw new Error('Document upload failed: file too large')
        return { documents: ['aadhaar', 'pan'], collected: true, documentIds: ['DOC-' + Date.now()] }
      }
    },
    {
      name: 'verify_identity',
      dependsOn: ['collect_documents'],
      maxRetries: 3,
      async run(input, ctx) {
        await simulateDelay(1000, 2500)
        if (input.simulateFailureAt === 'verify_identity') throw new Error('Identity verification failed: name mismatch')
        return { verified: true, matchScore: Math.floor(Math.random() * 20) + 80, provider: 'DigiLocker' }
      }
    },
    {
      name: 'check_blacklist',
      dependsOn: ['collect_documents'],
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(500, 1200)
        if (input.simulateFailureAt === 'check_blacklist') throw new Error('Database connection timeout')
        return { cleared: true, databases: ['CIBIL', 'CERSAI', 'RBI'], score: Math.floor(Math.random() * 100) + 700 }
      }
    },
    {
      name: 'approve_account',
      dependsOn: ['verify_identity', 'check_blacklist'],
      maxRetries: 1,
      async run(input, ctx) {
        await simulateDelay(400, 800)
        if (input.simulateFailureAt === 'approve_account') throw new Error('Compliance hold: manual review required')
        return { approved: true, accountId: 'ACC-' + Math.random().toString(36).slice(2,8).toUpperCase(), tier: 'standard', limits: { daily: 100000, monthly: 500000 } }
      }
    },
    {
      name: 'send_welcome',
      dependsOn: ['approve_account'],
      maxRetries: 3,
      async run(input, ctx) {
        await simulateDelay(200, 500)
        return { sent: true, channel: 'email+sms', template: 'welcome_kyc_approved' }
      }
    }
  ]
}

export const loanDisbursement: WorkflowDefinition = {
  name: 'Loan Disbursement',
  steps: [
    {
      name: 'credit_score_check',
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(800, 2000)
        if (input.simulateFailureAt === 'credit_score_check') throw new Error('Credit bureau timeout')
        const score = Math.floor(Math.random() * 300) + 600
        return { score, bureau: 'CIBIL', eligible: score > 700, timestamp: new Date().toISOString() }
      }
    },
    {
      name: 'income_verification',
      dependsOn: ['credit_score_check'],
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(1000, 2500)
        if (input.simulateFailureAt === 'income_verification') throw new Error('ITR fetch failed: PAN not linked')
        return { verified: true, annualIncome: input.amount * 12, employmentType: 'salaried', employer: 'Infosys Ltd' }
      }
    },
    {
      name: 'loan_approval',
      dependsOn: ['credit_score_check', 'income_verification'],
      maxRetries: 1,
      async run(input, ctx) {
        await simulateDelay(600, 1500)
        if (input.simulateFailureAt === 'loan_approval') throw new Error('Loan denied: debt-to-income ratio too high')
        return { approved: true, loanId: 'LN-' + Math.random().toString(36).slice(2,8).toUpperCase(), amount: input.amount, interestRate: 10.5, tenure: 36 }
      },
      async compensate(input, output, ctx) {
        await simulateDelay(300, 600)
        await ctx.emit('step.log', { msg: 'Cancelling loan approval', loanId: output.loanId })
      }
    },
    {
      name: 'disburse_funds',
      dependsOn: ['loan_approval'],
      maxRetries: 2,
      async run(input, ctx) {
        await simulateDelay(1500, 3000)
        if (input.simulateFailureAt === 'disburse_funds') throw new Error('NEFT transfer failed: bank server down')
        const utrNo = 'UTR' + Date.now()
        return { disbursed: true, utrNo, amount: input.amount, accountNo: 'XXXX9876', ifsc: 'HDFC0001234' }
      },
      async compensate(input, output, ctx) {
        await simulateDelay(800, 1500)
        await ctx.emit('step.log', { msg: 'Initiating loan recall', utrNo: output.utrNo })
        if (input.simulateCompensationFailureAt === 'disburse_funds') throw new Error('Recall failed: funds already withdrawn')
      }
    },
    {
      name: 'send_sanction_letter',
      dependsOn: ['disburse_funds'],
      maxRetries: 3,
      async run(input, ctx) {
        await simulateDelay(300, 700)
        return { sent: true, documentId: 'SL-' + Date.now(), via: 'email+whatsapp' }
      }
    }
  ]
}
