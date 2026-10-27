import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  LockKeyhole,
  MessageSquare,
  Receipt,
  RefreshCw,
  ShieldAlert,
  Undo2,
  X,
} from 'lucide-react';
import type { Agreement, RecoveryCase, Role, Workspace, Result } from '../server/domain';
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const stamp = (s: string) =>
  new Date(s).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const open = (c: RecoveryCase) =>
  ['requested', 'under_review', 'refund_pending', 'partially_refunded'].includes(c.status);
const labels: Record<RecoveryCase['status'], string> = {
  requested: 'Request received',
  under_review: 'Under review',
  refund_pending: 'Refund pending',
  partially_refunded: 'Partial refund · review open',
  refunded: 'Refund confirmed',
  declined: 'Decision explained',
  cancelled: 'Authorization cancelled',
  resolved: 'Resolution accepted',
};
const reasons = {
  unrecognized: 'I don’t recognize this payment',
  wrong_amount: 'The amount is incorrect',
  duplicate: 'I was charged more than once',
  delivery: 'There is a problem with the delivery',
  other: 'Another payment issue',
};
type Act = (label: string, fn: () => Promise<any>) => Promise<void>;
type Action = (suffix: string, body?: unknown) => Promise<any>;
export function RecoveryBanner({
  workspace,
  role,
  busy,
  onCase,
  onResume,
}: {
  workspace: Workspace;
  role: Role;
  busy: string;
  onCase: (id: string) => void;
  onResume: () => void;
}) {
  if (!workspace.recoveryPause) return null;
  const target =
    workspace.agreements.find((a) =>
      a.cases?.some((c) => c.id === workspace.recoveryPause!.caseId),
    ) || workspace.agreements.find((a) => a.cases?.some(open));
  const unresolved = workspace.agreements.some(
    (a) => a.cases?.some(open) || a.payment.refunds?.some((r) => r.status === 'pending'),
  );
  return (
    <div className="recovery-banner" role="status">
      <ShieldAlert size={21} />
      <div>
        <strong>A reported payment problem paused automatic captures.</strong>
        <p>
          {unresolved
            ? 'Review the support case before any new automatic payment. Already dispatched payments cannot be recalled.'
            : 'All cases are closed. Automatic payments stay paused until the buyer explicitly resumes them.'}
        </p>
        <div>
          {target && (
            <button className="text-button" onClick={() => onCase(target.id)}>
              View support case
              <ArrowUpRight size={13} />
            </button>
          )}
          {role === 'buyer' && (
            <button
              className="button secondary small-button"
              disabled={!!busy || unresolved}
              onClick={onResume}
            >
              Clear pause & resume enabled rules
            </button>
          )}
        </div>
        {role === 'buyer' && !unresolved && (
          <p className="recovery-resume-note">
            Resuming may capture qualifying existing authorizations under your enabled standing
            rules. Refunds do not refill the monthly spending budget.
          </p>
        )}
      </div>
    </div>
  );
}
export function ReportProblemModal({
  a,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  a: Agreement;
  busy: string;
  onClose: () => void;
  error?: string;
  onSubmit: (body: any) => void;
}) {
  const completed = (a.payment.refunds || [])
      .filter((r) => r.status === 'completed')
      .reduce((n, r) => n + r.amount, 0),
    remaining = a.amount - completed;
  const [reason, setReason] = useState<RecoveryCase['reason']>('delivery'),
    [description, setDescription] = useState(''),
    [amount, setAmount] = useState(String(remaining / 100));
  const captured = a.payment.status === 'captured';
  return (
    <div className="recovery-report">
      {error && (
        <div className="alert error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      <p className="modal-intro">
        Tell the seller what went wrong. A passing check or earlier payment approval does not
        dismiss your concern. Reporting pauses new automatic captures in this workspace.
      </p>
      <div className="report-payment">
        <Receipt size={19} />
        <div>
          <strong>{a.title}</strong>
          <span>
            {money(a.amount)} USD ·{' '}
            {a.payment.mode === 'demo' ? 'Simulated payment' : 'PayPal sandbox'} ·{' '}
            {a.payment.captureId || a.payment.orderId || 'Authorization'}
          </span>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            reason,
            description,
            requestedAmount: captured ? Math.round(Number(amount) * 100) : remaining,
          });
        }}
      >
        <label className="form-label">
          What went wrong?
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as RecoveryCase['reason'])}
          >
            {Object.entries(reasons).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Describe the problem
          <textarea
            required
            minLength={20}
            maxLength={3000}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Explain the issue and the outcome you’re asking for…"
          />
        </label>
        {captured && (
          <label className="form-label">
            Requested refund (USD)
            <input
              required
              type="number"
              min="0.01"
              max={remaining / 100}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        )}
        <div className="info-box">
          <LockKeyhole size={17} />
          <p>
            The agreement version, payment IDs, standing rules, and delivery evidence are saved with
            your case.{' '}
            {captured
              ? 'This is a refund request, not a promise that funds have already been returned.'
              : 'If payment has not been captured, cancellation uses a void instead of a refund.'}
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={
              !!busy ||
              description.trim().length < 20 ||
              (captured &&
                (!Number.isFinite(Number(amount)) ||
                  Number(amount) <= 0 ||
                  Math.round(Number(amount) * 100) > remaining))
            }
          >
            <ShieldAlert size={14} />
            Submit problem report
          </button>
        </div>
      </form>
    </div>
  );
}
export function RecoveryPanel({
  a,
  role,
  busy,
  act,
  action,
  onReport,
  onEvidence,
}: {
  a: Agreement;
  role: Role;
  busy: string;
  act: Act;
  action: Action;
  onReport: () => void;
  onEvidence: (r: Result) => void;
}) {
  return (
    <>
      <div className="block-title">
        <div>
          <h3>A clear path when something goes wrong.</h3>
          <p>Report, review, and resolve the issue with a traceable record.</p>
        </div>
        <ShieldAlert size={19} />
      </div>
      <div className="recovery-principle">
        <FileCheck2 size={20} />
        <p>
          Verification evidence helps the review. It does not automatically reject your complaint or
          guarantee every aspect of the work.
        </p>
      </div>
      {!a.cases?.length ? (
        <div className="empty-evidence">
          <ShieldAlert size={28} />
          <h3>Support stays part of the payment.</h3>
          <p>No cases have been reported for this payment.</p>
          {role === 'buyer' &&
            ['created', 'authorized', 'capture_pending', 'captured'].includes(a.payment.status) && (
              <button className="button primary" disabled={!!busy} onClick={onReport}>
                Report a problem
              </button>
            )}
        </div>
      ) : (
        <div className="case-list">
          {a.cases.map((c) => (
            <CaseCard
              key={c.id}
              a={a}
              c={c}
              role={role}
              busy={busy}
              act={act}
              action={action}
              onEvidence={onEvidence}
            />
          ))}
        </div>
      )}
      <div className="paypal-escalation">
        <ExternalLink size={17} />
        <div>
          <strong>You can also use PayPal’s separate process.</strong>
          <p>
            This internal support case does not replace reporting a problem to PayPal. Your
            eligibility and available options are determined by PayPal.
          </p>
          <a
            href="https://www.paypal.com/disputes/"
            target="_blank"
            rel="noreferrer"
            className="text-button"
          >
            Open PayPal Resolution Center
            <ArrowUpRight size={13} />
          </a>
          {a.payment.mode === 'demo' && (
            <p className="quiet">
              A simulated receipt has no corresponding PayPal transaction to dispute.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
function CaseCard({
  a,
  c,
  role,
  busy,
  act,
  action,
  onEvidence,
}: {
  a: Agreement;
  c: RecoveryCase;
  role: Role;
  busy: string;
  act: Act;
  action: Action;
  onEvidence: (r: Result) => void;
}) {
  const completed = (a.payment.refunds || [])
      .filter((r) => r.status === 'completed')
      .reduce((n, r) => n + r.amount, 0),
    available = Math.max(0, a.amount - completed),
    pending = a.payment.refunds?.some((r) => r.status === 'pending');
  const refunds = (a.payment.refunds || []).filter((r) => r.caseId === c.id),
    casePaid = refunds.filter((r) => r.status === 'completed').reduce((n, r) => n + r.amount, 0);
  const [body, setBody] = useState(''),
    [response, setResponse] = useState(''),
    [refundAmount, setRefundAmount] = useState(
      String(Math.min(available, Math.max(0, c.requestedAmount - casePaid)) / 100),
    ),
    [note, setNote] = useState('Refund approved after reviewing the reported payment issue.'),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const p = `/cases/${c.id}`;
  return (
    <article className="support-case">
      <div className="case-heading">
        <div>
          <span className="eyebrow">CASE {c.id.slice(0, 8).toUpperCase()}</span>
          <h3>{reasons[c.reason]}</h3>
          <p>Reported {stamp(c.createdAt)}</p>
        </div>
        <span className={'case-status ' + c.status}>{labels[c.status]}</span>
      </div>
      <p className="case-description">{c.description}</p>
      <div className="case-money">
        <div>
          <span>Requested</span>
          <strong>{money(c.requestedAmount)}</strong>
        </div>
        <div>
          <span>Confirmed for this case</span>
          <strong>{money(casePaid)}</strong>
        </div>
        <div>
          <span>Payment balance</span>
          <strong>{money(available)}</strong>
        </div>
      </div>
      <details className="case-snapshot">
        <summary>
          <FileCheck2 size={14} />
          Saved agreement & evidence snapshot
        </summary>
        <div>
          <p>
            <strong>{c.snapshot.title}</strong> · agreement v{c.snapshot.version} ·{' '}
            {money(c.snapshot.amount)} USD
          </p>
          <p>{c.snapshot.brief}</p>
          <p>
            Capture: {c.snapshot.captureId || 'Not confirmed when reported'}
            <br />
            Order: {c.snapshot.orderId || 'Not recorded'}
            <br />
            Rules: v{c.snapshot.paymentRules.version} ·{' '}
            {money(c.snapshot.paymentRules.perPaymentLimit)} per payment /{' '}
            {money(c.snapshot.paymentRules.monthlyLimit)} monthly
          </p>
          {c.snapshot.delivery?.artifactSha256 && <code>{c.snapshot.delivery.artifactSha256}</code>}
          {c.snapshot.delivery?.results.map((r) => {
            const proof = a.runs
              .find((run) => run.id === c.snapshot.delivery?.id)
              ?.results.find((result) => result.criterionId === r.criterionId);
            return (
              <div className="snapshot-result" key={r.criterionId}>
                <strong>
                  {c.snapshot.criteria.find((check) => check.id === r.criterionId)?.title ||
                    r.criterionId}{' '}
                  · {r.status}
                </strong>
                <p>{r.observed}</p>
                {proof?.screenshot && (
                  <button className="text-button" onClick={() => onEvidence(proof)}>
                    View saved proof
                    <ArrowUpRight size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </details>
      <div className="case-messages">
        {c.messages.map((m) => (
          <div className={'case-message ' + m.role} key={m.id}>
            <strong>
              {m.role === 'buyer' ? 'Buyer' : 'Seller'}
              <span>{stamp(m.at)}</span>
            </strong>
            <p>{m.body}</p>
          </div>
        ))}
      </div>
      <form
        className="case-message-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act('Adding case message', async () => {
            await action(p + '/messages', { message: body });
            setBody('');
          });
        }}
      >
        <label className="form-label">
          Add information to this case
          <textarea
            required
            minLength={10}
            maxLength={2000}
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add evidence, questions, or an update…"
          />
        </label>
        <button
          className="button secondary small-button"
          type="submit"
          disabled={!!busy || body.trim().length < 10}
        >
          <MessageSquare size={13} />
          Send case update
        </button>
      </form>
      {a.payment.status === 'capture_pending' && (
        <div className="info-box">
          <Clock3 size={17} />
          <div>
            <p>
              The original payment is not confirmed. A refund cannot start until its capture is
              known.
            </p>
            {a.payment.mode === 'sandbox' && (
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() =>
                  act('Checking original payment', () => action(p + '/reconcile-payment'))
                }
              >
                Reconcile original payment
                <RefreshCw size={12} />
              </button>
            )}
          </div>
        </div>
      )}
      {refunds.map((r) => (
        <div className={'refund-record ' + r.status} key={r.id}>
          <div>
            <Undo2 size={16} />
            <strong>
              {money(r.amount)} ·{' '}
              {r.status === 'completed'
                ? 'Refund confirmed'
                : r.status === 'pending'
                  ? 'Awaiting confirmation'
                  : 'Refund failed'}
            </strong>
          </div>
          <p>
            {r.providerId || 'Provider refund ID not yet confirmed'} ·{' '}
            {a.payment.mode === 'demo' ? 'Simulation' : 'PayPal sandbox'}
          </p>
          {r.error && <p className="inline-error">{r.error}</p>}
          {r.status === 'pending' && (
            <p>
              The amount remains reserved. A pending or uncertain response is not a completed
              refund.
            </p>
          )}
          {role === 'developer' && r.status === 'pending' && (
            <div className="button-row">
              {!r.providerId && (
                <button
                  className="button secondary small-button"
                  disabled={!!busy || !!a.payment.busy}
                  onClick={() =>
                    act('Retrying the same refund request', () =>
                      action(p + `/refunds/${r.id}/retry`),
                    )
                  }
                >
                  Retry same request safely
                  <RefreshCw size={12} />
                </button>
              )}
              {r.providerId && a.payment.mode === 'sandbox' && (
                <button
                  className="button secondary small-button"
                  disabled={!!busy || !!a.payment.busy}
                  onClick={() =>
                    act('Checking refund confirmation', () =>
                      action(p + `/refunds/${r.id}/reconcile`),
                    )
                  }
                >
                  Check PayPal refund status
                  <RefreshCw size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {role === 'developer' && open(c) && (
        <div className="seller-recovery">
          <span className="eyebrow">SELLER REVIEW</span>
          <label className="form-label">
            Explain your review or decision
            <textarea
              minLength={20}
              maxLength={2000}
              rows={3}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Explain what you reviewed and the proposed resolution. Earlier authorization alone does not settle the complaint."
            />
          </label>
          <div className="button-row">
            <button
              className="button secondary small-button"
              disabled={
                !!busy ||
                pending ||
                a.payment.status === 'capture_pending' ||
                response.trim().length < 20
              }
              onClick={() =>
                act('Recording seller review', () =>
                  action(p + '/review', { decision: 'review', message: response }),
                )
              }
            >
              Record review
            </button>
            <button
              className="text-button"
              disabled={
                !!busy ||
                pending ||
                a.payment.status === 'capture_pending' ||
                response.trim().length < 20
              }
              onClick={() =>
                act('Recording the explained decision', () =>
                  action(p + '/review', { decision: 'decline', message: response }),
                )
              }
            >
              Decline request with explanation
            </button>
          </div>
          {a.payment.status === 'captured' && available > 0 && (
            <form
              className="refund-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act('Requesting refund', async () => {
                  const nextId =
                    a.payment.refunds?.find((r) => r.id === requestId)?.status === 'failed'
                      ? crypto.randomUUID()
                      : requestId;
                  setRequestId(nextId);
                  await action(p + '/refunds', {
                    requestId: nextId,
                    amount: Math.round(Number(refundAmount) * 100),
                    note,
                  });
                  setRequestId(crypto.randomUUID());
                });
              }}
            >
              <div className="refund-form-title">
                <Undo2 size={18} />
                <strong>Return funds to the original payment</strong>
              </div>
              <label className="form-label">
                Refund amount (USD)
                <input
                  required
                  type="number"
                  min="0.01"
                  max={available / 100}
                  step="0.01"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="text-button"
                disabled={pending || !!busy}
                onClick={() => setRefundAmount(String(available / 100))}
              >
                Use full remaining balance · {money(available)}
              </button>
              <label className="form-label">
                Refund note to the buyer
                <textarea
                  required
                  minLength={10}
                  maxLength={255}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </label>
              <p className="quiet">
                The original capture remains in the receipt history. Refunds do not replenish the
                monthly auto-pay budget. This action{' '}
                {a.payment.mode === 'demo'
                  ? 'simulates a refund'
                  : 'requests a PayPal sandbox refund'}
                ; processed refunds cannot be cancelled.
              </p>
              <button
                type="submit"
                className="button primary"
                disabled={
                  !!busy ||
                  !!a.payment.busy ||
                  pending ||
                  !Number.isFinite(Number(refundAmount)) ||
                  Number(refundAmount) <= 0 ||
                  Math.round(Number(refundAmount) * 100) > available ||
                  note.trim().length < 10
                }
              >
                <Undo2 size={14} />
                {a.payment.mode === 'demo' ? 'Simulate refund' : 'Issue sandbox refund'} ·{' '}
                {money(Math.max(0, Math.round(Number(refundAmount) * 100) || 0))}
              </button>
            </form>
          )}
        </div>
      )}
      {role === 'buyer' && open(c) && ['created', 'authorized'].includes(a.payment.status) && (
        <div className="case-buyer-actions">
          <p>
            This payment has not been captured. Cancel the agreement and void any authorization
            instead of requesting a refund.
          </p>
          <button
            className="button secondary"
            disabled={!!busy || !!a.payment.busy}
            onClick={() =>
              act('Cancelling the uncaptured agreement', () => action('/payments/cancel'))
            }
          >
            Cancel & void authorization
          </button>
        </div>
      )}
      {role === 'buyer' && open(c) && casePaid > 0 && !pending && (
        <div className="case-buyer-actions">
          <p>
            If the confirmed partial refund resolves your concern, you can accept the settlement.
            Otherwise, keep the review open.
          </p>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() =>
              act('Accepting case resolution', () =>
                action(p + '/buyer-decision', {
                  decision: 'accept',
                  message:
                    'I accept the confirmed partial refund as resolution of this support case.',
                }),
              )
            }
          >
            Accept confirmed refund as resolution
          </button>
        </div>
      )}
      {role === 'buyer' && ['declined', 'resolved'].includes(c.status) && available > 0 && (
        <div className="case-buyer-actions">
          <p>
            You can add information and ask for another review. PayPal’s separate process remains
            available.
          </p>
          <button
            className="button secondary"
            disabled={!!busy || pending}
            onClick={() =>
              act('Requesting another review', () =>
                action(p + '/buyer-decision', {
                  decision: 'reopen',
                  message:
                    'I am requesting another review because the reported payment concern is not resolved.',
                }),
              )
            }
          >
            Request another review
          </button>
        </div>
      )}
      {['refunded', 'cancelled', 'resolved'].includes(c.status) && (
        <div className="case-resolution">
          <CheckCircle2 size={17} />
          <span>
            {c.status === 'cancelled'
              ? 'The uncaptured authorization was cancelled. No captured funds were refunded.'
              : c.status === 'refunded'
                ? 'The requested refund has been confirmed.'
                : 'The buyer accepted the resolution.'}{' '}
            Automatic payments remain paused until the buyer explicitly resumes them.
          </span>
        </div>
      )}
    </article>
  );
}
