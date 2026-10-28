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
  const correctedRun = a.runs.find((r) => r.url === 'fixture:fixed');
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
  return { step, failedRun, correctedRun, currentRun, running, passed };
}
