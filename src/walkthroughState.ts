import type { Agreement } from '../server/domain';
export const walkthroughSteps = [
  'Agree',
  'Authorize',
  'Find the failure',
  'Verify the fix',
  'Receipt',
];
export function walkthroughState(a: Agreement, rulesEnabled: boolean, failureReviewed = false) {
  const failedRun = a.runs.find(
    (r) =>
      r.url === 'fixture:broken' &&
      r.status === 'completed' &&
      r.results.some((result) => result.status === 'fail'),
  );
  // A correction is the authored fixture or an artifact the repair agent submitted.
  const correctedRun = a.runs.find(
    (r) => r.url === 'fixture:fixed' || r.url.startsWith('fixture:agent:'),
  );
  const agent = a.agentRuns?.[0];
  const currentRun = a.runs[0];
  const running = currentRun && ['queued', 'running'].includes(currentRun.status);
  const required = a.criteria.filter((c) => c.required);
  const passed = Boolean(
    correctedRun?.status === 'completed' &&
    required.length > 0 &&
    required.every((c) =>
      correctedRun.results.some((r) => r.criterionId === c.id && r.status === 'pass'),
    ),
  );
  const step =
    a.payment.status === 'captured'
      ? 4
      : !a.approvals.buyer || !a.approvals.developer
        ? 0
        : (a.payment.status !== 'authorized' && a.payment.status !== 'capture_pending') ||
            !rulesEnabled
          ? 1
          : correctedRun || (failedRun && failureReviewed)
            ? 3
            : 2;
  return { step, failedRun, correctedRun, currentRun, running, passed, agent };
}
// Names the delivery that actually exists, not the path the visitor tried first.
export function deliverySource(a: Agreement) {
  const delivery = a.runs.find(
    (r) => r.url === 'fixture:fixed' || r.url.startsWith('fixture:agent:'),
  );
  if (delivery?.artifactId) return 'model-written repair';
  if (delivery) return 'authored correction';
  return a.agentTask ? 'repair agent' : 'authored deliveries';
}
