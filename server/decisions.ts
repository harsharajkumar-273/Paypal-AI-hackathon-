import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertPaymentReady, ensure, latestRun, type Agreement, type Workspace } from './domain.js';
import {
  evaluateAutomaticPayment,
  monthlyBudget,
  rulesFor,
  type AutoDecision,
  type PaymentRules,
} from './automation.js';

export type DecisionRecord = {
  schemaVersion: 1;
  engineVersion: 'proofpay-policy-v1';
  at: string;
  method: 'manual' | 'automatic';
  agreement: Agreement;
  rules: PaymentRules;
  budget: ReturnType<typeof monthlyBudget>;
  recoveryPause?: Workspace['recoveryPause'];
  automatic: AutoDecision;
  manual: { outcome: 'ready' | 'blocked'; reasons: string[] };
};
export const simulationInput = z
  .object({
    perPaymentLimit: z.number().int().min(0).max(1000000).optional(),
    failedCriterion: z.string().min(1).max(80).optional(),
    unapprovedTerms: z.boolean().default(false),
    buyerComplaint: z.boolean().default(false),
  })
  .strict();

export function checksum(value: unknown): string {
  const canonical = (v: any): string => {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object')
      return (
        '{' +
        Object.keys(v)
          .filter((k) => v[k] !== undefined)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
          .join(',') +
        '}'
      );
    return JSON.stringify(v);
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function manual(a: Agreement, now: Date): DecisionRecord['manual'] {
  try {
    assertPaymentReady(a, now);
    return {
      outcome: 'ready',
      reasons: [
        'Required checks, manual acceptance, agreement version, and authorization permit explicit buyer capture.',
      ],
    };
  } catch (error) {
    return {
      outcome: 'blocked',
      reasons: [error instanceof Error ? error.message : 'Payment requires review.'],
    };
  }
}
export function decisionRecord(
  w: Workspace,
  a: Agreement,
  method: DecisionRecord['method'],
  now = new Date(),
): DecisionRecord {
  const agreement = structuredClone(a);
  delete agreement.payment.decisionRecord;
  delete agreement.payment.approvalUrl;
  delete agreement.payment.operation;
  for (const run of agreement.runs)
    for (const r of run.results)
      if (r.screenshot)
        r.screenshot = `/api/evidence/${a.id}/${run.id}/${encodeURIComponent(r.criterionId)}`;
  for (const agent of agreement.agentRuns || [])
    for (const attempt of agent.attempts)
      for (const r of attempt.results)
        if (r.screenshot)
          r.screenshot = `/api/agent-evidence/${a.id}/${agent.id}/${attempt.artifactId}/${encodeURIComponent(r.criterionId)}`;
  return {
    schemaVersion: 1,
    engineVersion: 'proofpay-policy-v1',
    at: now.toISOString(),
    method,
    agreement,
    rules: structuredClone(rulesFor(w)),
    budget: monthlyBudget(w, now),
    recoveryPause: structuredClone(w.recoveryPause),
    automatic: evaluateAutomaticPayment(w, a, now),
    manual: manual(a, now),
  };
}
// Reconstitute only aggregate competing budget usage, never another agreement's private details.
function context(record: DecisionRecord): { w: Workspace; a: Agreement } {
  const a = structuredClone(record.agreement);
  const agreements = [a];
  for (const [status, amount] of [
    ['captured', record.budget.spent],
    ['capture_pending', record.budget.reserved],
  ] as const) {
    if (amount)
      agreements.push({
        ...structuredClone(a),
        id: 'budget-' + status,
        amount,
        events: [],
        createdAt: record.at,
        payment: { mode: a.payment.mode, status, capturedAt: record.at },
      });
  }
  return {
    a,
    w: {
      id: 'isolated-decision-simulation',
      demo: a.payment.mode === 'demo',
      agreements,
      paymentRules: structuredClone(record.rules),
      recoveryPause: structuredClone(record.recoveryPause),
    },
  };
}
export function simulateDecision(w: Workspace, a: Agreement, raw: unknown) {
  const input = simulationInput.parse(raw);
  const historical = a.payment.decisionRecord;
  ensure(
    historical || !['captured', 'capture_pending'].includes(a.payment.status),
    'This older payment has no recorded decision inputs. Start a fresh demo to simulate a recorded capture.',
  );
  const record = historical || decisionRecord(w, a, 'automatic');
  const ctx = context(record);
  if (input.perPaymentLimit !== undefined)
    ctx.w.paymentRules!.perPaymentLimit = input.perPaymentLimit;
  if (input.failedCriterion) {
    const c = ctx.a.criteria.find(
      (c) => c.id === input.failedCriterion && c.required && c.type !== 'manual',
    );
    ensure(c, 'Choose an existing required browser check.', 400);
    const run = latestRun(ctx.a);
    ensure(
      run?.status === 'completed',
      'A completed verification run is required for this scenario.',
      400,
    );
    run.results = run.results.filter((r) => r.criterionId !== c.id);
    run.results.push({
      criterionId: c.id,
      status: 'fail',
      observed: 'Hypothetical failed check; recorded evidence is unchanged.',
      durationMs: 0,
    });
  }
  if (input.unapprovedTerms) {
    const { title, client, brief, amount, deliveryUrl, dueAt, criteria, terms = [] } = ctx.a;
    const before = { title, client, brief, amount, deliveryUrl, dueAt, criteria, terms };
    ctx.a.changes ||= [];
    ctx.a.changes.push({
      id: 'simulation-only',
      baseVersion: ctx.a.version,
      digest: checksum(before),
      proposalDigest: checksum(before),
      before,
      after: structuredClone(before),
      reason: 'Hypothetical unapproved agreement change.',
      effectiveAt: record.at,
      createdAt: record.at,
      proposerApprovedAt: record.at,
      status: 'pending',
      diffs: [],
      messages: [],
    });
  }
  if (input.buyerComplaint) ctx.w.recoveryPause = { since: record.at, caseId: 'simulation-only' };
  const now = new Date(record.at);
  return {
    simulation: true,
    source: historical ? 'recorded-capture-inputs' : 'current-inputs',
    at: record.at,
    original: record.automatic,
    result: evaluateAutomaticPayment(ctx.w, ctx.a, now),
    note: 'Automatic-payment policy simulation only. No agreement, evidence, consent, or payment was changed.',
  };
}
export function replay(w: Workspace, a: Agreement) {
  const record = a.payment.decisionRecord;
  const terminal = ['captured', 'capture_pending'].includes(a.payment.status);
  return {
    source: record
      ? 'recorded-capture-inputs'
      : terminal
        ? 'historical-inputs-unavailable'
        : 'current-inputs',
    record: record || (terminal ? null : decisionRecord(w, a, 'automatic')),
    payment: {
      ...a.payment,
      decisionRecord: undefined,
      approvalUrl: undefined,
      operation: undefined,
    },
    events: [...a.events].sort((x, y) => x.at.localeCompare(y.at)),
    agentSteps: (a.agentRuns || []).flatMap((run) =>
      run.steps.map((step) => ({ ...step, runId: run.id })),
    ),
  };
}
