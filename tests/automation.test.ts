import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.TEST_DB = 'true';
const { initDb, closeDb, createWorkspace, getWorkspace, mutate } = await import('../server/db.js');
const { seedWorkspace } = await import('../server/domain.js');
const { evaluateAutomaticPayment, monthlyBudget, paymentRulesInput } =
  await import('../server/automation.js');
const { capture, settleAutomaticPayments, find } = await import('../server/service.js');
import type { Workspace, Agreement } from '../server/domain.js';
let serial = 0;
function prepared(): { w: Workspace; a: Agreement } {
  const w: Workspace = seedWorkspace('auto-' + ++serial);
  const a = w.agreements[0];
  w.paymentRules = { enabled: true, perPaymentLimit: 15000, monthlyLimit: 50000, version: 1 };
  a.status = 'active';
  a.approvals = { developer: 'approved', buyer: 'approved' };
  a.payment = {
    mode: 'demo',
    status: 'authorized',
    version: 1,
    authorizationId: 'AUTH',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  a.criteria = a.criteria.filter((c) => c.type !== 'manual');
  a.runs = [
    {
      id: 'run',
      version: 1,
      url: 'fixture:fixed',
      status: 'completed',
      createdAt: new Date().toISOString(),
      results: a.criteria.map((c) => ({
        criterionId: c.id,
        status: 'pass',
        observed: 'Browser evidence',
        durationMs: 1,
      })),
    },
  ];
  return { w, a };
}
before(initDb);
after(closeDb);
test('standing rules require explicit consent and enforce integer limits', () => {
  assert.equal(
    paymentRulesInput.safeParse({
      enabled: true,
      perPaymentLimit: 15000,
      monthlyLimit: 50000,
      confirmAutomaticCapture: false,
    }).success,
    false,
  );
  assert.equal(
    paymentRulesInput.safeParse({
      enabled: true,
      perPaymentLimit: 15000,
      monthlyLimit: 10000,
      confirmAutomaticCapture: true,
    }).success,
    false,
  );
  assert.equal(
    paymentRulesInput.safeParse({
      enabled: false,
      perPaymentLimit: 15000.5,
      monthlyLimit: 50000,
      confirmAutomaticCapture: false,
    }).success,
    false,
  );
});
test('required browser evidence and authorization allow automatic capture without another approval click', async () => {
  const { w, a } = prepared();
  await createWorkspace(w);
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'ready');
  await settleAutomaticPayments(w.id);
  const paid = find(await getWorkspace(w.id), a.id);
  assert.equal(paid.payment.status, 'captured');
  assert.equal(paid.payment.captureMethod, 'automatic');
  assert.equal(paid.payment.ruleVersion, 1);
  assert.ok(paid.payment.capturedAt);
  assert.ok(paid.events.some((e) => e.title === 'Automatic payment requested'));
  const first = paid.payment.captureId;
  await settleAutomaticPayments(w.id);
  assert.equal(find(await getWorkspace(w.id), a.id).payment.captureId, first);
});
test('failed and inconclusive required checks block automatic capture', () => {
  const { w, a } = prepared();
  for (const status of ['fail', 'inconclusive'] as const) {
    a.runs[0].results[0].status = status;
    assert.equal(evaluateAutomaticPayment(w, a).outcome, 'blocked');
  }
});
test('subjective checks still need buyer review; an AI scope verdict cannot clear new scope', () => {
  const { w, a } = prepared();
  a.criteria.push({
    id: 'visual',
    title: 'Visual review',
    type: 'manual',
    selector: '',
    expected: 'Approved design',
    required: true,
  });
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'review');
  a.manualAccepted = ['visual'];
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'ready');
  a.scope = {
    id: 'scope',
    request: 'Add something new',
    verdict: 'included',
    explanation: 'AI says included',
    source: 'openai',
  };
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'review');
  a.scope.resolvedAt = new Date().toISOString();
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'ready');
});
test('old approvals, missing authorization, expiry, and absent objective checks cannot auto-pay', () => {
  const { w, a } = prepared();
  a.payment.version = 0;
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'blocked');
  a.payment.version = 1;
  a.approvals.buyer = undefined;
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'review');
  a.approvals.buyer = 'yes';
  a.payment.expiresAt = new Date(0).toISOString();
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'blocked');
  a.payment.expiresAt = new Date(Date.now() + 100000).toISOString();
  a.payment.status = 'none';
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'review');
  a.payment.status = 'authorized';
  a.criteria.forEach((c) => (c.required = false));
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'review');
});
test('oversized payments ask the buyer; pausing never dispatches a capture', async () => {
  const { w, a } = prepared();
  a.amount = 16000;
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'review');
  a.amount = 15000;
  w.paymentRules!.enabled = false;
  await createWorkspace(w);
  await settleAutomaticPayments(w.id);
  assert.equal(find(await getWorkspace(w.id), a.id).payment.status, 'authorized');
});
test('atomic budget reservation prevents two concurrent deliveries overspending', async () => {
  const { w, a } = prepared();
  w.paymentRules!.monthlyLimit = 15000;
  const other = structuredClone(a);
  other.id = 'second-delivery';
  w.agreements.push(other);
  await createWorkspace(w);
  const outcomes = await Promise.allSettled([
    capture(w.id, a.id, 'automatic'),
    capture(w.id, other.id, 'automatic'),
  ]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  const final = await getWorkspace(w.id);
  assert.equal(final.agreements.filter((a) => a.payment.status === 'captured').length, 1);
  assert.equal(monthlyBudget(final).total, 15000);
});
test('uncertain captures reserve budget across UTC month boundaries and never auto-retry', async () => {
  const { w, a } = prepared();
  a.payment.status = 'capture_pending';
  a.payment.budgetMonth = '2020-01';
  w.paymentRules!.monthlyLimit = 15000;
  const other = structuredClone(a);
  other.id = 'fresh';
  other.payment.status = 'authorized';
  w.agreements.push(other);
  assert.equal(monthlyBudget(w).reserved, 15000);
  assert.equal(evaluateAutomaticPayment(w, other).outcome, 'review');
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'pending');
  await createWorkspace(w);
  await settleAutomaticPayments(w.id);
  assert.equal(find(await getWorkspace(w.id), a.id).payment.status, 'capture_pending');
});
test('monthly budget includes manual payments and rolls over by captured timestamp', () => {
  const { w, a } = prepared();
  a.payment.status = 'captured';
  a.payment.captureMethod = 'manual';
  a.payment.capturedAt = '2026-10-31T23:59:59.000Z';
  assert.equal(monthlyBudget(w, new Date('2026-10-31T23:59:59Z')).spent, 15000);
  assert.equal(monthlyBudget(w, new Date('2026-11-01T00:00:00Z')).spent, 0);
});
test('revocation between evaluation and capture is enforced again at reservation time', async () => {
  const { w, a } = prepared();
  await createWorkspace(w);
  assert.equal(evaluateAutomaticPayment(w, a).outcome, 'ready');
  await mutate(w.id, (w) => {
    w.paymentRules!.enabled = false;
    w.paymentRules!.version++;
  });
  await assert.rejects(() => capture(w.id, a.id, 'automatic'), /paused/);
  assert.equal(find(await getWorkspace(w.id), a.id).payment.status, 'authorized');
});
