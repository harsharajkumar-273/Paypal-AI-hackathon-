import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
process.env.TEST_DB = 'true';
process.env.RUN_WORKER = 'false';
process.env.APP_URL = 'http://localhost:5173';
const { initDb, closeDb, mutate, query } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { find } = await import('../server/service.js');
let server: Server, base: string;
before(async () => {
  await initDb();
  server = await new Promise<Server>((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});
async function request(path: string, body?: any, cookie?: string, method?: string) {
  const res = await fetch(base + '/api' + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, data: await res.json() };
}
async function visitor() {
  const { res } = await request('/session', {});
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const { data: w } = await request('/workspace', undefined, cookie);
  return { cookie, w, id: w.agreements[0].id };
}
test('unauthenticated requests cannot read agreements', async () => {
  assert.equal((await request('/workspace')).res.status, 401);
});
test('visitors are isolated and cannot operate on each other’s agreements', async () => {
  const x = await visitor(),
    y = await visitor();
  assert.notEqual(x.w.id, y.w.id);
  assert.equal((await request(`/agreements/${y.id}/approve`, {}, x.cookie)).res.status, 404);
  assert.equal(
    (await request(`/agreements/${y.id}/verify`, { url: 'fixture:fixed' }, x.cookie)).res.status,
    404,
  );
});
test('buyer permissions, approval reset, verification prerequisites, capture guards', async () => {
  const { cookie, w, id } = await visitor(),
    p = `/agreements/${id}`;
  assert.equal((await request(p + '/payments/order', {}, cookie)).res.status, 403);
  assert.equal((await request(p + '/verify', { url: 'fixture:fixed' }, cookie)).res.status, 409);
  await request(p + '/approve', {}, cookie);
  let result = await request(p, { criteria: w.agreements[0].criteria }, cookie, 'PATCH');
  assert.equal(result.res.status, 200);
  let a = (await request('/workspace', undefined, cookie)).data.agreements[0];
  assert.equal(a.version, 2);
  assert.deepEqual(a.approvals, {});
  await request(p + '/approve', {}, cookie);
  await request('/demo/role', { role: 'buyer' }, cookie);
  await request(p + '/approve', {}, cookie);
  assert.equal((await request(p + '/payments/order', {}, cookie)).res.status, 200);
  assert.equal((await request(p + '/payments/authorize', {}, cookie)).res.status, 200);
  assert.equal((await request(p + '/payments/capture', {}, cookie)).res.status, 409);
  assert.equal((await request(p + '/verify', { url: 'fixture:fixed' }, cookie)).res.status, 403);
  await mutate(w.id, (workspace) => {
    const a = find(workspace, id);
    a.runs = [
      {
        id: 'verified',
        version: a.version,
        status: 'completed',
        url: 'fixture:fixed',
        createdAt: new Date().toISOString(),
        results: a.criteria.map((c) => ({
          criterionId: c.id,
          status: c.type === 'manual' ? 'manual' : 'pass',
          observed: 'Test evidence',
          durationMs: 1,
        })),
      },
    ];
  });
  assert.equal((await request(p + '/payments/capture', {}, cookie)).res.status, 409);
  await request(p + '/manual', { criterionId: 'design', accepted: true }, cookie);
  assert.equal((await request(p + '/payments/capture', {}, cookie)).res.status, 200);
  const first = (await request('/workspace', undefined, cookie)).data.agreements[0];
  assert.equal((await request(p + '/payments/capture', {}, cookie)).res.status, 200);
  const second = (await request('/workspace', undefined, cookie)).data.agreements[0];
  assert.equal(first.payment.captureId, second.payment.captureId);
  assert.equal(second.status, 'completed');
  assert.equal((await request(p + '/payments/cancel', {}, cookie)).res.status, 409);
  assert.equal(
    (await request(p + '/manual', { criterionId: 'design', accepted: false }, cookie)).res.status,
    409,
  );
});
test('scope replacement needs a void and starts without approvals or payment', async () => {
  const { cookie, w, id } = await visitor(),
    p = `/agreements/${id}`;
  await mutate(w.id, (workspace) => {
    const a = find(workspace, id);
    a.scope = {
      request: 'Add loyalty rewards',
      verdict: 'additional',
      explanation: 'Test advisory result',
      source: 'test',
    };
  });
  assert.equal(
    (
      await request(
        p + '/replacement',
        { amount: 20000, criteria: w.agreements[0].criteria },
        cookie,
      )
    ).res.status,
    409,
  );
  await request('/demo/role', { role: 'buyer' }, cookie);
  await request(p + '/payments/void', {}, cookie);
  await request('/demo/role', { role: 'developer' }, cookie);
  const created = await request(
    p + '/replacement',
    { amount: 20000, criteria: w.agreements[0].criteria },
    cookie,
  );
  assert.equal(created.res.status, 201);
  const next = (await request('/workspace', undefined, cookie)).data.agreements.find(
    (a: any) => a.id === created.data.id,
  );
  assert.deepEqual(next.approvals, {});
  assert.equal(next.payment.status, 'none');
  assert.equal(next.version, 2);
  assert.deepEqual(next.runs, []);
});
test('cross-site mutation and unsigned webhooks are rejected', async () => {
  const r = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: '{}',
  });
  assert.equal(r.status, 403);
  const webhook = await request('/paypal/webhook', { id: 'forged' });
  assert.ok(webhook.res.status >= 400);
  const { rows } = await query("SELECT * FROM webhook_events WHERE id='forged'");
  assert.equal(rows.length, 0);
});

test('real invitations assign fixed roles and reject walkthrough role switching', async () => {
  process.env.DEVELOPER_INVITE = 'developer-invitation-test-0000000000000000';
  process.env.BUYER_INVITE = 'buyer-invitation-test-00000000000000000000';
  const opened = await request('/session', { invite: process.env.BUYER_INVITE });
  assert.equal(opened.res.status, 200);
  const cookie = opened.res.headers.get('set-cookie')!.split(';')[0];
  const { data: w } = await request('/workspace', undefined, cookie);
  assert.equal(w.demo, false);
  assert.equal(w.role, 'buyer');
  assert.equal((await request('/demo/role', { role: 'developer' }, cookie)).res.status, 403);
  assert.equal(
    (await request('/ai/criteria', { brief: 'A sufficiently long test website brief.' }, cookie))
      .res.status,
    403,
  );
});

test('verified duplicate webhooks reconcile once; failed signatures never enter the inbox', async () => {
  const { seedWorkspace } = await import('../server/domain.js');
  const { createWorkspace } = await import('../server/db.js');
  const w = seedWorkspace('webhook-test', false),
    a = w.agreements[0];
  a.payment = {
    mode: 'sandbox',
    status: 'capture_pending',
    orderId: 'WEBHOOK-ORDER',
    authorizationId: 'AUTH',
    version: 1,
  };
  await createWorkspace(w);
  process.env.PAYPAL_CLIENT_ID = 'test';
  process.env.PAYPAL_CLIENT_SECRET = 'test';
  process.env.PAYPAL_WEBHOOK_ID = 'WH-CONFIG';
  const original = globalThis.fetch;
  let orderReads = 0,
    valid = true;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api-m.sandbox.paypal.com')) return original(input, init);
    const response = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/token')) return response({ access_token: 'test' });
    if (url.endsWith('verify-webhook-signature'))
      return response({ verification_status: valid ? 'SUCCESS' : 'FAILURE' });
    orderReads++;
    return response({
      purchase_units: [
        {
          reference_id: a.id,
          payments: {
            captures: [
              {
                id: 'CAPTURE-WH',
                status: 'COMPLETED',
                amount: { currency_code: 'USD', value: '150.00' },
              },
            ],
          },
        },
      ],
    });
  };
  try {
    const payload = {
      id: 'WH-TEST-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { supplementary_data: { related_ids: { order_id: 'WEBHOOK-ORDER' } } },
    };
    assert.equal((await request('/paypal/webhook', payload)).res.status, 200);
    assert.equal((await request('/paypal/webhook', payload)).res.status, 200);
    assert.equal(orderReads, 1);
    const stored = await query('SELECT processed FROM webhook_events WHERE id=$1', [payload.id]);
    assert.equal(stored.rows[0].processed, true);
    valid = false;
    assert.equal((await request('/paypal/webhook', { ...payload, id: 'WH-BAD' })).res.status, 400);
    assert.equal(
      (await query('SELECT id FROM webhook_events WHERE id=$1', ['WH-BAD'])).rows.length,
      0,
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_WEBHOOK_ID;
  }
});

test('only buyers can consent to standing rules and new scope requires the current buyer decision', async () => {
  const { cookie, w, id } = await visitor(),
    p = `/agreements/${id}`;
  const rules = {
    enabled: true,
    perPaymentLimit: 15000,
    monthlyLimit: 50000,
    confirmAutomaticCapture: true,
  };
  assert.equal((await request('/payment-rules', rules, cookie, 'PUT')).res.status, 403);
  const routine = await request('/demo/routine-project', {}, cookie);
  assert.equal(routine.res.status, 201);
  assert.ok(
    (await request('/workspace', undefined, cookie)).data.agreements
      .find((a: any) => a.id === routine.data.id)
      .criteria.every((c: any) => c.type !== 'manual'),
  );
  await request('/demo/role', { role: 'buyer' }, cookie);
  assert.equal(
    (await request('/payment-rules', { ...rules, confirmAutomaticCapture: false }, cookie, 'PUT'))
      .res.status,
    400,
  );
  assert.equal((await request('/payment-rules', rules, cookie, 'PUT')).res.status, 200);
  await mutate(w.id, (w) => {
    const a = find(w, id);
    a.status = 'active';
    a.approvals = { developer: 'yes', buyer: 'yes' };
  });
  await request(p + '/scope', { request: 'Add a loyalty rewards program' }, cookie);
  let a = (await request('/workspace', undefined, cookie)).data.agreements.find(
    (a: any) => a.id === id,
  );
  assert.equal(a.scope.resolvedAt, undefined);
  assert.equal(
    (await request(p + '/scope/resolve', { scopeId: 'older-request' }, cookie)).res.status,
    409,
  );
  await request('/demo/role', { role: 'developer' }, cookie);
  assert.equal(
    (await request(p + '/scope/resolve', { scopeId: a.scope.id }, cookie)).res.status,
    403,
  );
  await request('/demo/role', { role: 'buyer' }, cookie);
  assert.equal(
    (await request(p + '/scope/resolve', { scopeId: a.scope.id }, cookie)).res.status,
    200,
  );
  a = (await request('/workspace', undefined, cookie)).data.agreements.find(
    (a: any) => a.id === id,
  );
  assert.ok(a.scope.resolvedAt);
  assert.equal(
    (
      await request(
        '/payment-rules',
        { ...rules, enabled: false, confirmAutomaticCapture: false },
        cookie,
        'PUT',
      )
    ).res.status,
    200,
  );
  assert.equal((await request('/workspace', undefined, cookie)).data.paymentRules.enabled, false);
});

test('agent task commissioning is buyer-only and a missing model key never fabricates a run', async () => {
  const { cookie, w } = await visitor();
  assert.equal((await request('/agent-tasks', { amount: 7500 }, cookie)).res.status, 403);
  await request('/demo/role', { role: 'buyer' }, cookie);
  const result = await request('/agent-tasks', { amount: 7500 }, cookie);
  assert.equal(result.res.status, 201);
  const p = `/agreements/${result.data.id}`;
  let task = (await request('/workspace', undefined, cookie)).data.agreements.find(
    (a: any) => a.id === result.data.id,
  );
  assert.equal(task.agentTask, true);
  assert.equal(task.criteria.length, 5);
  assert.equal(task.payment.status, 'none');
  assert.equal((await request(p + '/agent/start', {}, cookie)).res.status, 503);
  task = (await request('/workspace', undefined, cookie)).data.agreements.find(
    (a: any) => a.id === result.data.id,
  );
  assert.equal(task.agentRuns.length, 0);
  const outsider = await visitor();
  assert.equal(
    (await request(`/agent-evidence/${result.data.id}/x/y/z`, undefined, outsider.cookie)).res
      .status,
    404,
  );
  await request('/demo/role', { role: 'developer' }, cookie);
  assert.equal((await request(p + '/verify', { url: 'fixture:fixed' }, cookie)).res.status, 400);
});

test('support cases enforce buyer/seller permissions and isolate another visitor’s refund controls', async () => {
  const { cookie, w, id } = await visitor(),
    p = `/agreements/${id}`;
  await mutate(w.id, (w) => {
    const a = find(w, id);
    a.status = 'completed';
    a.payment = {
      mode: 'demo',
      status: 'captured',
      captureId: 'DEMO-CAPTURE',
      orderId: 'DEMO-ORDER',
      version: 1,
      capturedAt: new Date().toISOString(),
    };
  });
  const report = {
    reason: 'wrong_amount',
    description: 'The amount in this receipt does not match what I expected to pay.',
    requestedAmount: 15000,
  };
  assert.equal((await request(p + '/cases', report, cookie)).res.status, 403);
  await request('/demo/role', { role: 'buyer' }, cookie);
  const created = await request(p + '/cases', report, cookie);
  assert.equal(created.res.status, 201);
  const c = created.data.id;
  const refund = {
    requestId: crypto.randomUUID(),
    amount: 5000,
    note: 'Partial refund approved after reviewing this payment concern.',
  };
  assert.equal((await request(p + `/cases/${c}/refunds`, refund, cookie)).res.status, 403);
  assert.equal(
    (await request('/recovery/resume', { confirmResume: true }, cookie)).res.status,
    409,
  );
  assert.equal(
    (
      await request(
        '/payment-rules',
        {
          enabled: true,
          perPaymentLimit: 15000,
          monthlyLimit: 50000,
          confirmAutomaticCapture: true,
        },
        cookie,
        'PUT',
      )
    ).res.status,
    409,
  );
  const other = await visitor();
  assert.equal((await request(p + `/cases/${c}/refunds`, refund, other.cookie)).res.status, 404);
  await request('/demo/role', { role: 'developer' }, cookie);
  assert.equal(
    (await request(p + `/cases/${c}/review`, { decision: 'decline', message: '' }, cookie)).res
      .status,
    400,
  );
  assert.equal((await request(p + `/cases/${c}/refunds`, refund, cookie)).res.status, 200);
  assert.equal((await request(p + `/cases/${c}/refunds`, refund, cookie)).res.status, 200);
  let state = (await request('/workspace', undefined, cookie)).data;
  assert.equal(state.refundBalances[id].completed, 5000);
  assert.equal(state.agreements[0].payment.refunds.length, 1);
  assert.ok(state.recoveryPause);
  assert.equal(
    (
      await request(
        p + `/cases/${c}/refunds`,
        { ...refund, requestId: crypto.randomUUID(), amount: 10001 },
        cookie,
      )
    ).res.status,
    400,
  );
  await request('/demo/role', { role: 'buyer' }, cookie);
  assert.equal(
    (
      await request(
        p + `/cases/${c}/buyer-decision`,
        {
          decision: 'accept',
          message: 'I accept this confirmed partial refund as a resolution of my complaint.',
        },
        cookie,
      )
    ).res.status,
    200,
  );
  assert.equal(
    (await request('/recovery/resume', { confirmResume: true }, cookie)).res.status,
    200,
  );
  state = (await request('/workspace', undefined, cookie)).data;
  assert.equal(state.recoveryPause, undefined);
  assert.equal(state.agreements[0].cases[0].status, 'resolved');
});

test('verified refund webhook confirms a tracked pending refund exactly once', async () => {
  const { seedWorkspace } = await import('../server/domain.js');
  const { createWorkspace } = await import('../server/db.js');
  const { reportProblem, issueRefund } = await import('../server/recovery.js');
  const w = seedWorkspace('refund-webhook', false),
    a = w.agreements[0];
  a.status = 'completed';
  a.payment = {
    mode: 'sandbox',
    status: 'captured',
    captureId: 'CAPTURE-REFUND',
    orderId: 'ORDER-REFUND',
    version: 1,
    capturedAt: new Date().toISOString(),
  };
  await createWorkspace(w);
  const c = await reportProblem(w.id, a.id, {
    reason: 'duplicate',
    description: 'I believe this payment duplicates an earlier payment and request a review.',
    requestedAmount: 15000,
  });
  process.env.PAYPAL_CLIENT_ID = 'test';
  process.env.PAYPAL_CLIENT_SECRET = 'test';
  process.env.PAYPAL_WEBHOOK_ID = 'WH-REFUND';
  const original = globalThis.fetch;
  let statusReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api-m.sandbox.paypal.com')) return original(input, init);
    const json = (body: any) =>
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/token')) return json({ access_token: 'test' });
    if (url.endsWith('verify-webhook-signature')) return json({ verification_status: 'SUCCESS' });
    if (url.endsWith('/refund'))
      return json({
        id: 'REFUND-WEBHOOK',
        status: 'PENDING',
        amount: { currency_code: 'USD', value: '150.00' },
      });
    statusReads++;
    return json({
      id: 'REFUND-WEBHOOK',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '150.00' },
    });
  };
  try {
    await issueRefund(w.id, a.id, c, {
      requestId: crypto.randomUUID(),
      amount: 15000,
      note: 'Full refund approved after reviewing the duplicate-payment report.',
    });
    const payload = {
      id: 'WH-REFUND-CONFIRMED',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: { id: 'REFUND-WEBHOOK' },
    };
    assert.equal((await request('/paypal/webhook', payload)).res.status, 200);
    assert.equal((await request('/paypal/webhook', payload)).res.status, 200);
    assert.equal(statusReads, 1);
    const { rows } = await query('SELECT body FROM workspaces WHERE id=$1', [w.id]);
    assert.equal(rows[0].body.agreements[0].cases[0].status, 'refunded');
    assert.equal(rows[0].body.agreements[0].payment.refunds[0].status, 'completed');
  } finally {
    globalThis.fetch = original;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_WEBHOOK_ID;
  }
});

test('agreement change permissions, private notifications, and proposal-bound consent', async () => {
  const x = await visitor(),
    y = await visitor();
  const original = x.w.agreements[0];
  const proposal = {
    baseVersion: original.version,
    amount: original.amount + 200,
    brief: original.brief,
    dueAt: original.dueAt,
    effectiveAt: new Date().toISOString(),
    reason: 'Operating costs increased; this is the business explanation.',
    criteria: original.criteria,
    terms: [
      {
        id: 'analytics',
        title: 'Analytics data sharing',
        text: 'Usage data may be shared with analytics partners.',
      },
    ],
  };
  const path = `/agreements/${x.id}/changes`;
  const created = await request(path, proposal, x.cookie);
  assert.equal(created.res.status, 201);
  const cid = created.data.id;
  assert.equal((await request(path, proposal, x.cookie)).res.status, 409);
  assert.equal(
    (await request(path + '/' + cid + '/decision', { decision: 'accept' }, x.cookie)).res.status,
    403,
  );
  assert.equal((await request(path + '/' + cid + '/review', {}, x.cookie)).res.status, 403);
  assert.equal(
    (
      await request(
        path + '/' + cid + '/messages',
        { text: 'Attempt to read another buyer terms.' },
        y.cookie,
      )
    ).res.status,
    404,
  );
  assert.equal(
    (await request('/workspace', undefined, y.cookie)).data.agreements.some(
      (a: any) => a.changes?.length,
    ),
    false,
  );
  await request('/demo/role', { role: 'buyer' }, x.cookie);
  assert.equal((await request(path, proposal, x.cookie)).res.status, 403);
  assert.equal((await request(path + '/' + cid + '/withdraw', {}, x.cookie)).res.status, 403);
  assert.equal(
    (
      await request(
        path + '/' + cid + '/messages',
        { text: 'Which partners receive my usage data?' },
        x.cookie,
      )
    ).res.status,
    200,
  );
  const a = (await request('/workspace', undefined, x.cookie)).data.agreements[0],
    c = a.changes[0];
  assert.equal(c.status, 'pending');
  assert.equal(c.diffs.length, 2);
  assert.equal(
    (await request(`/agreements/${x.id}`, { criteria: original.criteria }, x.cookie, 'PATCH')).res
      .status,
    409,
  );
  assert.equal(
    (
      await request(
        path + '/' + cid + '/decision',
        {
          decision: 'accept',
          digest: c.proposalDigest,
          acknowledge: false,
          note: 'I have reviewed all changed terms.',
        },
        x.cookie,
      )
    ).res.status,
    400,
  );
  const accepted = await request(
    path + '/' + cid + '/decision',
    {
      decision: 'accept',
      digest: c.proposalDigest,
      acknowledge: true,
      note: 'I reviewed the price and added data clause.',
    },
    x.cookie,
  );
  assert.equal(accepted.res.status, 200);
  assert.ok(accepted.data.replacementId);
  assert.equal(
    (
      await request(
        path + '/' + cid + '/decision',
        {
          decision: 'accept',
          digest: c.proposalDigest,
          acknowledge: true,
          note: 'A repeated acceptance of the same terms.',
        },
        x.cookie,
      )
    ).res.status,
    409,
  );
});
