import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mutate, getWorkspace } from './db.js';
import {
  ensure,
  event,
  isCaseOpen,
  latestRun,
  type Agreement,
  type Workspace,
  type RecoveryCase,
  type RefundRecord,
  type Role,
} from './domain.js';
import { find, paymentAction } from './service.js';
import { paypal, PayPalError } from './paypal.js';
import { rulesFor } from './automation.js';

export const reportInput = z.object({
  reason: z.enum(['unrecognized', 'wrong_amount', 'duplicate', 'delivery', 'other']),
  description: z.string().trim().min(20).max(3000),
  requestedAmount: z.number().int().min(1).max(1000000),
});
export const refundInput = z.object({
  requestId: z.uuid(),
  amount: z.number().int().min(1).max(1000000),
  note: z.string().trim().min(10).max(255),
});
export function refundTotals(a: Agreement) {
  const refunds = a.payment.refunds || [];
  const completed = refunds
    .filter((r) => r.status === 'completed')
    .reduce((n, r) => n + r.amount, 0);
  const pending = refunds.filter((r) => r.status === 'pending').reduce((n, r) => n + r.amount, 0);
  return { completed, pending, available: Math.max(0, a.amount - completed - pending) };
}
export function findCase(a: Agreement, id: string): RecoveryCase {
  const c = a.cases?.find((c) => c.id === id);
  ensure(c, 'Support case not found.', 404);
  return c;
}
function message(c: RecoveryCase, role: Role, body: string) {
  ensure(c.messages.length < 100, 'Case message limit reached.');
  c.messages.push({ id: randomUUID(), at: new Date().toISOString(), role, body });
  c.updatedAt = new Date().toISOString();
}
function pause(w: Workspace, caseId: string) {
  w.recoveryPause ||= { since: new Date().toISOString(), caseId };
}
export async function reportProblem(
  workspaceId: string,
  id: string,
  input: z.infer<typeof reportInput>,
) {
  return mutate(workspaceId, (w) => {
    const a = find(w, id);
    ensure(
      ['created', 'authorized', 'capture_pending', 'captured'].includes(a.payment.status),
      'There is no payment or authorization to report.',
    );
    ensure(
      !(a.cases || []).some(isCaseOpen),
      'There is already an open case for this payment. Add a message to it instead.',
    );
    ensure((a.cases?.length || 0) < 10, 'Case limit reached.');
    ensure(
      input.requestedAmount <= a.amount - refundTotals(a).completed,
      'Requested amount exceeds the remaining payment balance.',
      400,
    );
    const at = new Date().toISOString(),
      run = latestRun(a),
      caseId = randomUUID();
    const c: RecoveryCase = {
      id: caseId,
      reason: input.reason,
      description: input.description,
      requestedAmount: input.requestedAmount,
      status: 'requested',
      createdAt: at,
      updatedAt: at,
      messages: [{ id: randomUUID(), at, role: 'buyer', body: input.description }],
      snapshot: {
        version: a.version,
        title: a.title,
        brief: a.brief,
        amount: a.amount,
        paymentMode: a.payment.mode,
        paymentStatus: a.payment.status,
        captureId: a.payment.captureId,
        orderId: a.payment.orderId,
        authorizationId: a.payment.authorizationId,
        approvals: structuredClone(a.approvals),
        criteria: structuredClone(a.criteria),
        paymentRules: structuredClone(rulesFor(w)),
        delivery: run
          ? {
              id: run.id,
              url: run.url,
              createdAt: run.createdAt,
              artifactId: run.artifactId,
              artifactSha256: run.artifactSha256,
              results: run.results.map(({ screenshot, ...result }) => result),
            }
          : undefined,
      },
    };
    a.cases ||= [];
    a.cases.unshift(c);
    pause(w, caseId);
    event(
      a,
      'Buyer reported a payment problem',
      `Case ${caseId.slice(0, 8)} · ${input.reason} · new automatic captures paused for this workspace. Already dispatched payments cannot be recalled.`,
    );
    return caseId;
  });
}
export async function addCaseMessage(
  workspaceId: string,
  id: string,
  caseId: string,
  role: Role,
  body: string,
) {
  return mutate(workspaceId, (w) => {
    const a = find(w, id),
      c = findCase(a, caseId);
    message(c, role, body);
    event(
      a,
      `${role === 'buyer' ? 'Buyer' : 'Seller'} added a case message`,
      `Case ${c.id.slice(0, 8)}`,
    );
  });
}
export async function reviewCase(
  workspaceId: string,
  id: string,
  caseId: string,
  decision: 'review' | 'decline',
  body: string,
) {
  return mutate(workspaceId, (w) => {
    const a = find(w, id),
      c = findCase(a, caseId);
    ensure(isCaseOpen(c), 'This case is closed.');
    ensure(
      !a.payment.refunds?.some((r) => r.status === 'pending'),
      'Reconcile the pending refund before changing the case decision.',
    );
    ensure(
      a.payment.status !== 'capture_pending',
      'Confirm the original payment before deciding the case.',
    );
    c.status = decision === 'review' ? 'under_review' : 'declined';
    message(c, 'developer', body);
    event(
      a,
      decision === 'review' ? 'Seller began case review' : 'Seller explained refund decision',
      `Case ${c.id.slice(0, 8)} · ${body}`,
    );
  });
}
export async function buyerCaseDecision(
  workspaceId: string,
  id: string,
  caseId: string,
  decision: 'accept' | 'reopen',
  body: string,
) {
  return mutate(workspaceId, (w) => {
    const a = find(w, id),
      c = findCase(a, caseId);
    ensure(
      !a.payment.refunds?.some((r) => r.status === 'pending'),
      'Wait for the pending refund to be confirmed.',
    );
    if (decision === 'accept') {
      ensure(
        isCaseOpen(c) && refundTotals(a).completed > 0,
        'There is no confirmed refund settlement to accept.',
      );
      c.status = 'resolved';
    } else {
      ensure(
        ['declined', 'resolved'].includes(c.status),
        'This case is not eligible for another review.',
      );
      ensure(refundTotals(a).completed < a.amount, 'The full payment was already refunded.');
      c.status = 'under_review';
      pause(w, c.id);
    }
    message(c, 'buyer', body);
    event(
      a,
      decision === 'accept'
        ? 'Buyer accepted the case resolution'
        : 'Buyer requested another review',
      `Case ${c.id.slice(0, 8)} · ${body}`,
    );
  });
}
function updateCaseAfterRefund(a: Agreement, c: RecoveryCase) {
  const refunds = (a.payment.refunds || []).filter((r) => r.caseId === c.id),
    completed = refunds.filter((r) => r.status === 'completed').reduce((n, r) => n + r.amount, 0);
  c.status = refunds.some((r) => r.status === 'pending')
    ? 'refund_pending'
    : completed >= c.requestedAmount || refundTotals(a).completed >= a.amount
      ? 'refunded'
      : completed > 0
        ? 'partially_refunded'
        : 'under_review';
  c.updatedAt = new Date().toISOString();
}
function applyRefund(a: Agreement, operationId: string, data: any) {
  const r = a.payment.refunds!.find((r) => r.id === operationId)!;
  ensure(
    typeof data.id === 'string' &&
      data.amount?.currency_code === 'USD' &&
      data.amount?.value === (r.amount / 100).toFixed(2),
    'PayPal refund response does not match the requested amount. Reconcile before retrying.',
    502,
  );
  ensure(
    !r.providerId || r.providerId === data.id,
    'PayPal returned a different refund ID. Reconcile before retrying.',
    502,
  );
  ensure(
    ['COMPLETED', 'PENDING', 'FAILED', 'CANCELLED'].includes(data.status),
    'PayPal refund status is not confirmed. Reconcile before retrying.',
    502,
  );
  if (r.status === 'completed') return;
  r.providerId = data.id;
  r.error = undefined;
  r.status =
    data.status === 'COMPLETED' ? 'completed' : data.status === 'PENDING' ? 'pending' : 'failed';
  if (r.status === 'completed') r.completedAt ||= new Date().toISOString();
  if (r.status === 'failed')
    r.error = `PayPal reports ${data.status.toLowerCase()}. No completed refund is recorded.`;
  const c = findCase(a, r.caseId);
  updateCaseAfterRefund(a, c);
  event(
    a,
    r.status === 'completed'
      ? 'Refund confirmed'
      : r.status === 'pending'
        ? 'Refund awaiting confirmation'
        : 'Refund did not complete',
    `${a.payment.mode === 'demo' ? 'Simulation' : 'PayPal sandbox'} · $${(r.amount / 100).toFixed(2)} · ${r.providerId} · case ${c.id.slice(0, 8)}`,
  );
}
export async function issueRefund(
  workspaceId: string,
  id: string,
  caseId: string,
  input: z.infer<typeof refundInput>,
) {
  const existing = find(await getWorkspace(workspaceId), id).payment.refunds?.find(
    (r) => r.id === input.requestId,
  );
  if (existing) {
    ensure(
      existing.caseId === caseId &&
        existing.amount === input.amount &&
        existing.note === input.note,
      'This refund request ID was already used with different details.',
    );
    if (existing.status !== 'pending') return;
  }
  try {
    return await paymentAction(
      workspaceId,
      id,
      'refund',
      (a) => {
        const c = findCase(a, caseId);
        ensure(
          a.payment.status === 'captured' && a.payment.captureId,
          'Confirm the captured payment before issuing a refund.',
        );
        a.payment.refunds ||= [];
        const previous = a.payment.refunds.find((r) => r.id === input.requestId);
        if (previous) {
          ensure(
            previous.caseId === caseId &&
              previous.amount === input.amount &&
              previous.note === input.note &&
              previous.status === 'pending',
            'Refund request state changed. Refresh the case.',
          );
          return;
        }
        ensure(isCaseOpen(c), 'This case is closed.');
        ensure(
          !a.payment.refunds.some((r) => r.status === 'pending'),
          'Another refund is pending. Reconcile it before starting a new one.',
        );
        ensure(
          input.amount <= refundTotals(a).available,
          'Refund exceeds the remaining captured balance.',
          400,
        );
        const r: RefundRecord = {
          id: input.requestId,
          caseId,
          amount: input.amount,
          note: input.note,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        a.payment.refunds.push(r);
        c.status = 'refund_pending';
        c.updatedAt = r.createdAt;
        message(c, 'developer', `Refund requested: $${(r.amount / 100).toFixed(2)} USD. ${r.note}`);
        event(
          a,
          'Seller requested a refund',
          `Case ${c.id.slice(0, 8)} · request ${r.id} · pending confirmation`,
        );
      },
      async (a, demo) => {
        const r = a.payment.refunds!.find((r) => r.id === input.requestId)!;
        if (demo)
          return {
            id: `DEMO-REFUND-${r.id.slice(0, 8)}`,
            status: 'COMPLETED',
            amount: { currency_code: 'USD', value: (r.amount / 100).toFixed(2) },
          };
        return paypal(
          `/v2/payments/captures/${encodeURIComponent(a.payment.captureId!)}/refund`,
          'POST',
          {
            amount: { currency_code: 'USD', value: (r.amount / 100).toFixed(2) },
            note_to_payer: r.note,
          },
          `refund-${r.id}`,
        );
      },
      (a, data) => applyRefund(a, input.requestId, data),
    );
  } catch (error) {
    await mutate(workspaceId, (w) => {
      const a = find(w, id),
        r = a.payment.refunds?.find((r) => r.id === input.requestId);
      if (!r || r.status !== 'pending') return;
      // An unconfirmed network/server result retains the reservation and the same request ID.
      r.error = error instanceof Error ? error.message : 'Refund could not be confirmed.';
      if (error instanceof PayPalError && error.definitive) {
        r.status = 'failed';
        updateCaseAfterRefund(a, findCase(a, r.caseId));
      }
    });
    throw error;
  }
}
export async function retryRefund(
  workspaceId: string,
  id: string,
  caseId: string,
  refundId: string,
) {
  const a = find(await getWorkspace(workspaceId), id),
    r = a.payment.refunds?.find((r) => r.id === refundId && r.caseId === caseId);
  ensure(r, 'Refund not found.', 404);
  return issueRefund(workspaceId, id, caseId, { requestId: r.id, amount: r.amount, note: r.note });
}
export async function reconcileRefund(
  workspaceId: string,
  id: string,
  caseId: string,
  refundId: string,
) {
  return paymentAction(
    workspaceId,
    id,
    'refund-status',
    (a) => {
      const r = a.payment.refunds?.find((r) => r.id === refundId && r.caseId === caseId);
      ensure(
        r?.providerId,
        'Refund ID is not yet known. Retry the same request safely to recover it.',
      );
      ensure(a.payment.mode === 'sandbox', 'Walkthrough refunds do not have PayPal records.');
    },
    async (a) => {
      const r = a.payment.refunds!.find((r) => r.id === refundId)!;
      return paypal(`/v2/payments/refunds/${encodeURIComponent(r.providerId!)}`);
    },
    (a, data) => applyRefund(a, refundId, data),
  );
}
export async function resumeAfterRecovery(workspaceId: string) {
  return mutate(workspaceId, (w) => {
    ensure(w.recoveryPause, 'There is no recovery pause to clear.');
    ensure(
      !w.agreements.some(
        (a) => a.cases?.some(isCaseOpen) || a.payment.refunds?.some((r) => r.status === 'pending'),
      ),
      'Resolve all open cases and pending refunds before resuming automatic payments.',
    );
    w.recoveryPause = undefined;
    if (w.paymentRules)
      w.paymentRules = {
        ...w.paymentRules,
        version: w.paymentRules.version + 1,
        updatedAt: new Date().toISOString(),
      };
    for (const a of w.agreements)
      event(
        a,
        'Buyer cleared the recovery pause',
        'Standing rules resume only if enabled. Qualifying existing authorizations may now be captured.',
      );
  });
}
