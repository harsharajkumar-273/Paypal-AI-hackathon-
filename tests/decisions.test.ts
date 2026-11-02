import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../server/domain.js';
import { checksum, decisionRecord, replay, simulateDecision } from '../server/decisions.js';

function prepared() {
  const now = new Date('2030-05-12T12:00:00Z');
  const w = seedWorkspace('replay-test'),
    a = w.agreements[0];
  w.paymentRules = { enabled: true, version: 7, perPaymentLimit: 15000, monthlyLimit: 50000 };
  a.status = 'active';
  a.amount = 7500;
  a.approvals = { buyer: now.toISOString(), developer: now.toISOString() };
  a.criteria = a.criteria.filter((c) => c.type !== 'manual');
  a.payment = {
    mode: 'demo',
    status: 'authorized',
    authorizationId: 'DEMO-AUTH',
    version: a.version,
    expiresAt: '2030-05-13T12:00:00Z',
  };
  a.runs = [
    {
      id: 'run',
      version: a.version,
      url: 'fixture:fixed',
      status: 'completed',
      createdAt: now.toISOString(),
      results: a.criteria.map((c) => ({
        criterionId: c.id,
        status: 'pass',
        observed: 'Recorded finding',
        durationMs: 1,
        screenshot: 'dGVzdA==',
      })),
    },
  ];
  return { w, a, now };
}
test('capture-time replay preserves original inputs, clock, and method after rules change', () => {
  const { w, a, now } = prepared();
  a.payment.decisionRecord = decisionRecord(w, a, 'automatic', now);
  a.payment.status = 'captured';
  a.status = 'completed';
  w.paymentRules!.enabled = false;
  w.paymentRules!.perPaymentLimit = 100;
  w.recoveryPause = { since: new Date().toISOString(), caseId: 'later-case' };
  const result = simulateDecision(w, a, {});
  assert.equal(result.result.outcome, 'ready');
  assert.deepEqual(result.result, a.payment.decisionRecord.automatic);
  assert.equal(result.at, now.toISOString());
  assert.equal(replay(w, a).source, 'recorded-capture-inputs');
  assert.equal(a.payment.decisionRecord.rules.version, 7);
  assert.equal(a.payment.decisionRecord.agreement.payment.decisionRecord, undefined);
  assert.match(
    a.payment.decisionRecord.agreement.runs[0].results[0].screenshot!,
    /^\/api\/evidence\//,
  );
});
test('all four scenarios reuse eligibility rules without mutating any stored input', () => {
  const { w, a, now } = prepared();
  a.payment.decisionRecord = decisionRecord(w, a, 'automatic', now);
  a.payment.status = 'captured';
  a.status = 'completed';
  const before = JSON.stringify(w);
  const cases = [
    [{ perPaymentLimit: 7400 }, 'review', /per-payment/],
    [{ failedCriterion: 'booking' }, 'blocked', /Failed check/],
    [{ unapprovedTerms: true }, 'review', /Changed agreement/],
    [{ buyerComplaint: true }, 'paused', /payment problem/],
  ] as const;
  for (const [input, outcome, reason] of cases) {
    const simulation = simulateDecision(w, a, input);
    assert.equal(simulation.result.outcome, outcome);
    assert.match(simulation.result.reasons.join(' '), reason);
    assert.equal(JSON.stringify(w), before);
  }
  assert.equal(simulateDecision(w, a, { perPaymentLimit: 7500 }).result.outcome, 'ready');
});
test('replay retains aggregate budget reservations without exporting other agreement details', () => {
  const { w, a, now } = prepared();
  w.paymentRules!.monthlyLimit = 10000;
  w.agreements.push({
    ...structuredClone(a),
    id: 'private-job',
    title: 'Private other project',
    amount: 3000,
    payment: { mode: 'demo', status: 'capture_pending' },
  });
  a.payment.decisionRecord = decisionRecord(w, a, 'automatic', now);
  assert.equal(a.payment.decisionRecord.budget.reserved, 3000);
  a.payment.status = 'captured';
  a.status = 'completed';
  const simulation = simulateDecision(w, a, {});
  assert.equal(simulation.result.outcome, 'review');
  assert.match(simulation.result.reasons.join(' '), /monthly budget/);
  assert.ok(!JSON.stringify(a.payment.decisionRecord).includes('Private other project'));
});
test('manual capture can be eligible while automatic policy remains paused', () => {
  const { w, a, now } = prepared();
  w.paymentRules!.enabled = false;
  const record = decisionRecord(w, a, 'manual', now);
  assert.equal(record.manual.outcome, 'ready');
  assert.equal(record.automatic.outcome, 'paused');
  assert.equal(record.method, 'manual');
  a.effectiveAt = '2030-05-12T13:00:00Z';
  assert.equal(decisionRecord(w, a, 'manual', now).manual.outcome, 'blocked');
});
test('legacy receipts do not fabricate historical inputs and simulation accepts only bounded overrides', () => {
  const { w, a } = prepared();
  a.payment.status = 'captured';
  assert.equal(replay(w, a).source, 'historical-inputs-unavailable');
  assert.equal(replay(w, a).record, null);
  assert.throws(() => simulateDecision(w, a, {}), /no recorded decision inputs/);
  a.payment.status = 'authorized';
  assert.throws(() => simulateDecision(w, a, { amount: 1 }));
  assert.throws(() => simulateDecision(w, a, { failedCriterion: 'unknown' }), /existing required/);
  assert.throws(() => simulateDecision(w, a, { perPaymentLimit: -1 }));
  a.runs[0].status = 'running';
  assert.throws(
    () => simulateDecision(w, a, { failedCriterion: 'booking' }),
    /completed verification/,
  );
});
test('proof checksum survives JSON serialization and object-key reordering but detects changed findings', () => {
  const x = { b: [{ status: 'pass', id: 'booking' }], a: 1, missing: undefined };
  assert.equal(checksum(x), checksum(JSON.parse(JSON.stringify(x))));
  assert.equal(checksum(x), checksum({ a: 1, b: [{ id: 'booking', status: 'pass' }] }));
  assert.notEqual(checksum(x), checksum({ a: 1, b: [{ id: 'booking', status: 'fail' }] }));
});
