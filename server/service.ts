import { randomUUID } from 'node:crypto';
import { mutate, getWorkspace } from './db.js';
import {
  AppError,
  ensure,
  approved,
  assertPaymentReady,
  isCaseOpen,
  event,
  type Agreement,
  type Workspace,
  type Role,
} from './domain.js';
import { evaluateAutomaticPayment, rulesFor, utcMonth } from './automation.js';
import { createOrder, authorizeOrder, capturePayment, voidPayment, paypal } from './paypal.js';
export function find(w: Workspace, id: string): Agreement {
  const a = w.agreements.find((a) => a.id === id);
  if (!a) throw new AppError(404, 'Agreement not found.');
  return a;
}
export function idle(a: Agreement) {
  ensure(
    !a.payment.busy || Date.now() - (a.payment.busyAt || 0) > 90000,
    'A payment operation is in progress. Retry shortly.',
  );
}
export function editable(a: Agreement) {
  idle(a);
  ensure(a.status === 'draft', 'Only a draft agreement can be edited.');
  ensure(
    ['none', 'voided', 'expired'].includes(a.payment.status),
    'Void the previous authorization before changing the agreement.',
  );
}
export async function approve(workspace: string, id: string, role: Role) {
  return mutate(workspace, (w) => {
    const a = find(w, id);
    ensure(a.status === 'draft' || a.status === 'active', 'This agreement is closed.');
    if (!a.approvals[role]) {
      a.approvals[role] = new Date().toISOString();
      event(a, `${role === 'buyer' ? 'Buyer' : 'Developer'} approved version ${a.version}`);
    }
    if (approved(a)) a.status = 'active';
  });
}
export async function paymentAction(
  workspace: string,
  id: string,
  action: string,
  validate: (a: Agreement, w: Workspace) => void,
  run: (a: Agreement, demo: boolean) => Promise<any>,
  complete: (a: Agreement, data: any) => void,
) {
  const reserved = await mutate(workspace, (w) => {
    const a = find(w, id);
    idle(a);
    validate(a, w);
    a.payment.busy = action;
    a.payment.busyAt = Date.now();
    a.payment.error = undefined;
    return { a: structuredClone(a), demo: w.demo };
  });
  try {
    const data = await run(reserved.a, reserved.demo);
    await mutate(workspace, (w) => {
      const a = find(w, id);
      ensure(
        a.version === reserved.a.version && a.payment.busy === action,
        'Payment state changed. Reconcile before retrying.',
      );
      complete(a, data);
      a.payment.busy = undefined;
      a.payment.busyAt = undefined;
    });
    return data;
  } catch (err) {
    await mutate(workspace, (w) => {
      const a = find(w, id);
      if (a.payment.busy === action) {
        a.payment.busy = undefined;
        a.payment.busyAt = undefined;
        a.payment.error = err instanceof Error ? err.message : 'Payment could not be confirmed.';
        event(a, 'Payment operation needs attention', a.payment.error);
      }
    });
    throw err;
  }
}
export async function createAuthorization(workspace: string, id: string) {
  return paymentAction(
    workspace,
    id,
    'create',
    (a) => {
      ensure(
        !a.cases?.some(isCaseOpen),
        'Resolve this payment’s support case before authorizing again.',
      );
      ensure(
        approved(a) && a.status === 'active',
        'Both parties must approve before authorization.',
      );
      ensure(
        ['none', 'voided', 'expired', 'created'].includes(a.payment.status),
        'This agreement already has a payment.',
      );
      if (a.payment.status !== 'created')
        a.payment = {
          mode: a.payment.mode,
          status: 'created',
          operation: randomUUID(),
          version: a.version,
        };
    },
    async (a, demo) => {
      if (demo) return { id: `DEMO-ORDER-${a.id.slice(0, 8)}`, links: [] };
      if (a.payment.orderId)
        return {
          id: a.payment.orderId,
          links: [{ rel: 'payer-action', href: a.payment.approvalUrl }],
        };
      return createOrder(a);
    },
    (a, data) => {
      a.payment.orderId = data.id;
      a.payment.approvalUrl = data.links?.find((l: any) =>
        ['approve', 'payer-action'].includes(l.rel),
      )?.href;
      a.payment.version = a.version;
      event(
        a,
        'Payment approval requested',
        a.payment.mode === 'demo'
          ? 'Simulated walkthrough. No money moves.'
          : 'Buyer approval opens in PayPal sandbox.',
      );
    },
  );
}
export async function confirmAuthorization(workspace: string, id: string) {
  const current = find(await getWorkspace(workspace), id);
  if (current.payment.status === 'authorized') return;
  return paymentAction(
    workspace,
    id,
    'authorize',
    (a) => {
      ensure(
        !a.cases?.some(isCaseOpen),
        'Resolve this payment’s support case before authorizing again.',
      );
      ensure(approved(a) && a.status === 'active', 'Agreement must be active.');
      ensure(
        a.payment.status === 'created' && a.payment.orderId,
        'Create and approve a PayPal order first.',
      );
    },
    async (a, demo) => {
      if (demo)
        return {
          id: `DEMO-AUTH-${a.id.slice(0, 8)}`,
          status: 'CREATED',
          expiration_time: new Date(Date.now() + 72 * 3600000).toISOString(),
        };
      const data = await authorizeOrder(
        a.payment.orderId!,
        `${a.id}-${a.payment.operation}-authorize`,
      );
      const unit = data.purchase_units?.[0];
      const auth = unit?.payments?.authorizations?.[0];
      ensure(
        auth && ['CREATED', 'PENDING'].includes(auth.status),
        'PayPal did not return a usable authorization.',
      );
      ensure(
        auth.amount?.currency_code === 'USD' && auth.amount?.value === (a.amount / 100).toFixed(2),
        'PayPal authorization amount does not match the agreement.',
      );
      ensure(
        auth.status === 'CREATED',
        'Authorization is pending at PayPal. Reconcile before continuing.',
      );
      return auth;
    },
    (a, data) => {
      a.payment.authorizationId = data.id;
      a.payment.status = 'authorized';
      a.payment.expiresAt =
        data.expiration_time || new Date(Date.now() + 72 * 3600000).toISOString();
      event(
        a,
        'Payment authorized',
        `$${(a.amount / 100).toFixed(2)} USD · ${a.payment.mode === 'demo' ? 'simulation' : 'PayPal sandbox'} · not yet captured`,
      );
    },
  );
}
export async function capture(
  workspace: string,
  id: string,
  method: 'manual' | 'automatic' = 'manual',
) {
  const current = find(await getWorkspace(workspace), id);
  if (current.payment.status === 'captured') return;
  return paymentAction(
    workspace,
    id,
    'capture',
    (a, w) => {
      assertPaymentReady(a);
      if (method === 'automatic') {
        const decision = evaluateAutomaticPayment(w, a);
        ensure(decision.outcome === 'ready', decision.reasons.join(' '));
      }
      if (a.payment.status !== 'capture_pending') {
        a.payment.captureMethod = method;
        a.payment.ruleVersion = method === 'automatic' ? rulesFor(w).version : undefined;
        a.payment.budgetMonth = utcMonth();
        event(
          a,
          method === 'automatic' ? 'Automatic payment requested' : 'Buyer approved payment',
          method === 'automatic'
            ? `Standing rules v${rulesFor(w).version} · $${(a.amount / 100).toFixed(2)} USD reserved`
            : 'Explicit approval for this delivery.',
        );
      }
      a.payment.status = 'capture_pending';
    },
    async (a, demo) =>
      demo
        ? { id: `DEMO-CAPTURE-${randomUUID().slice(0, 8)}`, status: 'COMPLETED' }
        : capturePayment(a),
    (a, data) => {
      if (data.status !== 'COMPLETED') {
        a.payment.status = 'capture_pending';
        event(a, 'Capture awaiting PayPal confirmation');
        return;
      }
      a.payment.status = 'captured';
      a.payment.captureId = data.id;
      a.payment.capturedAt = new Date().toISOString();
      a.status = 'completed';
      event(
        a,
        'Delivery accepted. Payment captured.',
        `${a.payment.mode === 'demo' ? 'Simulated receipt' : 'PayPal sandbox capture'} · ${data.id} · ${a.payment.captureMethod === 'automatic' ? 'Automatic under rules v' + a.payment.ruleVersion : 'Buyer approved'}`,
      );
    },
  );
}
export async function voidAuthorization(workspace: string, id: string, cancel = true) {
  return paymentAction(
    workspace,
    id,
    'void',
    (a) => {
      ensure(
        !['captured', 'capture_pending'].includes(a.payment.status),
        'Captured or uncertain payments cannot be cancelled. Reconcile first.',
      );
      ensure(a.status !== 'superseded' && a.status !== 'completed', 'Agreement is closed.');
    },
    async (a, demo) => {
      if (!demo && a.payment.authorizationId && a.payment.status === 'authorized')
        await voidPayment(a);
      return {};
    },
    (a) => {
      a.payment.status = 'voided';
      if (cancel) a.status = 'cancelled';
      for (const c of a.cases || [])
        if (isCaseOpen(c)) {
          c.status = 'cancelled';
          c.updatedAt = new Date().toISOString();
          c.messages.push({
            id: randomUUID(),
            at: c.updatedAt,
            role: 'buyer',
            body: 'The uncaptured authorization was voided. No captured payment was refunded.',
          });
        }
      event(
        a,
        cancel ? 'Agreement cancelled' : 'Authorization voided',
        'No captured payment was refunded.',
      );
    },
  );
}
export async function reconcile(workspace: string, id: string) {
  return paymentAction(
    workspace,
    id,
    'reconcile',
    (a) => {
      ensure(a.payment.orderId, 'No PayPal order to reconcile.');
      ensure(a.payment.mode === 'sandbox', 'Walkthrough payments do not have PayPal records.');
    },
    async (a) => paypal(`/v2/checkout/orders/${encodeURIComponent(a.payment.orderId!)}`),
    (a, data) => {
      const unit = data.purchase_units?.find((u: any) => u.reference_id === a.id);
      ensure(unit, 'PayPal order does not match this agreement.');
      const completed = unit.payments?.captures?.find((c: any) => c.status === 'COMPLETED');
      if (completed) {
        ensure(
          completed.amount?.currency_code === 'USD' &&
            completed.amount?.value === (a.amount / 100).toFixed(2),
          'Captured amount does not match.',
        );
        a.payment.captureId = completed.id;
        a.payment.capturedAt ||= completed.create_time || new Date().toISOString();
        a.payment.status = 'captured';
        a.status = 'completed';
      } else {
        const auth = unit.payments?.authorizations?.[0];
        if (auth) {
          ensure(
            auth.amount?.currency_code === 'USD' &&
              auth.amount?.value === (a.amount / 100).toFixed(2),
            'Authorization amount does not match.',
          );
          a.payment.authorizationId = auth.id;
          a.payment.expiresAt = auth.expiration_time;
          if (auth.status === 'CREATED' && a.payment.status !== 'capture_pending')
            a.payment.status =
              Date.parse(auth.expiration_time) < Date.now() ? 'expired' : 'authorized';
          if (auth.status === 'VOIDED') a.payment.status = 'voided';
          if (auth.status === 'EXPIRED') a.payment.status = 'expired';
        }
      }
      event(a, 'Payment reconciled with PayPal', a.payment.status);
    },
  );
}

// Re-evaluate on business events. This never creates a PayPal authorization or retries
// an uncertain capture. The final rule check and budget reservation occur atomically
// inside capture(), so concurrent workers cannot overspend the workspace budget.
export async function settleAutomaticPayments(workspace: string, onlyId?: string) {
  const snapshot = await getWorkspace(workspace);
  for (const original of snapshot.agreements.filter((a) => !onlyId || a.id === onlyId)) {
    if (!['active', 'draft'].includes(original.status)) continue;
    const initial = evaluateAutomaticPayment(snapshot, original);
    if (
      initial.outcome !== 'ready' &&
      JSON.stringify(original.automation) === JSON.stringify(initial)
    )
      continue;
    const decision = await mutate(workspace, (w) => {
      const a = find(w, original.id),
        next = evaluateAutomaticPayment(w, a);
      if (JSON.stringify(a.automation) !== JSON.stringify(next)) {
        a.automation = next;
        if (rulesFor(w).enabled)
          event(
            a,
            next.outcome === 'ready'
              ? 'Standing rules matched'
              : next.outcome === 'blocked'
                ? 'Auto-pay blocked'
                : 'Auto-pay needs review',
            next.reasons.join(' '),
          );
      }
      return next;
    });
    if (decision.outcome === 'ready') {
      try {
        await capture(workspace, original.id, 'automatic');
      } catch {
        /* paymentAction records provider errors; concurrent eligibility changes wait for the next event. */
      }
    }
  }
}
