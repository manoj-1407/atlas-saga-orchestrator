
export const STATUS_COLOR: Record<string,string> = {
  pending:'#475569', running:'#818cf8', success:'#34d399', completed:'#34d399',
  failed:'#f87171', compensating:'#fbbf24', compensated:'#c084fc',
  compensation_failed:'#f87171', skipped:'#475569', paused:'#38bdf8',
}
export const STATUS_GLOW: Record<string,string> = {
  running:'rgba(129,140,248,0.45)', success:'rgba(52,211,153,0.3)',
  completed:'rgba(52,211,153,0.3)', failed:'rgba(248,113,113,0.35)',
  compensating:'rgba(251,191,36,0.4)', compensated:'rgba(192,132,252,0.3)',
  compensation_failed:'rgba(248,113,113,0.35)', paused:'rgba(56,189,248,0.35)',
}
export const STATUS_LABEL: Record<string,string> = {
  running:'Running', completed:'Completed', failed:'Failed',
  compensating:'Rolling Back', compensated:'Rolled Back',
  compensation_failed:'Stuck', paused:'Awaiting Approval', pending:'Pending', success:'Success',
  skipped:'Skipped',
}
export const STEP_ICON: Record<string,string> = {
  validate_order:'✓', reserve_inventory:'📦', fraud_check:'🔍',
  charge_payment:'💳', book_shipment:'🚚', send_confirmation:'📧',
  collect_documents:'📄', verify_identity:'👤', check_blacklist:'🛡',
  approve_account:'✅', send_welcome:'📧', credit_score_check:'📊',
  income_verification:'💼', loan_approval:'🏦', disburse_funds:'💸', send_sanction_letter:'📝',
  collect_user_info:'📋', verify_email_domain:'🌐', admin_approval:'🔐',
  create_user_account:'👥', send_welcome_kit:'🎉',
}
export const WF_COLOR: Record<string,string> = {
  'ecommerce-checkout':'#818cf8',
  'kyc-verification':'#34d399',
  'loan-disbursement':'#fbbf24',
  'user-onboarding':'#38bdf8',
}
