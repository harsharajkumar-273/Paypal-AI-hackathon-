import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.TEST_DB = 'true';
process.env.PAYPAL_CLIENT_ID = 'test';
process.env.PAYPAL_CLIENT_SECRET = 'test';
const { initDb, closeDb, createWorkspace, getWorkspace, mutate } = await import('../server/db.js');
const { seedWorkspace } = await import('../server/domain.js');
const { find, capture, voidAuthorization } = await import('../server/service.js');
const {
  reportProblem,
  issueRefund,
  retryRefund,
  reconcileRefund,
  refundTotals,
  reviewCase,
  resumeAfterRecovery,
  buyerCaseDecision,
} = await import('../server/recovery.js');
const { evaluateAutomaticPayment, monthlyBudget } = await import('../server/automation.js');
const originalFetch = globalThis.fetch;
let serial = 0;
before(initDb);
after(async () => {
  globalThis.fetch = originalFetch;
  await closeDb();
});
async function setup(demo = true, authorized = false) {
  const w = seedWorkspace('recovery-' + ++serial, demo),
    a = w.agreements[0];
  a.approvals = { buyer: 'agreed', developer: 'agreed' };
  a.manualAccepted = ['design'];
  a.status = authorized ? 'active' : 'completed';
  a.payment = {
    mode: demo ? 'demo' : 'sandbox',
    status: authorized ? 'authorized' : 'captured',
    captureId: authorized ? undefined : 'CAPTURE',
    orderId: 'ORDER',
    authorizationId: 'AUTH',
    version: 1,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    capturedAt: new Date().toISOString(),
  };
  a.runs = [
    {
      id: 'evidence',
      version: 1,
      url: 'fixture:fixed',
      status: 'completed',
      createdAt: new Date().toISOString(),
      results: a.criteria.map((c) => ({
        criterionId: c.id,
        status: c.type === 'manual' ? 'manual' : 'pass',
        observed: 'Saved browser observation',
        screenshot: 'image-data',
        durationMs: 1,
      })),
    },
  ];
  w.paymentRules = { enabled: true, version: 1, perPaymentLimit: 15000, monthlyLimit: 50000 };
  await createWorkspace(w);
  const caseId = await reportProblem(w.id, a.id, {
    reason: 'delivery',
    description: 'The delivered booking flow does not match the agreed behavior.',
    requestedAmount: a.amount,
  });
  return { w, a, caseId };
}
const current = async (w: string, id: string) => find(await getWorkspace(w), id);
const json = (value: any, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const input = (amount: number) => ({
  requestId: randomUUID(),
  amount,
  note: 'Refund approved after reviewing the actual issue.',
});
test('case opening freezes evidence and pauses all new automatic captures until explicit resumption', async () => {
  const { w, a, caseId } = await setup();
  let saved = await getWorkspace(w.id);
  assert.ok(saved.recoveryPause);
  const c = find(saved, a.id).cases![0];
  assert.equal(c.snapshot.captureId, 'CAPTURE');
  assert.equal(c.snapshot.paymentRules.version, 1);
  assert.ok(!('screenshot' in c.snapshot.delivery!.results[0]));
  await mutate(w.id, (w) => {
    const original = find(w, a.id);
    original.brief = 'Changed later';
    original.runs[0].results[0].observed = 'Changed later';
    const other = structuredClone(original);
    other.id = 'other';
    other.status = 'active';
    other.cases = [];
    other.payment = {
      mode: 'demo',
      status: 'authorized',
      version: 1,
      authorizationId: 'OTHER',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    w.agreements.push(other);
  });
  saved = await getWorkspace(w.id);
  assert.notEqual(find(saved, a.id).cases![0].snapshot.brief, 'Changed later');
  assert.equal(
    find(saved, a.id).cases![0].snapshot.delivery!.results[0].observed,
    'Saved browser observation',
  );
  assert.equal(evaluateAutomaticPayment(saved, find(saved, 'other')).outcome, 'paused');
  await assert.rejects(() => capture(w.id, 'other', 'automatic'), /paused/);
  await assert.rejects(() => resumeAfterRecovery(w.id), /Resolve all open/);
  await issueRefund(w.id, a.id, caseId, input(15000));
  assert.ok((await getWorkspace(w.id)).recoveryPause);
  await resumeAfterRecovery(w.id);
  assert.equal((await getWorkspace(w.id)).recoveryPause, undefined);
});
test('partial then full refunds retain original receipt, cap the balance, and do not refill monthly budget', async () => {
  const { w, a, caseId } = await setup();
  const first = input(5000);
  await issueRefund(w.id, a.id, caseId, first);
  await issueRefund(w.id, a.id, caseId, first);
  let value = await current(w.id, a.id);
  assert.equal(value.payment.captureId, 'CAPTURE');
  assert.equal(value.payment.refunds!.length, 1);
  assert.equal(value.cases![0].status, 'partially_refunded');
  assert.deepEqual(refundTotals(value), { completed: 5000, pending: 0, available: 10000 });
  await assert.rejects(
    () => issueRefund(w.id, a.id, caseId, input(10001)),
    /remaining captured balance/,
  );
  await issueRefund(w.id, a.id, caseId, input(10000));
  value = await current(w.id, a.id);
  assert.equal(value.cases![0].status, 'refunded');
  assert.equal(refundTotals(value).completed, 15000);
  assert.equal(monthlyBudget(await getWorkspace(w.id)).spent, 15000);
  await assert.rejects(() => issueRefund(w.id, a.id, caseId, input(1)), /closed/);
});
test('concurrent refund requests cannot exceed a capture', async () => {
  const { w, a, caseId } = await setup();
  const results = await Promise.allSettled([
    issueRefund(w.id, a.id, caseId, input(10000)),
    issueRefund(w.id, a.id, caseId, input(10000)),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(refundTotals(await current(w.id, a.id)).completed, 10000);
});
test('an uncaptured complaint blocks capture and cancellation voids the hold without claiming a refund', async () => {
  const { w, a } = await setup(true, true);
  await assert.rejects(() => capture(w.id, a.id), /support case/);
  await voidAuthorization(w.id, a.id);
  const value = await current(w.id, a.id);
  assert.equal(value.payment.status, 'voided');
  assert.equal(value.cases![0].status, 'cancelled');
  assert.equal(refundTotals(value).completed, 0);
  assert.ok((await getWorkspace(w.id)).recoveryPause);
});
test('network uncertainty retains the refund reservation; retry uses the same key and amount', async () => {
  const { w, a, caseId } = await setup(false);
  const request = input(5000),
    calls: { key: string; body: any }[] = [];
  let first = true;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/token')) return json({ access_token: 'test' });
    if (String(url).endsWith('/refund')) {
      calls.push({
        key: (init!.headers as any)['PayPal-Request-Id'],
        body: JSON.parse(init!.body as string),
      });
      if (first) {
        first = false;
        throw new Error('Lost response after dispatch');
      }
      return json({
        id: 'REFUND-1',
        status: 'PENDING',
        amount: { value: '50.00', currency_code: 'USD' },
      });
    }
    return json({
      id: 'REFUND-1',
      status: 'COMPLETED',
      amount: { value: '50.00', currency_code: 'USD' },
    });
  };
  await assert.rejects(() => issueRefund(w.id, a.id, caseId, request), /Lost response/);
  let value = await current(w.id, a.id);
  assert.equal(refundTotals(value).pending, 5000);
  assert.equal(value.cases![0].status, 'refund_pending');
  await assert.rejects(() => issueRefund(w.id, a.id, caseId, input(1)), /Another refund/);
  await retryRefund(w.id, a.id, caseId, request.requestId);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal((await current(w.id, a.id)).payment.refunds![0].status, 'pending');
  await reconcileRefund(w.id, a.id, caseId, request.requestId);
  value = await current(w.id, a.id);
  assert.equal(refundTotals(value).completed, 5000);
  assert.equal(value.cases![0].status, 'partially_refunded');
  globalThis.fetch = async (url) =>
    String(url).endsWith('/token')
      ? json({ access_token: 'test' })
      : json({
          id: 'REFUND-1',
          status: 'PENDING',
          amount: { value: '50.00', currency_code: 'USD' },
        });
  await reconcileRefund(w.id, a.id, caseId, request.requestId);
  assert.equal((await current(w.id, a.id)).payment.refunds![0].status, 'completed');
});
test('provider amount mismatch never becomes a confirmed refund', async () => {
  const { w, a, caseId } = await setup(false);
  globalThis.fetch = async (url) =>
    String(url).endsWith('/token')
      ? json({ access_token: 'test' })
      : json({
          id: 'REFUND-MISMATCH',
          status: 'COMPLETED',
          amount: { value: '1.00', currency_code: 'USD' },
        });
  await assert.rejects(() => issueRefund(w.id, a.id, caseId, input(5000)), /does not match/);
  const value = await current(w.id, a.id);
  assert.equal(refundTotals(value).completed, 0);
  assert.equal(refundTotals(value).pending, 5000);
  assert.equal(value.cases![0].status, 'refund_pending');
});
test('a definitive provider rejection releases its reservation, while an in-progress rejection stays pending', async () => {
  const x = await setup(false);
  globalThis.fetch = async (url) =>
    String(url).endsWith('/token')
      ? json({ access_token: 'test' })
      : json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'REFUND_AMOUNT_EXCEEDED' }] }, 422);
  await assert.rejects(() => issueRefund(x.w.id, x.a.id, x.caseId, input(5000)));
  assert.equal(refundTotals(await current(x.w.id, x.a.id)).pending, 0);
  assert.equal((await current(x.w.id, x.a.id)).payment.refunds![0].status, 'failed');
  const y = await setup(false);
  globalThis.fetch = async (url) =>
    String(url).endsWith('/token')
      ? json({ access_token: 'test' })
      : json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'REFUND_IN_PROGRESS' }] }, 422);
  await assert.rejects(() => issueRefund(y.w.id, y.a.id, y.caseId, input(5000)));
  assert.equal(refundTotals(await current(y.w.id, y.a.id)).pending, 5000);
});
test('seller decisions need review, retain the pause, and can be reopened by the buyer', async () => {
  const { w, a, caseId } = await setup();
  await reviewCase(
    w.id,
    a.id,
    caseId,
    'decline',
    'The seller explains the evidence and why the requested remedy was declined.',
  );
  assert.equal((await current(w.id, a.id)).cases![0].status, 'declined');
  assert.ok((await getWorkspace(w.id)).recoveryPause);
  await buyerCaseDecision(
    w.id,
    a.id,
    caseId,
    'reopen',
    'The payment concern is not resolved and I request another review.',
  );
  assert.equal((await current(w.id, a.id)).cases![0].status, 'under_review');
  await assert.rejects(() => resumeAfterRecovery(w.id), /Resolve all open/);
});
test('the buyer may explicitly accept a confirmed partial settlement', async () => {
  const { w, a, caseId } = await setup();
  await issueRefund(w.id, a.id, caseId, input(2500));
  await buyerCaseDecision(
    w.id,
    a.id,
    caseId,
    'accept',
    'I accept this confirmed partial refund as resolution of my complaint.',
  );
  assert.equal((await current(w.id, a.id)).cases![0].status, 'resolved');
  await resumeAfterRecovery(w.id);
  assert.equal((await getWorkspace(w.id)).recoveryPause, undefined);
});
test('refund request IDs cannot be reused for another amount or note', async () => {
  const { w, a, caseId } = await setup();
  const request = input(5000);
  await issueRefund(w.id, a.id, caseId, request);
  await assert.rejects(
    () => issueRefund(w.id, a.id, caseId, { ...request, amount: 6000 }),
    /different details/,
  );
  assert.equal(refundTotals(await current(w.id, a.id)).completed, 5000);
});
