import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { structured } from './ai.js';
import { query, getWorkspace, mutate } from './db.js';
import { ensure, event, type Agreement, type Result, type Criterion } from './domain.js';
import { find, settleAutomaticPayments } from './service.js';
import { brokenBookingHandler, cafeHtml } from './fixtures.js';
import { verify } from './verifier.js';

export type AgentRun = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'error';
  version: number;
  createdAt: string;
  completedAt?: string;
  model?: string;
  error?: string;
  artifactId?: string;
  artifactSha256?: string;
  steps: { at: string; tool: string; detail: string }[];
  attempts: {
    artifactId: string;
    sha256: string;
    handler: string;
    explanation: string;
    results: Result[];
  }[];
};
const patchSchema = z.object({
  handler: z.string().min(20).max(6000),
  explanation: z.string().min(10).max(1200),
});
export async function proposeRepair(input: {
  brief: string;
  criteria: Criterion[];
  handler: string;
  results: Omit<Result, 'screenshot'>[];
  attempt: number;
  remainingMs?: number;
}) {
  ensure(
    process.env.OPENAI_API_KEY,
    'Configure OPENAI_API_KEY to run a real repair agent. The walkthrough fixtures do not pretend to be AI output.',
    503,
  );
  return structured(
    'booking_handler_patch',
    `You are the bounded ProofPay website repair agent. Repair only the JavaScript body of an existing async submit handler. e.preventDefault() is already executed before your code. You may read form fields name and email and update #feedback. The only permitted endpoint is /fixtures/reserve, a test-only POST endpoint; it returns JSON {ok:true,message:"Your table is reserved."}. Use fetch with credentials:'omit' and URLSearchParams body (no custom headers), then show the exact success text only after a successful endpoint response. Handle network failures honestly. Return actual JavaScript, not a plan or Markdown. Do not modify other page content, tests, criteria, price, payment, or browser navigation. The independent verifier requires both an HTTP-success POST and visible success text. No server execution is available.`,
    input,
    patchSchema,
    {
      type: 'object',
      properties: { handler: { type: 'string' }, explanation: { type: 'string' } },
      required: ['handler', 'explanation'],
      additionalProperties: false,
    },
    Math.max(1, Math.min(45000, input.remainingMs || 45000)),
  );
}
export function artifactHeaders(origin: string) {
  return {
    'Content-Security-Policy': `sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src ${origin}; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}
function activeTask(a: Agreement, runId: string) {
  const agent = a.agentRuns?.find((r) => r.id === runId);
  ensure(
    agent && a.agentTask && a.status === 'active' && agent.version === a.version,
    'Agent task was closed or changed.',
  );
  ensure(
    a.payment.status === 'authorized',
    'The existing buyer authorization is no longer available.',
  );
  ensure(a.runs.find((r) => r.id === runId)?.status === 'running', 'Agent task was interrupted.');
  return agent;
}
export async function runRepairAgent(
  workspaceId: string,
  agreementId: string,
  runId: string,
  dependencies: {
    repair?: typeof proposeRepair;
    check?: typeof verify;
    fixtureOrigin?: string;
  } = {},
) {
  const fixtureOrigin =
    dependencies.fixtureOrigin ||
    process.env.FIXTURE_ORIGIN ||
    `http://127.0.0.1:${process.env.PORT || 3001}`;
  const repair = dependencies.repair || proposeRepair,
    check = dependencies.check || verify;
  const started = Date.now();
  const trace = async (tool: string, detail: string) =>
    mutate(workspaceId, (w) => {
      const a = find(w, agreementId),
        agent = activeTask(a, runId);
      agent.steps.push({ at: new Date().toISOString(), tool, detail });
    });
  try {
    if (!dependencies.repair)
      ensure(
        process.env.OPENAI_API_KEY,
        'The AI key is not configured. No model run was performed.',
        503,
      );
    const w = await getWorkspace(workspaceId),
      snapshot = find(w, agreementId);
    await mutate(workspaceId, (w) => {
      const a = find(w, agreementId),
        agent = a.agentRuns?.find((r) => r.id === runId);
      ensure(
        agent &&
          agent.status === 'queued' &&
          a.status === 'active' &&
          a.version === agent.version &&
          a.payment.status === 'authorized',
        'Agent task is not available.',
      );
      agent.status = 'running';
      agent.model = dependencies.repair
        ? 'test-adapter'
        : process.env.OPENAI_MODEL || 'gpt-4.1-mini';
      const run = a.runs.find((r) => r.id === runId)!;
      run.status = 'running';
      event(
        a,
        'Repair agent started',
        'The agent can edit the booking handler, but cannot change checks, price, authorization, or payment rules.',
      );
    });
    await trace(
      'inspect_source',
      `Read the authored café page and its defective booking submit handler (${cafeHtml(false).length} source characters).`,
    );
    let handler = brokenBookingHandler;
    let results = await check(`${fixtureOrigin}/fixtures/broken`, snapshot.criteria, {
      fixture: true,
      fixtureOrigin,
      deadlineMs: 30000,
    });
    await trace(
      'verify_baseline',
      `${results.filter((r) => r.status === 'pass').length} checks passed; ${results.filter((r) => r.status === 'fail').length} failed. No delivery submitted and no payment requested.`,
    );
    for (let attempt = 1; attempt <= 2; attempt++) {
      ensure(
        Date.now() - started < 135000,
        'Agent time budget reached. No passing delivery was submitted.',
      );
      await trace(
        'request_patch',
        `Requesting model-written repair ${attempt}/2 using actual source and verifier feedback.`,
      );
      const patch = patchSchema.parse(
        await repair({
          brief: snapshot.brief,
          criteria: snapshot.criteria,
          handler,
          results: results.map(({ screenshot, ...r }) => r),
          attempt,
          remainingMs: 135000 - (Date.now() - started),
        }),
      );
      ensure(
        Date.now() - started < 135000,
        'Agent time budget reached. No new artifact was submitted.',
      );
      handler = patch.handler;
      const artifactId = randomUUID(),
        html = cafeHtml(false, handler),
        sha256 = createHash('sha256').update(html).digest('hex');
      // Generated JavaScript is stored as text. Only an isolated browser executes it.
      await query(
        'INSERT INTO agent_artifacts(id,workspace_id,agreement_id,handler,sha256,html) VALUES($1,$2,$3,$4,$5,$6)',
        [artifactId, workspaceId, agreementId, handler, sha256, html],
      );
      await mutate(workspaceId, (w) => {
        const agent = activeTask(find(w, agreementId), runId);
        agent.attempts.push({
          artifactId,
          sha256,
          handler,
          explanation: patch.explanation,
          results: [],
        });
      });
      await trace(
        'write_artifact',
        `Saved immutable booking-handler patch ${sha256.slice(0, 12)}. ${patch.explanation}`,
      );
      results = await check(`${fixtureOrigin}/fixtures/agent/${artifactId}`, snapshot.criteria, {
        fixture: true,
        fixtureOrigin,
        deadlineMs: Math.max(1, Math.min(30000, 135000 - (Date.now() - started))),
      });
      await mutate(workspaceId, (w) => {
        const agent = activeTask(find(w, agreementId), runId);
        agent.attempts.find((a) => a.artifactId === artifactId)!.results = results;
      });
      await trace(
        'verify_patch',
        `Independent browser: ${results.filter((r) => r.status === 'pass').length} passed, ${results.filter((r) => r.status === 'fail').length} failed, ${results.filter((r) => r.status === 'inconclusive').length} inconclusive. The model does not decide these results.`,
      );
      const objectivePass = snapshot.criteria
        .filter((c) => c.required && c.type !== 'manual')
        .every((c) => results.some((r) => r.criterionId === c.id && r.status === 'pass'));
      if (!objectivePass) continue;
      await mutate(workspaceId, (w) => {
        const a = find(w, agreementId),
          agent = activeTask(a, runId),
          run = a.runs.find((r) => r.id === runId)!;
        run.status = 'completed';
        run.url = `fixture:agent:${artifactId}`;
        run.results = results;
        run.completedAt = new Date().toISOString();
        run.durationMs = Date.now() - started;
        run.artifactId = artifactId;
        run.artifactSha256 = sha256;
        run.summary =
          'The independent browser verified the agent-written artifact. Payment remains subject to buyer consent, standing limits, scope review, and any manual criteria.';
        agent.status = 'completed';
        agent.completedAt = run.completedAt;
        agent.artifactId = artifactId;
        agent.artifactSha256 = sha256;
        agent.steps.push({
          at: run.completedAt,
          tool: 'submit_delivery',
          detail: `Submitted artifact ${sha256.slice(0, 12)} against agreement v${a.version}. Payment authority stays with the buyer’s rules.`,
        });
        event(
          a,
          'Agent delivery independently verified',
          `Artifact ${sha256.slice(0, 12)} · ${results.filter((r) => r.status === 'pass').length} browser checks passed.`,
        );
      });
      await settleAutomaticPayments(workspaceId, agreementId).catch((error) =>
        console.error('Verified delivery saved; payment evaluation deferred:', error.message),
      );
      return;
    }
    throw new Error(
      'Neither model-written patch passed the required browser checks. No passing delivery was submitted.',
    );
  } catch (error) {
    await mutate(workspaceId, (w) => {
      const a = find(w, agreementId),
        agent = a.agentRuns?.find((r) => r.id === runId),
        run = a.runs.find((r) => r.id === runId);
      if (agent) {
        agent.status = 'error';
        agent.error = error instanceof Error ? error.message : 'Agent run failed.';
        agent.completedAt = new Date().toISOString();
        agent.steps.push({ at: agent.completedAt, tool: 'stop', detail: agent.error });
      }
      if (run?.status === 'running' || run?.status === 'queued') {
        run.status = 'error';
        run.error = agent?.error;
      }
      event(
        a,
        'Agent task stopped without automatic payment',
        agent?.error || 'No verified delivery.',
      );
    });
    throw error;
  }
}
