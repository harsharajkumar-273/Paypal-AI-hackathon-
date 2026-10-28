import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.TEST_DB = 'true';
process.env.OPENAI_API_KEY = '';
const { initDb, closeDb, createWorkspace, getWorkspace, mutate } = await import('../server/db.js');
const { seedWorkspace, assertPaymentReady, eligible } = await import('../server/domain.js');
const {
  proposeChange,
  decideChange,
  reviewChange,
  changeMessage,
  withdrawChange,
  validateReviewCitations,
} = await import('../server/changes.js');
const { createAuthorization, approve, confirmAuthorization, voidAuthorization } =
  await import('../server/service.js');
const { evaluateAutomaticPayment } = await import('../server/automation.js');
before(initDb);
after(closeDb);
async function fixture() {
  const w = seedWorkspace(randomUUID(), true);
  await createWorkspace(w);
  return { w, id: w.agreements[0].id };
}
function input(a: any) {
  return {
    baseVersion: a.version,
    amount: a.amount + 200,
    brief: a.brief,
    dueAt: a.dueAt,
    effectiveAt: new Date(Date.now() - 1000).toISOString(),
    reason: 'The business says operating costs increased; this claim needs evidence.',
    criteria: a.criteria,
    terms: [
      {
        id: 'sharing',
        title: 'Usage data sharing',
        text: 'Usage data may be shared with analytics partners.',
      },
    ],
  };
}
async function proposed() {
  const { w, id } = await fixture();
  const result = await proposeChange(w.id, id, input(w.agreements[0]));
  const current = (await getWorkspace(w.id)).agreements[0];
  return { workspace: w.id, id, c: current.changes![0], a: current, changeId: result.id };
}
const decision = (c: any, d = 'accept') => ({
  decision: d,
  digest: c.proposalDigest,
  acknowledge: true,
  note: 'I reviewed the exact price and data clauses before deciding.',
});
test('a proposal records exact price and non-price additions without mutating original terms', async () => {
  const x = await proposed();
  assert.equal(x.a.amount, x.c.before.amount);
  assert.equal(x.a.terms, undefined);
  assert.deepEqual(
    x.c.diffs.map((d) => d.ref),
    ['amount', 'clause:sharing'],
  );
  assert.equal(x.c.after.amount - x.c.before.amount, 200);
  assert.equal(x.c.proposalDigest.length, 64);
  assert.notEqual(x.c.proposalDigest, x.c.digest);
});
test('pending proposals block authorization and manual/automatic capture even with passing evidence', async () => {
  const x = await proposed();
  await mutate(x.workspace, (w) => {
    const a = w.agreements[0];
    a.status = 'active';
    a.approvals = { buyer: 'approved', developer: 'approved' };
    a.payment = {
      mode: 'demo',
      status: 'authorized',
      version: a.version,
      authorizationId: 'DEMO-AUTH',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    a.manualAccepted = a.criteria.filter((c) => c.type === 'manual').map((c) => c.id);
    a.runs = [
      {
        id: randomUUID(),
        url: 'fixture:fixed',
        version: a.version,
        status: 'completed',
        createdAt: new Date().toISOString(),
        results: a.criteria
          .filter((c) => c.type !== 'manual')
          .map((c) => ({ criterionId: c.id, status: 'pass', observed: 'pass', durationMs: 1 })),
      },
    ];
    w.paymentRules = { enabled: true, version: 1, perPaymentLimit: 50000, monthlyLimit: 100000 };
  });
  const w = await getWorkspace(x.workspace),
    a = w.agreements[0];
  assert.equal(eligible(a), false);
  assert.throws(() => assertPaymentReady(a), /proposed agreement/);
  assert.match(evaluateAutomaticPayment(w, a).reasons.join(), /new buyer decision/);
  await assert.rejects(createAuthorization(x.workspace, x.id), /proposed terms/);
});
test('acceptance creates a fresh approved version and discards old payment and verification eligibility', async () => {
  const x = await proposed();
  const result = await decideChange(x.workspace, x.id, x.changeId, decision(x.c));
  const w = await getWorkspace(x.workspace),
    old = w.agreements.find((a) => a.id === x.id)!,
    a = w.agreements.find((a) => a.id === result.replacementId)!;
  assert.equal(old.status, 'superseded');
  assert.equal(old.changes![0].status, 'accepted');
  assert.equal(a.version, 2);
  assert.equal(a.amount, x.c.after.amount);
  assert.equal(a.terms![0].id, 'sharing');
  assert.ok(a.approvals.buyer && a.approvals.developer);
  assert.deepEqual(a.runs, []);
  assert.deepEqual(a.payment, { mode: 'demo', status: 'none' });
  assert.equal(eligible(a), false);
  await assert.rejects(decideChange(x.workspace, x.id, x.changeId, decision(x.c)));
});
test('old authorization must be voided before replacement acceptance', async () => {
  const { w, id } = await fixture();
  await approve(w.id, id, 'developer');
  await approve(w.id, id, 'buyer');
  await createAuthorization(w.id, id);
  await confirmAuthorization(w.id, id);
  const { id: cid } = await proposeChange(w.id, id, input(w.agreements[0]));
  let a = (await getWorkspace(w.id)).agreements[0],
    c = a.changes![0];
  await assert.rejects(decideChange(w.id, id, cid, decision(c)), /Void the previous/);
  await voidAuthorization(w.id, id, false);
  const r = await decideChange(w.id, id, cid, decision(c));
  assert.ok(r.replacementId);
  assert.equal((await getWorkspace(w.id)).agreements[0].payment.status, 'none');
});
test('changed effective time prevents premature authorization', async () => {
  const { w, id } = await fixture();
  const proposal = input(w.agreements[0]);
  proposal.effectiveAt = new Date(Date.now() + 3600000).toISOString();
  const { id: cid } = await proposeChange(w.id, id, proposal);
  const c = (await getWorkspace(w.id)).agreements[0].changes![0];
  const r = await decideChange(w.id, id, cid, decision(c));
  await assert.rejects(createAuthorization(w.id, r.replacementId!), /not effective/);
});
test('declining explicitly keeps the original terms and records a buyer decision', async () => {
  const x = await proposed();
  await decideChange(x.workspace, x.id, x.changeId, decision(x.c, 'decline'));
  const a = (await getWorkspace(x.workspace)).agreements[0];
  assert.equal(a.amount, x.c.before.amount);
  assert.equal(a.status, 'draft');
  assert.equal(a.changes![0].status, 'declined');
  assert.ok(a.changes![0].decidedAt);
});
test('stale snapshots, altered proposal digests, and missing consent are rejected', async () => {
  const x = await proposed();
  await assert.rejects(
    decideChange(x.workspace, x.id, x.changeId, { ...decision(x.c), digest: 'f'.repeat(64) }),
    /does not match/,
  );
  await assert.rejects(
    decideChange(x.workspace, x.id, x.changeId, { ...decision(x.c), acknowledge: false }),
  );
  await mutate(x.workspace, (w) => {
    w.agreements[0].brief += ' Changed elsewhere.';
  });
  await assert.rejects(decideChange(x.workspace, x.id, x.changeId, decision(x.c)), /stale/);
});
test('AI unavailability preserves every exact difference and cannot imply approval', async () => {
  const x = await proposed();
  const r = await reviewChange(x.workspace, x.id, x.changeId);
  assert.equal(r.status, 'unavailable');
  assert.equal(r.source, 'recorded-diff');
  assert.deepEqual(r.findings, []);
  const c = (await getWorkspace(x.workspace)).agreements[0].changes![0];
  assert.equal(c.status, 'pending');
  assert.equal(c.diffs.length, 2);
});
test('fabricated clause references or quotes are rejected', () => {
  const diffs = [
    {
      ref: 'clause:data',
      title: 'Data sharing',
      before: 'Private data.',
      after: 'Data may be shared.',
    },
  ];
  const finding = {
    ref: 'clause:data',
    category: 'data' as const,
    quote: 'Data may be shared.',
    explanation: 'Sharing permission expands.',
    question: 'Which partners receive the data?',
  };
  assert.doesNotThrow(() =>
    validateReviewCitations({ summary: 'Review data changes.', findings: [finding] }, diffs),
  );
  assert.throws(
    () =>
      validateReviewCitations(
        { summary: 'Review', findings: [{ ...finding, quote: 'Everything is safe.' }] },
        diffs,
      ),
    /unsupported/,
  );
  assert.throws(
    () =>
      validateReviewCitations(
        { summary: 'Review', findings: [{ ...finding, ref: 'clause:invented' }] },
        diffs,
      ),
    /unsupported/,
  );
});
test('questions remain on pending proposals and withdrawal is auditable', async () => {
  const x = await proposed();
  await changeMessage(x.workspace, x.id, x.changeId, 'buyer', {
    text: 'Which analytics partners would receive the usage data?',
  });
  await changeMessage(x.workspace, x.id, x.changeId, 'developer', {
    text: 'We need to clarify the partners before adopting this clause.',
  });
  await withdrawChange(x.workspace, x.id, x.changeId);
  const c = (await getWorkspace(x.workspace)).agreements[0].changes![0];
  assert.equal(c.messages.length, 2);
  assert.equal(c.status, 'withdrawn');
  await assert.rejects(
    changeMessage(x.workspace, x.id, x.changeId, 'buyer', { text: 'A stale question' }),
    /stale/,
  );
});

test('AI explanations use the complete documents and keep verified clause citations', async () => {
  const x = await proposed(),
    originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-only-key';
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string),
        payload = JSON.parse(body.input);
      assert.equal(payload.before.amount, x.c.before.amount);
      assert.equal(payload.after.terms[0].id, 'sharing');
      assert.match(body.instructions, /untrusted/);
      assert.match(body.instructions, /claim, not a verified cause/);
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    summary:
                      'The fixed price increases and a usage-sharing clause is added. Review the exact terms.',
                    findings: [
                      {
                        ref: 'clause:sharing',
                        category: 'data',
                        quote: 'Usage data may be shared with analytics partners.',
                        explanation: 'The proposal adds permission to share usage data.',
                        question: 'Which partners and what retention period apply?',
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    };
    const review = await reviewChange(x.workspace, x.id, x.changeId);
    assert.equal(review.status, 'completed');
    assert.equal(review.source, 'openai');
    assert.equal(review.findings[0].ref, 'clause:sharing');
    assert.equal((await getWorkspace(x.workspace)).agreements[0].changes![0].status, 'pending');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = '';
  }
});
