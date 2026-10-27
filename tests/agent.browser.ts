import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
process.env.TEST_DB = 'true';
const { initDb, closeDb, createWorkspace, getWorkspace } = await import('../server/db.js');
const { seedWorkspace } = await import('../server/domain.js');
const { createApp } = await import('../server/app.js');
const { runRepairAgent, artifactHeaders } = await import('../server/agent.js');
const { brokenBookingHandler, cafeHtml } = await import('../server/fixtures.js');
let server: Server, origin: string;
before(async () => {
  await initDb();
  server = await new Promise<Server>((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});
function job(id: string) {
  const w = seedWorkspace(id),
    a = w.agreements[0],
    runId = randomUUID();
  a.agentTask = true;
  a.criteria = a.criteria.filter((c) => c.type !== 'manual');
  a.status = 'active';
  a.approvals = { buyer: 'yes', developer: 'yes' };
  a.payment = {
    mode: 'demo',
    status: 'authorized',
    authorizationId: 'DEMO-AUTH',
    version: 1,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  a.runs = [
    {
      id: runId,
      status: 'queued',
      version: 1,
      url: 'fixture:broken',
      createdAt: new Date().toISOString(),
      results: [],
    },
  ];
  a.agentRuns = [
    {
      id: runId,
      status: 'queued',
      version: 1,
      createdAt: new Date().toISOString(),
      steps: [],
      attempts: [],
    },
  ];
  w.paymentRules = { enabled: true, version: 1, perPaymentLimit: 15000, monthlyLimit: 50000 };
  return { w, a, runId };
}
test('agent artifact executes with an opaque origin and restricted network policy', () => {
  const csp = artifactHeaders('https://example.com')['Content-Security-Policy'];
  assert.match(csp, /sandbox allow-scripts allow-forms;/);
  assert.ok(!csp.includes('allow-same-origin'));
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src https:\/\/example.com;/);
});
test(
  'model-adapter repair is tested independently, revises a failed patch, and auto-pays only the proven artifact',
  { timeout: 120000 },
  async () => {
    const { w, a, runId } = job('agent-real-browser');
    await createWorkspace(w);
    let calls = 0;
    const goodHandler = `const booking = document.querySelector('#booking');
const response = await fetch('/fixtures/reserve', {method:'POST',credentials:'omit',body:new URLSearchParams({name:booking.elements.namedItem('name').value,email:booking.elements.namedItem('email').value})});
const reservation = await response.json();
document.querySelector('#feedback').textContent = response.ok && reservation.ok ? reservation.message : 'Unable to reserve.';`;
    await runRepairAgent(w.id, a.id, runId, {
      fixtureOrigin: origin,
      repair: async (input) => {
        calls++;
        assert.equal(input.attempt, calls);
        assert.ok(input.results.some((r) => r.criterionId === 'booking' && r.status === 'fail'));
        const current = (await getWorkspace(w.id)).agreements[0];
        assert.equal(current.payment.status, 'authorized');
        if (calls === 1) {
          assert.equal(input.handler, brokenBookingHandler);
          return {
            handler: "document.querySelector('#feedback').textContent='Your table is reserved.';",
            explanation:
              'Test adapter deliberately proposes a false success message without a network response.',
          };
        }
        return {
          handler: goodHandler,
          explanation:
            'Test adapter repairs the handler by posting the actual form data and displaying the successful test endpoint response.',
        };
      },
    });
    const final = (await getWorkspace(w.id)).agreements[0],
      agent = final.agentRuns![0],
      run = final.runs[0];
    assert.equal(calls, 2);
    assert.equal(agent.model, 'test-adapter');
    assert.equal(agent.status, 'completed');
    assert.equal(
      agent.attempts[0].results.find((r) => r.criterionId === 'booking')?.status,
      'fail',
    );
    assert.equal(agent.attempts[1].results.filter((r) => r.status === 'pass').length, 5);
    assert.equal(
      run.artifactSha256,
      createHash('sha256').update(cafeHtml(false, goodHandler)).digest('hex'),
    );
    assert.match(run.url, /^fixture:agent:/);
    assert.equal(run.artifactId, agent.artifactId);
    assert.equal(final.payment.captureMethod, 'automatic');
    assert.equal(final.payment.status, 'captured');
    assert.ok(agent.steps.some((s) => s.tool === 'submit_delivery'));
    const response = await fetch(origin + '/fixtures/agent/' + run.artifactId);
    assert.match(
      response.headers.get('content-security-policy')!,
      /sandbox allow-scripts allow-forms/,
    );
    assert.ok((await response.text()).includes(goodHandler));
  },
);
test(
  'an unsuccessful agent cannot submit a passing delivery or get paid',
  { timeout: 10000 },
  async () => {
    const { w, a, runId } = job('agent-failed');
    await createWorkspace(w);
    await assert.rejects(
      () =>
        runRepairAgent(w.id, a.id, runId, {
          fixtureOrigin: origin,
          repair: async () => ({
            handler: brokenBookingHandler,
            explanation: 'Test adapter leaves the defect unchanged.',
          }),
          check: async (_url, criteria) =>
            criteria.map((c) => ({
              criterionId: c.id,
              status: c.id === 'booking' ? 'fail' : 'pass',
              observed: 'Controlled failing verifier fixture',
              durationMs: 1,
            })),
        }),
      /Neither model-written patch/,
    );
    const final = (await getWorkspace(w.id)).agreements[0];
    assert.equal(final.payment.status, 'authorized');
    assert.equal(final.runs[0].status, 'error');
    assert.equal(final.agentRuns![0].status, 'error');
    assert.equal(final.agentRuns![0].attempts.length, 2);
    assert.equal(final.agentRuns![0].artifactId, undefined);
  },
);
