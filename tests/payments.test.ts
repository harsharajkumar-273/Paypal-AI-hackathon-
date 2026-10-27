import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.TEST_DB = 'true';
process.env.PAYPAL_CLIENT_ID = 'test-client';
process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
const { initDb, closeDb, createWorkspace, mutate, getWorkspace } = await import('../server/db.js');
const { seedWorkspace } = await import('../server/domain.js');
const { capture, find, createAuthorization, confirmAuthorization, reconcile, voidAuthorization } =
  await import('../server/service.js');
const originalFetch = globalThis.fetch;
before(async () => {
  await initDb();
});
after(async () => {
  globalThis.fetch = originalFetch;
  await closeDb();
});
async function setup(id: string) {
  const w = seedWorkspace(id, false),
    a = w.agreements[0];
  a.status = 'active';
  a.approvals = { developer: 'now', buyer: 'now' };
  a.payment = {
    mode: 'sandbox',
    status: 'authorized',
    version: 1,
    orderId: 'ORDER',
    authorizationId: 'AUTH',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  a.manualAccepted = ['design'];
  a.runs = [
    {
      id: 'run',
      url: 'https://example.com',
      version: 1,
      status: 'completed',
      createdAt: new Date().toISOString(),
      results: a.criteria.map((c) => ({
        criterionId: c.id,
        status: c.type === 'manual' ? 'manual' : 'pass',
        observed: 'Evidence',
        durationMs: 1,
      })),
    },
  ];
  await createWorkspace(w);
  return { w, a };
}
const json = (value: any, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
test('uncertain sandbox capture retries with identical key and amount, then returns same local receipt', async () => {
  const { w, a } = await setup('uncertain');
  const requests: { id: string; body: any }[] = [];
  let fail = true;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/token')) return json({ access_token: 'fake-token' });
    requests.push({
      id: (init!.headers as any)['PayPal-Request-Id'],
      body: JSON.parse(init!.body as string),
    });
    if (fail) {
      fail = false;
      throw new Error('Simulated connection lost after dispatch');
    }
    return json({ id: 'CAPTURE-1', status: 'COMPLETED' });
  };
  await assert.rejects(() => capture(w.id, a.id), /connection lost/);
  let current = find(await getWorkspace(w.id), a.id);
  assert.equal(current.payment.status, 'capture_pending');
  assert.equal(current.payment.busy, undefined);
  await assert.rejects(() => voidAuthorization(w.id, a.id), /uncertain/);
  await capture(w.id, a.id);
  await capture(w.id, a.id);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].id, requests[1].id);
  assert.deepEqual(requests[0].body, requests[1].body);
  assert.equal(requests[0].body.amount.value, '150.00');
  current = find(await getWorkspace(w.id), a.id);
  assert.equal(current.payment.captureId, 'CAPTURE-1');
  assert.equal(current.status, 'completed');
});
test('pending PayPal capture is never shown as completed and can reconcile', async () => {
  const { w, a } = await setup('pending');
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/token')) return json({ access_token: 'fake' });
    if (String(input).endsWith('/capture'))
      return json({ id: 'CAPTURE-PENDING', status: 'PENDING' });
    return json({
      purchase_units: [
        {
          reference_id: a.id,
          payments: {
            captures: [
              {
                id: 'CAPTURE-PENDING',
                status: 'COMPLETED',
                amount: { currency_code: 'USD', value: '150.00' },
              },
            ],
          },
        },
      ],
    });
  };
  await capture(w.id, a.id);
  assert.equal(find(await getWorkspace(w.id), a.id).status, 'active');
  assert.equal(find(await getWorkspace(w.id), a.id).payment.status, 'capture_pending');
  await reconcile(w.id, a.id);
  assert.equal(find(await getWorkspace(w.id), a.id).payment.status, 'captured');
});
test('authorization checks the returned amount and preserves a retryable order on mismatch', async () => {
  const { w, a } = await setup('wrong-amount');
  await mutate(w.id, (w) => {
    find(w, a.id).payment = {
      mode: 'sandbox',
      status: 'created',
      orderId: 'ORDER',
      operation: 'cycle',
      version: 1,
    };
  });
  globalThis.fetch = async (input) =>
    String(input).endsWith('/token')
      ? json({ access_token: 'fake' })
      : json({
          purchase_units: [
            {
              payments: {
                authorizations: [
                  {
                    id: 'WRONG',
                    status: 'CREATED',
                    amount: { currency_code: 'USD', value: '1.00' },
                  },
                ],
              },
            },
          ],
        });
  await assert.rejects(() => confirmAuthorization(w.id, a.id), /amount/);
  assert.equal(find(await getWorkspace(w.id), a.id).payment.status, 'created');
});
test('expired authorization permits a fresh order without retaining old authorization ID', async () => {
  const { w, a } = await setup('expired');
  await mutate(w.id, (w) => {
    find(w, a.id).payment.expiresAt = new Date(0).toISOString();
  });
  assert.equal(find(await getWorkspace(w.id), a.id).payment.status, 'expired');
  globalThis.fetch = async (input) =>
    String(input).endsWith('/token')
      ? json({ access_token: 'fake' })
      : json({
          id: 'FRESH',
          links: [
            { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=FRESH' },
          ],
        });
  await createAuthorization(w.id, a.id);
  const current = find(await getWorkspace(w.id), a.id);
  assert.equal(current.payment.orderId, 'FRESH');
  assert.equal(current.payment.authorizationId, undefined);
  assert.equal(current.payment.status, 'created');
});
