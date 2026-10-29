import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const target = process.argv[2];
assert.ok(target, 'Usage: npm run smoke -- https://your-proofpay-host');
const origin = new URL(target).origin;
assert.ok(
  origin.startsWith('https://') || ['localhost', '127.0.0.1'].includes(new URL(origin).hostname),
  'Use HTTPS for a hosted build.',
);
let cookie = '';
async function request(path, body, method) {
  const res = await fetch(origin + '/api' + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  assert.ok(res.ok, `${path}: HTTP ${res.status}: ${data.error || 'request failed'}`);
  if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
  return data;
}
async function waitForRun(id) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const w = await request('/workspace');
    const a = w.agreements.find((a) => a.id === id);
    assert.ok(a, 'Smoke-test agreement disappeared.');
    const run = a.runs[0];
    if (run?.status === 'error') throw new Error(run.error || 'Worker failed.');
    if (run?.status === 'completed') return { w, a, run };
    await delay(1000);
  }
  throw new Error('Worker did not finish within 120 seconds. No pass is assumed.');
}
try {
  const started = Date.now();
  await request('/health');
  await request('/session', {});
  const initial = await request('/workspace');
  assert.equal(initial.demo, true, 'This command operates only on isolated demo workspaces.');
  const { id } = await request('/demo/walkthrough', {});
  const path = '/agreements/' + id;
  await request('/demo/role', { role: 'developer' });
  await request(path + '/approve', {});
  await request('/demo/role', { role: 'buyer' });
  await request(path + '/approve', {});
  await request(path + '/payments/order', {});
  await request(path + '/payments/authorize', {});
  await request(
    '/payment-rules',
    { enabled: true, perPaymentLimit: 7500, monthlyLimit: 15000, confirmAutomaticCapture: true },
    'PUT',
  );
  await request('/demo/role', { role: 'developer' });
  await request(path + '/verify', { url: 'fixture:broken' });
  const broken = await waitForRun(id);
  assert.equal(broken.a.payment.mode, 'demo');
  assert.equal(broken.a.payment.status, 'authorized');
  assert.equal(broken.run.results.filter((r) => r.status === 'pass').length, 4);
  assert.equal(broken.run.results.find((r) => r.criterionId === 'booking')?.status, 'fail');
  const screenshot = broken.run.results.find((r) => r.criterionId === 'booking').screenshot;
  assert.ok(screenshot?.startsWith('/api/evidence/'), 'Expected protected screenshot URL.');
  const proof = await fetch(origin + screenshot, { headers: { Cookie: cookie } });
  assert.equal(proof.status, 200);
  assert.match(proof.headers.get('content-type'), /^image\//);
  await proof.arrayBuffer();
  const anonymous = await fetch(origin + screenshot);
  assert.equal(anonymous.status, 401, 'Evidence must require authentication.');
  await anonymous.arrayBuffer();
  await request('/demo/walkthrough/continue', {});
  await request(path + '/verify', { url: 'fixture:fixed' });
  let fixed = await waitForRun(id);
  // Capture may settle just after the worker persists its browser findings.
  const captureDeadline = Date.now() + 15000;
  while (fixed.a.payment.status !== 'captured' && Date.now() < captureDeadline) {
    await delay(500);
    const w = await request('/workspace');
    fixed.a = w.agreements.find((a) => a.id === id);
  }
  assert.equal(fixed.run.results.filter((r) => r.status === 'pass').length, 5);
  assert.equal(fixed.a.payment.mode, 'demo');
  assert.equal(fixed.a.payment.status, 'captured');
  assert.equal(fixed.a.payment.captureMethod, 'automatic');
  assert.match(fixed.a.payment.captureId, /^DEMO-/);
  console.log(
    JSON.stringify(
      {
        ok: true,
        origin,
        mode: 'authored fixtures and simulated payments; no live AI or PayPal claim',
        elapsedMs: Date.now() - started,
        broken: { passes: 4, booking: 'fail', durationMs: broken.run.durationMs },
        corrected: { passes: 5, durationMs: fixed.run.durationMs },
        authenticatedEvidence: true,
        simulatedAutomaticCapture: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
