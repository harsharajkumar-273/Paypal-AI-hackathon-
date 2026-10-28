import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace, type Agreement } from '../server/domain.js';
import { walkthroughState } from '../src/walkthroughState.js';
function agreement() {
  const a = seedWorkspace('guide-test').agreements[0];
  a.criteria = a.criteria.filter((c) => c.type !== 'manual');
  return a;
}
function authorized() {
  const a = agreement();
  a.approvals = { buyer: 'yes', developer: 'yes' };
  a.status = 'active';
  a.payment = { mode: 'demo', status: 'authorized', version: 1 };
  return a;
}
function run(a: Agreement, url: string, status: 'completed' | 'error' | 'queued', failure = false) {
  return {
    id: 'run-' + a.runs.length,
    url,
    version: a.version,
    status,
    createdAt: new Date().toISOString(),
    results:
      status === 'completed'
        ? a.criteria.map((c) => ({
            criterionId: c.id,
            status: c.id === 'booking' && failure ? ('fail' as const) : ('pass' as const),
            observed: 'Recorded test result',
            durationMs: 1,
          }))
        : [],
  };
}
test('walkthrough requires both approvals and explicit enabled rules before verification', () => {
  const a = agreement();
  assert.equal(walkthroughState(a, false).step, 0);
  a.approvals.buyer = 'yes';
  assert.equal(walkthroughState(a, false).step, 0);
  a.approvals.developer = 'yes';
  assert.equal(walkthroughState(a, false).step, 1);
  a.payment.status = 'authorized';
  assert.equal(walkthroughState(a, false).step, 1);
  assert.equal(walkthroughState(a, true).step, 2);
});
test('a recorded failure stays visible until the visitor continues to the correction', () => {
  const a = authorized();
  a.runs = [run(a, 'fixture:broken', 'completed', true)];
  assert.equal(walkthroughState(a, true).step, 2);
  assert.ok(walkthroughState(a, true).failedRun);
  assert.equal(walkthroughState(a, true, true).step, 3);
});
test('queued, errored and inconclusive work never produce a passing guided result', () => {
  const a = authorized();
  a.runs = [run(a, 'fixture:broken', 'error')];
  assert.equal(walkthroughState(a, true).failedRun, undefined);
  assert.equal(walkthroughState(a, true).step, 2);
  a.runs = [run(a, 'fixture:fixed', 'queued')];
  assert.equal(walkthroughState(a, true).passed, false);
  assert.equal(walkthroughState(a, true).running, true);
  a.runs = [run(a, 'fixture:fixed', 'completed')];
  a.runs[0].results[0].status = 'inconclusive';
  assert.equal(walkthroughState(a, true).passed, false);
});
test('all required passes still do not become a receipt until capture is confirmed', () => {
  const a = authorized();
  a.runs = [run(a, 'fixture:fixed', 'completed')];
  assert.equal(walkthroughState(a, true).passed, true);
  assert.equal(walkthroughState(a, true).step, 3);
  a.payment.status = 'capture_pending';
  assert.equal(walkthroughState(a, true).step, 3);
  a.payment.status = 'captured';
  assert.equal(walkthroughState(a, false).step, 4);
});
test('a newer failed correction does not reuse an older passing delivery', () => {
  const a = authorized();
  const passed = run(a, 'fixture:fixed', 'completed');
  a.runs = [run(a, 'fixture:fixed', 'error'), passed];
  assert.equal(walkthroughState(a, true).passed, false);
});
