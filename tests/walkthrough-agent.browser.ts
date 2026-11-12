import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.TEST_DB = 'true';
process.env.RUN_WORKER = 'false';
process.env.OPENAI_API_KEY = '';
const { initDb, closeDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { tick } = await import('../server/worker.js');
const { walkthroughState } = await import('../src/walkthroughState.js');

const falseSuccess = {
  handler: "document.querySelector('#feedback').textContent='Your table is reserved.';",
  explanation: 'Shows the success text without contacting the reservation endpoint.',
};
const working = {
  handler:
    "const r = await fetch('/fixtures/reserve', {method:'POST',credentials:'omit',body:new URLSearchParams(new FormData(e.target))});\nconst d = await r.json();\ndocument.querySelector('#feedback').textContent = r.ok && d.ok ? d.message : 'Unable to reserve.';",
  explanation: 'Posts the form to the approved endpoint and shows its confirmation.',
};
// The same envelope the OpenAI Responses API returns for a structured output.
const modelReply = (patch: unknown) =>
  new Response(
    JSON.stringify({
      output: [
        { type: 'reasoning', summary: [] },
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(patch) }],
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

test(
  'guided walkthrough can have the repair agent write the fix, and falls back to the authored correction',
  { timeout: 180000 },
  async () => {
    await initDb();
    const server = await new Promise<any>((resolve) => {
      const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    process.env.APP_URL = origin;
    process.env.FIXTURE_ORIGIN = origin;
    const originalFetch = globalThis.fetch;
    const modelRequests: any[] = [];
    let replies: unknown[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://api.openai.com/')) {
        modelRequests.push(JSON.parse(String(init?.body)));
        return modelReply(replies.shift());
      }
      return originalFetch(input, init);
    };
    let cookie = '';
    const send = async (path: string, body?: unknown, method?: string) => {
      const response = await fetch(origin + '/api' + path, {
        method: method || (body === undefined ? 'GET' : 'POST'),
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie')!.split(';')[0];
      return { status: response.status, data: await response.json() };
    };
    const request = async (path: string, body?: unknown, method?: string) => {
      const { status, data } = await send(path, body, method);
      assert.ok(status < 400, JSON.stringify(data));
      return data;
    };
    const toFailedCheck = async () => {
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
      return path;
    };
    const current = async () => {
      const w = await request('/workspace');
      return { w, a: w.agreements.find((x: any) => x.id === w.walkthrough.agreementId) };
    };
    try {
      await request('/session', {});
      let path = await toFailedCheck();

      // The agent cannot be chosen before the failure is reviewed, or without a model key.
      process.env.OPENAI_API_KEY = 'test-key-never-sent-to-a-provider';
      assert.equal((await send('/demo/walkthrough/agent', {})).status, 409);
      await request('/demo/walkthrough/continue', {});
      process.env.OPENAI_API_KEY = '';
      assert.equal((await send('/demo/walkthrough/agent', {})).status, 503);
      assert.equal((await current()).a.agentTask, undefined);

      // A false-success patch is rejected by the browser; the revised patch earns payment.
      process.env.OPENAI_API_KEY = 'test-key-never-sent-to-a-provider';
      replies = [falseSuccess, working];
      await request('/demo/walkthrough/agent', {});
      await request(path + '/agent/start', {});
      let { w, a } = await current();
      assert.equal(walkthroughState(a, true, true).step, 3);
      assert.equal(walkthroughState(a, true, true).running, true);
      await tick();
      ({ w, a } = await current());
      const agent = a.agentRuns[0];
      assert.equal(agent.status, 'completed');
      assert.equal(agent.model, 'gpt-4.1-mini');
      assert.equal(agent.attempts.length, 2);
      assert.equal(modelRequests.length, 2);
      const firstInput = JSON.parse(modelRequests[0].input),
        secondInput = JSON.parse(modelRequests[1].input);
      assert.match(firstInput.page, /<form id="booking"/);
      assert.match(
        secondInput.results.find((r: any) => r.criterionId === 'booking').observed,
        /No successful POST reached the approved endpoint/,
      );
      assert.equal(a.payment.status, 'captured');
      assert.equal(a.payment.captureMethod, 'automatic');
      const state = walkthroughState(a, true, true);
      assert.equal(state.step, 4);
      assert.equal(state.passed, true);
      assert.equal(state.correctedRun?.artifactSha256, agent.artifactSha256);
      assert.ok(state.failedRun, 'the original failed delivery stays in history');
      assert.ok(w.walkthrough.agentChosenAt);

      // If the model never produces a passing patch, nothing is paid and the authored fix still works.
      path = await toFailedCheck();
      await request('/demo/walkthrough/continue', {});
      replies = [falseSuccess, falseSuccess];
      await request('/demo/walkthrough/agent', {});
      await request(path + '/agent/start', {});
      await tick();
      ({ a } = await current());
      assert.equal(a.agentRuns[0].status, 'error');
      assert.equal(a.payment.status, 'authorized');
      assert.equal(walkthroughState(a, true, true).step, 3);
      assert.equal(walkthroughState(a, true, true).correctedRun, undefined);
      assert.equal((await send(path + '/verify', { url: 'fixture:broken' })).status, 400);
      await request(path + '/verify', { url: 'fixture:fixed' });
      await tick();
      ({ a } = await current());
      assert.equal(a.payment.status, 'captured');
      assert.equal(walkthroughState(a, true, true).correctedRun?.artifactSha256, undefined);
      assert.equal(modelRequests.length, 4);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.OPENAI_API_KEY = '';
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
    }
  },
);
