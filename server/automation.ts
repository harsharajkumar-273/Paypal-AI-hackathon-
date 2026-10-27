import { z } from 'zod';
import { approved, latestRun, type Agreement, type Workspace } from './domain.js';

export const paymentRulesInput = z
  .object({
    enabled: z.boolean(),
    perPaymentLimit: z.number().int().min(100).max(1000000),
    monthlyLimit: z.number().int().min(100).max(10000000),
    confirmAutomaticCapture: z.boolean(),
  })
  .refine(
    (r) => r.monthlyLimit >= r.perPaymentLimit,
    'Monthly budget must cover at least one permitted payment.',
  )
  .refine(
    (r) => !r.enabled || r.confirmAutomaticCapture,
    'Explicit buyer consent is required to enable automatic capture.',
  );

export type PaymentRules = {
  enabled: boolean;
  perPaymentLimit: number;
  monthlyLimit: number;
  version: number;
  updatedAt?: string;
};
export type AutoDecision = {
  outcome: 'paused' | 'review' | 'blocked' | 'ready' | 'pending' | 'paid';
  reasons: string[];
  ruleVersion: number;
};
export const defaultRules: PaymentRules = {
  enabled: false,
  perPaymentLimit: 15000,
  monthlyLimit: 50000,
  version: 0,
};
export const utcMonth = (now = new Date()) => now.toISOString().slice(0, 7);
export const rulesFor = (w: Workspace): PaymentRules => w.paymentRules || defaultRules;
// All captured payments in the UTC calendar month count, including buyer-approved payments.
// Every uncertain capture reserves budget, even across month boundaries, until reconciled.
export function monthlyBudget(w: Workspace, now = new Date()) {
  const month = utcMonth(now);
  let spent = 0,
    reserved = 0;
  for (const a of w.agreements) {
    if (a.payment.status === 'capture_pending') reserved += a.amount;
    if (a.payment.status === 'captured') {
      const capturedAt =
        a.payment.capturedAt ||
        a.events.find((e) => e.title === 'Delivery accepted. Payment captured.')?.at ||
        a.createdAt;
      if (capturedAt.slice(0, 7) === month) spent += a.amount;
    }
  }
  return { month, spent, reserved, total: spent + reserved, limit: rulesFor(w).monthlyLimit };
}
export function evaluateAutomaticPayment(
  w: Workspace,
  a: Agreement,
  now = new Date(),
): AutoDecision {
  const rules = rulesFor(w);
  const result = (outcome: AutoDecision['outcome'], ...reasons: string[]): AutoDecision => ({
    outcome,
    reasons,
    ruleVersion: rules.version,
  });
  if (a.payment.status === 'captured')
    return result(
      'paid',
      a.payment.captureMethod === 'automatic'
        ? 'Paid automatically under the buyer’s standing rules.'
        : 'Payment was explicitly approved by the buyer.',
    );
  if (a.payment.status === 'capture_pending')
    return result(
      'pending',
      'Capture is awaiting confirmation. Its full amount remains reserved; reconcile before retrying.',
    );
  if (w.recoveryPause)
    return result(
      'paused',
      'A payment problem paused new automatic captures for this workspace. Resolve the cases, then the buyer can explicitly resume.',
    );
  if (!rules.enabled)
    return result(
      'paused',
      'Automatic payments are paused. The buyer can still approve a qualifying payment manually.',
    );
  if (a.payment.busy) return result('pending', 'A payment operation is already in progress.');
  if (['cancelled', 'superseded', 'completed'].includes(a.status))
    return result('blocked', 'This agreement is closed.');
  const blocked: string[] = [],
    review: string[] = [];
  if (!approved(a) || a.status !== 'active')
    review.push('Both parties must approve this agreement version.');
  if (a.amount > rules.perPaymentLimit)
    review.push('Amount exceeds the per-payment limit. Ask the buyer to approve it.');
  if (monthlyBudget(w, now).total + a.amount > rules.monthlyLimit)
    review.push('This payment would exceed the monthly budget, including pending captures.');
  if (a.scope && !a.scope.resolvedAt) review.push('A scope request needs the buyer’s decision.');
  if (
    a.payment.status === 'expired' ||
    (a.payment.expiresAt && Date.parse(a.payment.expiresAt) <= now.getTime())
  )
    blocked.push('Authorization expired. A new PayPal buyer authorization is required.');
  else if (a.payment.status !== 'authorized')
    review.push(
      'The buyer must authorize this payment first. Standing rules cannot create a new charge.',
    );
  if (
    a.payment.status === 'authorized' &&
    (a.payment.version !== a.version || !a.payment.authorizationId || !a.payment.expiresAt)
  )
    blocked.push('Authorization must belong to this version and have a valid expiration.');
  const run = latestRun(a);
  const required = a.criteria.filter((c) => c.required);
  if (!required.some((c) => c.type !== 'manual'))
    review.push('Automatic payment requires at least one required browser check.');
  if (!run || run.status === 'queued' || run.status === 'running')
    review.push('Wait for delivery verification to complete.');
  else if (run.status === 'error')
    blocked.push('Browser verification failed to complete. No payment will be sent.');
  else {
    for (const c of required) {
      if (c.type === 'manual') {
        if (!a.manualAccepted.includes(c.id)) review.push(`Buyer review required: ${c.title}.`);
      } else {
        const r = run.results.find((r) => r.criterionId === c.id);
        if (r?.status !== 'pass')
          blocked.push(
            `${r?.status === 'fail' ? 'Failed check' : 'Missing or inconclusive evidence'}: ${c.title}.`,
          );
      }
    }
  }
  if (blocked.length) return result('blocked', ...blocked, ...review);
  if (review.length) return result('review', ...review);
  return result(
    'ready',
    'Approved agreement, valid authorization, required checks, and buyer-set spending limits all match.',
  );
}
