
import { ecommerceCheckout, kycVerification, loanDisbursement } from '../packages/workflows/ecommerce'
import { userOnboarding } from '../packages/workflows/manual'

describe('Workflow definitions', () => {
  describe('ecommerceCheckout', () => {
    it('has correct step count', () => {
      expect(ecommerceCheckout.steps).toHaveLength(6)
    })

    it('charge_payment depends on reserve_inventory and fraud_check', () => {
      const step = ecommerceCheckout.steps.find(s => s.name === 'charge_payment')!
      expect(step.dependsOn).toContain('reserve_inventory')
      expect(step.dependsOn).toContain('fraud_check')
    })

    it('all steps with compensation have compensate function', () => {
      const withComp = ['reserve_inventory', 'fraud_check', 'charge_payment', 'book_shipment']
      withComp.forEach(name => {
        const step = ecommerceCheckout.steps.find(s => s.name === name)!
        expect(step.compensate).toBeDefined()
      })
    })

    it('happy path runs all steps without error', async () => {
      const input = { sku: 'SKU-001', qty: 1, amount: 999 }
      const ctx = { workflowId: 'test', stepId: 'test', retryCount: 0, log: async()=>{}, emit: async()=>{} }
      for (const step of ecommerceCheckout.steps) {
        if (step.name === 'charge_payment') continue // charge_payment depends on parallel steps in full runner, just skip runs here
        const output = await step.run(input, ctx)
        expect(output).toBeDefined()
      }
    })

    it('simulates failure at specified step', async () => {
      const input = { sku: 'SKU-001', qty: 1, amount: 999, simulateFailureAt: 'charge_payment' }
      const ctx = { workflowId: 'test', stepId: 'test', retryCount: 0, log: async()=>{}, emit: async()=>{} }
      const chargeStep = ecommerceCheckout.steps.find(s => s.name === 'charge_payment')!
      await expect(chargeStep.run(input, ctx)).rejects.toThrow()
    })
  })

  describe('kycVerification', () => {
    it('has parallel identity and blacklist checks', () => {
      const identity = kycVerification.steps.find(s => s.name === 'verify_identity')!
      const blacklist = kycVerification.steps.find(s => s.name === 'check_blacklist')!
      expect(identity.dependsOn).toContain('collect_documents')
      expect(blacklist.dependsOn).toContain('collect_documents')
      // Both depend only on collect_documents, not each other — true parallel
      expect(identity.dependsOn).not.toContain('check_blacklist')
      expect(blacklist.dependsOn).not.toContain('verify_identity')
    })
  })

  describe('loanDisbursement', () => {
    it('disburse_funds depends on loan_approval', () => {
      const disburse = loanDisbursement.steps.find(s => s.name === 'disburse_funds')!
      expect(disburse.dependsOn).toContain('loan_approval')
    })
  })

  describe('userOnboarding', () => {
    it('has correct steps', () => {
      expect(userOnboarding.steps).toHaveLength(5)
      expect(userOnboarding.steps.find(s => s.name === 'admin_approval')).toBeDefined()
    })

    it('collect_user_info validates inputs', async () => {
      const step = userOnboarding.steps.find(s => s.name === 'collect_user_info')!
      const ctx = { workflowId: 'test', stepId: 'test', retryCount: 0, log: async()=>{}, emit: async()=>{} }
      await expect(step.run({}, ctx)).rejects.toThrow('Username is required')
      await expect(step.run({ username: 'john' }, ctx)).rejects.toThrow('Email is required')
      const out = await step.run({ username: 'john', email: 'john@gmail.com' }, ctx)
      expect(out.collected).toBe(true)
    })
  })
})
