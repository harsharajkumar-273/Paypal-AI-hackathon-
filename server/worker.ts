import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { query, getWorkspace, mutate, initDb } from './db.js';
import { find, settleAutomaticPayments } from './service.js';
import { event } from './domain.js';
import { verify } from './verifier.js';
import { summarize } from './ai.js';
import { runRepairAgent } from './agent.js';
let active = false;
let lastAutoSweep = 0;
export async function tick() {
  if (active) return;
  active = true;
  try {
    const stale = await query(
      `UPDATE jobs SET state='error' WHERE state='running' AND started_at < now()-interval '3 minutes' RETURNING *`,
    );
    for (const job of stale.rows)
      await mutate(job.workspace_id, (w) => {
        const a = find(w, job.agreement_id),
          r = a.runs.find((r) => r.id === job.run_id);
        if (r?.status === 'running') {
          r.status = 'error';
          r.error = 'Browser worker timed out or restarted. Submit a new verification run.';
          if (job.kind === 'agent') {
            const agent = a.agentRuns?.find((r) => r.id === job.run_id);
            if (agent) {
              agent.status = 'error';
              agent.error = r.error;
              agent.completedAt = new Date().toISOString();
            }
          }
          event(a, 'Verification interrupted', r.error);
        }
      });
    const { rows } = await query(
      `UPDATE jobs SET state='running',started_at=now() WHERE id=(SELECT id FROM jobs WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) AND state='queued' RETURNING *`,
    );
    if (!rows[0]) {
      if (Date.now() - lastAutoSweep > 15000) {
        lastAutoSweep = Date.now();
        const due = await query<{ id: string }>(
          "SELECT id FROM workspaces WHERE body->'paymentRules'->>'enabled'='true'",
        );
        for (const w of due.rows) await settleAutomaticPayments(w.id);
      }
      return;
    }
    const job = rows[0],
      start = performance.now();
    try {
      if (job.kind === 'agent') {
        await runRepairAgent(job.workspace_id, job.agreement_id, job.run_id);
        await query("UPDATE jobs SET state='completed' WHERE id=$1", [job.id]);
        return;
      }
      const w = await getWorkspace(job.workspace_id),
        a = find(w, job.agreement_id),
        run = a.runs.find((r) => r.id === job.run_id)!;
      await mutate(w.id, (w) => {
        const r = find(w, a.id).runs.find((r) => r.id === run.id)!;
        r.status = 'running';
      });
      const fixture = run.url.startsWith('fixture:');
      const fixtureOrigin =
        process.env.FIXTURE_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3001}`;
      const url = fixture
        ? `${fixtureOrigin}/fixtures/${run.url === 'fixture:fixed' ? 'fixed' : 'broken'}`
        : run.url;
      const results = await verify(url, a.criteria, {
        fixture,
        fixtureOrigin,
        origins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
        formEndpoints: (process.env.ALLOWED_FORM_ENDPOINTS || '').split(',').filter(Boolean),
      });
      let summary;
      try {
        summary = await summarize(results, a.criteria);
      } catch {
        summary =
          'AI summary unavailable. The browser evidence below remains valid; review each result.';
      }
      await mutate(w.id, (w) => {
        const current = find(w, a.id),
          r = current.runs.find((r) => r.id === run.id)!;
        if (r.status !== 'running') return;
        r.status = 'completed';
        r.results = results;
        r.completedAt = new Date().toISOString();
        r.durationMs = Math.round(performance.now() - start);
        r.summary = summary;
        event(
          current,
          'Delivery verification completed',
          `${results.filter((r) => r.status === 'pass').length} automated checks passed · evidence saved`,
        );
      });
      await query("UPDATE jobs SET state='completed' WHERE id=$1", [job.id]);
      await settleAutomaticPayments(w.id, a.id).catch((err) =>
        console.error('Auto-pay evaluation deferred:', err.message),
      );
    } catch (err) {
      await mutate(job.workspace_id, (w) => {
        const a = find(w, job.agreement_id),
          r = a.runs.find((r) => r.id === job.run_id)!;
        r.status = 'error';
        r.error = err instanceof Error ? err.message : 'Verification failed.';
        event(a, 'Verification could not complete', r.error);
      });
      await query("UPDATE jobs SET state='error' WHERE id=$1", [job.id]);
    }
  } finally {
    active = false;
  }
}
export function startWorker() {
  const interval = setInterval(
    () => void tick().catch((err) => console.error('Worker error:', err.message)),
    1500,
  );
  void tick();
  return interval;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await initDb();
  console.log('ProofPay verification worker ready.');
  startWorker();
}
