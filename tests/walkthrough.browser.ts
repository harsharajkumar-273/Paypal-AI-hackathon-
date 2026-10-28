import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.TEST_DB = 'true';
process.env.RUN_WORKER = 'false';
process.env.OPENAI_API_KEY = '';
const { initDb, closeDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { tick } = await import('../server/worker.js');
const { walkthroughState } = await import('../src/walkthroughState.js');
test(
  'guided walkthrough uses actual queued browser checks, blocks the broken form and captures only the correction',
  { timeout: 120000 },
  async () => {
    await initDb();
    const server = await new Promise<any>((resolve) => {
      const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    process.env.APP_URL = origin;
    process.env.FIXTURE_ORIGIN = origin;
    const originalFetch = globalThis.fetch;
    let modelCalls = 0;
    process.env.OPENAI_API_KEY = 'unused-guided-example-test-key';
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://api.openai.com/')) {
        modelCalls++;
        throw new Error('The guided fixture path must not request model output.');
      }
      return originalFetch(input, init);
    };
    let cookie = '';
    const request = async (path: string, body?: unknown, method?: string) => {
      const response = await fetch(origin + '/api' + path, {
        method: method || (body === undefined ? 'GET' : 'POST'),
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      assert.ok(response.ok, JSON.stringify(data));
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie')!.split(';')[0];
      return data;
    };
    try {
      await request('/session', {});
      const start = await request('/demo/walkthrough', {}),
        path = '/agreements/' + start.id;
      await request('/demo/role', { role: 'developer' });
      await request(path + '/approve', {});
      await request('/demo/role', { role: 'buyer' });
      await request(path + '/approve', {});
      await request(path + '/payments/order', {});
      await request(path + '/payments/authorize', {});
      await request(
        '/payment-rules',
        {
          enabled: true,
          perPaymentLimit: 7500,
          monthlyLimit: 15000,
          confirmAutomaticCapture: true,
        },
        'PUT',
      );
      await request('/demo/role', { role: 'developer' });
      await request(path + '/verify', { url: 'fixture:broken' });
      await tick();
      let w = await request('/workspace'),
        a = w.agreements[0];
      assert.equal(a.payment.status, 'authorized');
      assert.equal(a.runs[0].results.find((r: any) => r.criterionId === 'booking').status, 'fail');
      assert.equal(walkthroughState(a, true).step, 2);
      assert.equal(a.runs[0].results.filter((r: any) => r.status === 'pass').length, 4);
      const proof = await fetch(origin + a.runs[0].results[0].screenshot, {
        headers: { Cookie: cookie },
      });
      assert.equal(proof.status, 200);
      assert.match(proof.headers.get('content-type')!, /image/);
      await request('/demo/walkthrough/continue', {});
      w = await request('/workspace');
      assert.ok(w.walkthrough.failureReviewedAt);
      await request(path + '/verify', { url: 'fixture:fixed' });
      await tick();
      w = await request('/workspace');
      a = w.agreements[0];
      assert.equal(a.runs[0].results.filter((r: any) => r.status === 'pass').length, 5);
      assert.equal(a.payment.status, 'captured');
      assert.equal(a.payment.captureMethod, 'automatic');
      assert.match(a.payment.captureId, /^DEMO-/);
      assert.equal(walkthroughState(a, true, true).step, 4);
      const extra = await request('/demo/walkthrough/terms', {}),
        again = await request('/demo/walkthrough/terms', {});
      assert.equal(extra.id, again.id);
      w = await request('/workspace');
      assert.equal(w.agreements.length, 2);
      const next = w.agreements.find((x: any) => x.id === extra.id);
      assert.equal(next.changes[0].after.amount - next.amount, 200);
      assert.equal(next.changes[0].diffs.length, 2);
      assert.ok(next.approvals.buyer && next.approvals.developer);
      assert.equal(
        w.agreements.find((x: any) => x.id === a.id).payment.captureId,
        a.payment.captureId,
      );
      assert.equal(modelCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.OPENAI_API_KEY = '';
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
    }
  },
);
