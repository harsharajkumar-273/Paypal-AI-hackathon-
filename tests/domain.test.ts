import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seedWorkspace,
  eligible,
  assertPaymentReady,
  agreementInput,
  criterionSchema,
} from '../server/domain.js';
import { privateAddress, safeUrl } from '../server/verifier.js';
function payable() {
  const a = seedWorkspace('test').agreements[0];
  a.approvals = { developer: 'today', buyer: 'today' };
  a.status = 'active';
  a.payment = {
    mode: 'demo',
    status: 'authorized',
    version: 1,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  a.manualAccepted = ['design'];
  a.runs = [
    {
      id: 'run',
      version: 1,
      url: 'fixture:fixed',
      status: 'completed',
      createdAt: new Date().toISOString(),
      results: a.criteria.map((c) => ({
        criterionId: c.id,
        status: c.type === 'manual' ? 'manual' : 'pass',
        observed: 'evidence',
        durationMs: 1,
      })),
    },
  ];
  return a;
}
test('capture needs matching approved version, all required passes, and manual acceptance', () => {
  const a = payable();
  assert.equal(eligible(a), true);
  assert.doesNotThrow(() => assertPaymentReady(a));
  a.manualAccepted = [];
  assert.equal(eligible(a), false);
  a.manualAccepted = ['design'];
  a.runs[0].results[0].status = 'inconclusive';
  assert.throws(() => assertPaymentReady(a), /checks/);
});
test('older results cannot pay a replacement agreement', () => {
  const a = payable();
  a.version++;
  assert.equal(eligible(a), false);
  a.runs[0].version = 2;
  assert.throws(() => assertPaymentReady(a), /older agreement/);
});
test('failed, queued and errored browser runs never enable capture', () => {
  const a = payable();
  a.runs[0].results[0].status = 'fail';
  assert.equal(eligible(a), false);
  a.runs[0].results[0].status = 'pass';
  for (const status of ['queued', 'running', 'error'] as const) {
    a.runs[0].status = status;
    assert.equal(eligible(a), false);
  }
});
test('a new failed delivery supersedes previous successful evidence', () => {
  const a = payable();
  a.runs.unshift({ ...structuredClone(a.runs[0]), id: 'new-run', status: 'queued' });
  assert.equal(eligible(a), false);
});
test('expired authorization and incomplete party approvals block capture', () => {
  const a = payable();
  a.payment.expiresAt = new Date(0).toISOString();
  assert.throws(() => assertPaymentReady(a), /expired/);
  a.approvals.buyer = undefined;
  assert.equal(eligible(a), false);
});
test('duplicate check IDs and fractional cents cannot enter agreements', () => {
  const a = payable();
  assert.equal(
    agreementInput.safeParse({
      ...a,
      deliveryUrl: 'https://example.com',
      criteria: [a.criteria[0], a.criteria[0]],
    }).success,
    false,
  );
  assert.equal(
    agreementInput.safeParse({ ...a, deliveryUrl: 'https://example.com', amount: 15000.1 }).success,
    false,
  );
});
test('private, mapped IPv6 and reserved network ranges are blocked', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
  ])
    assert.equal(privateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(privateAddress(ip), false, ip);
});
test('unapproved origins, credentials and HTTP are rejected before lookup', async () => {
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://evil.example'])
    await assert.rejects(() => safeUrl(url, ['https://example.com']));
});
