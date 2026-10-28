import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  X,
  Play,
  ShieldCheck,
  Loader2,
  AlertCircle,
  ArrowUpRight,
  FileDiff,
  Receipt,
  ChevronRight,
  RotateCcw,
  Monitor,
  LockKeyhole,
} from 'lucide-react';
import type { Agreement, Result, Workspace } from '../server/domain';
import { walkthroughState, walkthroughSteps } from './walkthroughState';
type Props = {
  workspace: Workspace;
  obscured?: boolean;
  busy: string;
  error: string;
  act: (label: string, fn: () => Promise<any>) => Promise<void>;
  call: (path: string, body?: unknown, method?: string) => Promise<any>;
  onClose: () => void;
  onExplore: (
    id: string,
    tab: 'Evidence' | 'Terms review' | 'Resolution' | 'Agent work' | 'Agreement',
  ) => void;
  onRestart: () => void;
  onEvidence: (r: Result) => void;
  onReport: () => void;
  onAgent: () => void;
  ai: boolean;
};
export function WalkthroughInvite({
  resume,
  busy,
  onStart,
  onResume,
}: {
  resume: boolean;
  busy: string;
  onStart: () => void;
  onResume: () => void;
}) {
  return (
    <section className="walkthrough-invite">
      <span className="walkthrough-invite-icon">
        <Play size={22} />
      </span>
      <div>
        <span className="walkthrough-kicker">THE INTERACTIVE STORY</span>
        <h2>
          {resume ? 'Pick up where you left off.' : 'See why proof should come before payment.'}
        </h2>
        <p>
          A café form looks finished. It doesn’t work. Follow the failure, correction, and payment
          in one guided flow.
        </p>
        <span className="walkthrough-invite-note">
          Real browser checks · Authored fixtures · Simulated payments
        </span>
      </div>
      <button className="button primary" disabled={!!busy} onClick={resume ? onResume : onStart}>
        {resume ? 'Continue demo' : 'Start interactive demo'}
        <ArrowRight size={16} />
      </button>
    </section>
  );
}
export function GuidedWalkthrough({
  workspace,
  obscured,
  busy,
  error,
  act,
  call,
  onClose,
  onExplore,
  onRestart,
  onEvidence,
  onReport,
  onAgent,
  ai,
}: Props) {
  const candidate = workspace.agreements.find((a) => a.id === workspace.walkthrough?.agreementId);
  const [consent, setConsent] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const close = useRef<HTMLButtonElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef<Element | null>(null);
  useEffect(() => {
    restoreFocus.current = document.activeElement;
    close.current?.focus();
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
      if (
        document.activeElement === document.body ||
        document.activeElement?.closest('.walkthrough-overlay')
      )
        (restoreFocus.current as HTMLElement | null)?.focus?.();
    };
  }, []);
  const info = candidate
    ? walkthroughState(
        candidate,
        Boolean(workspace.paymentRules?.enabled),
        Boolean(workspace.walkthrough?.failureReviewedAt),
      )
    : undefined;
  useEffect(() => {
    if (!info?.running || !info.currentRun) {
      setElapsed(0);
      return;
    }
    const created = Date.parse(info.currentRun.createdAt);
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - created) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [info?.running, info?.currentRun?.id]);
  useEffect(() => {
    shell.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [info?.step]);
  useEffect(() => {
    if (!obscured) {
      const frame = requestAnimationFrame(() => {
        if (document.activeElement === document.body)
          heading.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [obscured]);
  if (!candidate || !info) return null;
  const a = candidate;
  const { step, failedRun, correctedRun, currentRun, running, passed } = info;
  const bookingFailure =
    failedRun?.results.find((r) => r.criterionId === 'booking') ||
    failedRun?.results.find((r) => r.status === 'fail');

  const switchRole = (role: 'buyer' | 'developer') => call('/demo/role', { role });
  const action = (suffix: string, body: unknown = {}) => call('/agreements/' + a.id + suffix, body);
  async function approve() {
    await switchRole('developer');
    await action('/approve');
    await switchRole('buyer');
    await action('/approve');
  }
  async function authorize() {
    await switchRole('buyer');
    if (a.payment.status !== 'authorized') {
      await action('/payments/order');
      await action('/payments/authorize');
    }
    await call(
      '/payment-rules',
      { enabled: true, perPaymentLimit: 7500, monthlyLimit: 15000, confirmAutomaticCapture: true },
      'PUT',
    );
  }
  async function check(which: 'broken' | 'fixed') {
    await switchRole('developer');
    await action('/verify', { url: 'fixture:' + which });
  }
  async function termsChapter() {
    await switchRole('developer');
    const target = await call('/demo/walkthrough/terms', {});
    await switchRole('buyer');
    onExplore(target.id, 'Terms review');
  }

  const mainRun = step === 2 ? currentRun : correctedRun;
  const closed = ['cancelled', 'superseded'].includes(a.status);
  const waiting = Boolean(running || busy || closed);
  const refunded = (a.payment.refunds || [])
    .filter((r) => r.status === 'completed')
    .reduce((total, r) => total + r.amount, 0);
  const titles = [
    'A clear finish line, before anyone starts.',
    'Set the payment boundary once.',
    'Looks finished. The booking form isn’t.',
    'A correction must earn a fresh pass.',
    'Proof checked. Payment confirmed.',
  ];
  const captions = [
    'A $75 booking-form repair. Five agreed checks. In this private demo, you play both sides; we handle the role changes.',
    'The buyer authorizes $75 and chooses when automatic capture is allowed. These controls use virtual demo funds.',
    'Run the exact agreed checks in Chromium. A polished preview cannot substitute for a working reservation.',
    'Submit the authored corrected delivery. The browser runs the same checks again; passing evidence can trigger the approved demo payment.',
    a.payment.captureMethod === 'automatic'
      ? 'The receipt is tied to this agreement, this delivery, and the buyer’s limits. No additional payment click was needed.'
      : 'The receipt is tied to this agreement and verified delivery, with the recorded buyer-approved capture.',
  ];
  return (
    <div
      ref={shell}
      className="walkthrough-overlay"
      inert={obscured}
      aria-hidden={obscured || undefined}
      role="dialog"
      aria-modal={obscured ? undefined : true}
      aria-labelledby="walkthrough-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Tab') {
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]',
            ),
          ).filter((el) => el.getClientRects().length > 0);
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="walkthrough-topbar">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onClose();
          }}
        >
          <ShieldCheck size={24} />
          <strong>ProofPay</strong>
          <span>Interactive walkthrough</span>
        </a>
        <button ref={close} onClick={onClose} aria-label="Close walkthrough and explore workspace">
          <X size={20} />
        </button>
      </header>
      <div className="walkthrough-shell">
        <div className="walkthrough-disclosure">
          <span className="walkthrough-live-dot" />
          Actual browser verification <span>·</span> Authored demo deliveries <span>·</span>{' '}
          Simulated payments
        </div>
        <ol className="walkthrough-progress" aria-label="Demo progress">
          {walkthroughSteps.map((label, i) => (
            <li
              key={label}
              className={i === step ? 'current' : i < step ? 'complete' : ''}
              aria-current={i === step ? 'step' : undefined}
            >
              <span>{i < step ? <Check size={14} /> : i + 1}</span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>
        <div className="walkthrough-heading">
          <span className="walkthrough-kicker">
            {step === 4 ? 'THE RESULT' : `CHAPTER ${step + 1} OF 5`}
          </span>
          <h1 ref={heading} tabIndex={-1} id="walkthrough-title">
            {titles[step]}
          </h1>
          <p>{captions[step]}</p>
        </div>
        {closed && (
          <div className="walkthrough-error" role="status">
            <AlertCircle size={18} />
            <p>
              This example was closed in the workspace. Start a fresh private demo to replay the
              complete story.
            </p>
          </div>
        )}
        {error && (
          <div className="walkthrough-error" role="alert">
            <AlertCircle size={18} />
            <div>
              <strong>This step needs attention.</strong>
              <p>{error}</p>
              <span>Your progress is preserved. Retry when ready, or explore the workspace.</span>
            </div>
          </div>
        )}
        <div className="walkthrough-layout">
          <section className="walkthrough-scene" aria-label="Current chapter evidence">
            {step === 0 && (
              <>
                <div className="walkthrough-scene-header">
                  <div>
                    <span className="walkthrough-kicker">SUNDAY CAFÉ · BOOKING REPAIR</span>
                    <h2>The agreement</h2>
                  </div>
                  <strong className="walkthrough-price">
                    $75<span>fixed price</span>
                  </strong>
                </div>
                <div className="walkthrough-checks">
                  {a.criteria.map((c, index) => (
                    <div key={c.id}>
                      <span className="walkthrough-check-number">{index + 1}</span>
                      <div>
                        <strong>{c.title}</strong>
                        <p>
                          {c.type === 'mobile'
                            ? `Fits a ${c.expected}px mobile screen.`
                            : c.type === 'required'
                              ? 'Name and email must be provided.'
                              : c.type === 'link' && c.expected === '#menu'
                                ? 'The menu link opens the menu section.'
                                : c.expected}
                        </p>
                      </div>
                      <span className="walkthrough-tag">Required</span>
                    </div>
                  ))}
                </div>
                <div className="walkthrough-signatures">
                  <span className={a.approvals.developer ? 'signed' : ''}>
                    <CheckCircle2 size={16} />
                    Business {a.approvals.developer ? 'approved' : 'awaiting approval'}
                  </span>
                  <span className={a.approvals.buyer ? 'signed' : ''}>
                    <CheckCircle2 size={16} />
                    Buyer {a.approvals.buyer ? 'approved' : 'awaiting approval'}
                  </span>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <div className="walkthrough-scene-header">
                  <div>
                    <span className="walkthrough-kicker">BUYER-CONTROLLED RULES</span>
                    <h2>Your approved payment limits.</h2>
                  </div>
                  <LockKeyhole size={24} />
                </div>
                <div className="walkthrough-money-boundary">
                  <div>
                    <span>This job</span>
                    <strong>$75.00</strong>
                    <small>Maximum per payment</small>
                  </div>
                  <div>
                    <span>Monthly budget</span>
                    <strong>$150.00</strong>
                    <small>UTC calendar month</small>
                  </div>
                </div>
                <ul className="walkthrough-rule-list">
                  <li>
                    <CheckCircle2 size={17} />
                    Only this approved agreement amount
                  </li>
                  <li>
                    <CheckCircle2 size={17} />
                    All five required browser checks must pass
                  </li>
                  <li>
                    <CheckCircle2 size={17} />
                    No unresolved scope or agreement changes
                  </li>
                  <li>
                    <CheckCircle2 size={17} />
                    No new charge without an authorization
                  </li>
                </ul>
                <label className="walkthrough-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    disabled={!!busy}
                  />
                  Enable automatic capture for this demo: up to $75 per job and $150 this UTC month,
                  only after the required checks pass.
                </label>
              </>
            )}
            {(step === 2 || step === 3) && (
              <>
                <div className="walkthrough-browser-bar">
                  <span />
                  <span />
                  <span />
                  <small>sunday-cafe.example / booking</small>
                  <Monitor size={14} />
                </div>
                {mainRun?.results?.length ? (
                  <div className="walkthrough-result-view">
                    <div
                      className={
                        'walkthrough-verdict ' +
                        (step === 2 ? 'failure' : passed ? 'success' : 'pending')
                      }
                    >
                      <span>
                        {step === 2 ? (
                          <AlertCircle size={20} />
                        ) : passed ? (
                          <CheckCircle2 size={20} />
                        ) : (
                          <ShieldCheck size={20} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {step === 2
                            ? 'The booking check failed'
                            : passed
                              ? 'All five checks passed'
                              : 'The corrected delivery needs proof'}
                        </strong>
                        <p>
                          {step === 2
                            ? 'Payment stays blocked. The required reservation never succeeded.'
                            : passed
                              ? 'Same requirements. Fresh evidence. Payment follows the buyer’s approved rules.'
                              : 'A failure or inconclusive result still prevents payment.'}
                        </p>
                      </div>
                    </div>
                    <div className="walkthrough-result-list">
                      {a.criteria.map((c) => {
                        const result = mainRun.results.find((r) => r.criterionId === c.id);
                        return (
                          <div key={c.id}>
                            <span
                              className={'walkthrough-result-icon ' + (result?.status || 'pending')}
                            >
                              {result?.status === 'pass' ? (
                                <Check size={14} />
                              ) : result?.status === 'fail' ? (
                                <X size={14} />
                              ) : (
                                <Loader2 size={14} />
                              )}
                            </span>
                            <div>
                              <strong>{c.title}</strong>
                              <p>{result?.observed || 'No recorded finding yet.'}</p>
                            </div>
                            {result?.screenshot && (
                              <button
                                onClick={() => onEvidence(result)}
                                aria-label={'Open evidence for ' + c.title}
                              >
                                Evidence
                                <ArrowUpRight size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <iframe
                    key={step}
                    title={
                      step === 2
                        ? 'Authored café page with a broken booking form'
                        : 'Authored corrected café delivery awaiting independent verification'
                    }
                    src={'/fixtures/' + (step === 2 ? 'broken' : 'fixed')}
                    sandbox="allow-scripts allow-forms"
                  />
                )}
                {running && (
                  <div className="walkthrough-verifying" role="status">
                    <Loader2 className="spin" size={21} />
                    <div>
                      <strong>Chromium is checking the agreed work</strong>
                      <span>
                        {elapsed}s elapsed, including queue time. Findings appear when the run
                        completes.
                      </span>
                    </div>
                  </div>
                )}
                {mainRun?.status === 'error' && (
                  <div className="walkthrough-error" role="alert">
                    <AlertCircle size={18} />
                    <p>
                      {mainRun.error ||
                        'The verifier could not complete. No pass or payment was inferred.'}
                    </p>
                  </div>
                )}
              </>
            )}
            {step === 4 && (
              <>
                <div className="walkthrough-receipt-top">
                  <span>
                    <CheckCircle2 size={30} />
                  </span>
                  <div>
                    <span className="walkthrough-kicker">SIMULATED PAYMENT CONFIRMED</span>
                    <h2>$75.00</h2>
                    <p>Sunday Café → Business operating the delivery</p>
                  </div>
                </div>
                <dl className="walkthrough-receipt-lines">
                  <div>
                    <dt>Required checks</dt>
                    <dd>{a.criteria.filter((c) => c.required).length} verified passes</dd>
                  </div>
                  <div>
                    <dt>Capture method</dt>
                    <dd>
                      {a.payment.captureMethod === 'automatic'
                        ? 'Buyer-approved standing rules'
                        : 'Buyer-approved capture'}
                    </dd>
                  </div>
                  {refunded > 0 && (
                    <div>
                      <dt>Confirmed demo refunds</dt>
                      <dd>
                        {new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                        }).format(refunded / 100)}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Agreement</dt>
                    <dd>Version {a.version}</dd>
                  </div>
                  <div>
                    <dt>Transaction</dt>
                    <dd>{a.payment.captureId}</dd>
                  </div>
                  <div>
                    <dt>Recorded at</dt>
                    <dd>
                      {a.payment.capturedAt
                        ? new Date(a.payment.capturedAt).toLocaleString()
                        : 'See activity record'}
                    </dd>
                  </div>
                </dl>
                <div className="walkthrough-receipt-note">
                  <Receipt size={18} />
                  <p>
                    This is a simulated receipt. The authorization, browser findings, rules, and
                    capture are recorded in your private demo workspace.
                  </p>
                </div>
              </>
            )}
          </section>
          <aside className="walkthrough-director">
            <div className="walkthrough-role-label">
              {step === 0
                ? 'YOU PLAY BOTH DEMO ROLES'
                : step === 1
                  ? 'BUYER DECIDES'
                  : step === 2 || step === 3
                    ? 'INDEPENDENT VERIFICATION'
                    : 'THE COMPLETE RECORD'}
            </div>
            <h2>
              {
                [
                  'Agree on observable work.',
                  'Give payment a clear limit.',
                  'Test what the preview cannot prove.',
                  'Fresh evidence for the correction.',
                  'The work earned its payment.',
                ][step]
              }
            </h2>
            <p>
              {
                [
                  'These checks belong to the agreement. A delivery cannot change the finish line.',
                  'Approve the job amount and consent to bounded automatic capture. No real money moves in this walkthrough.',
                  'The page looks ready, but its submit handler is broken. Run the agreed tests to see the failure.',
                  'The authored corrected fixture repairs the submit handler. It must pass a new run before payment can follow.',
                  'Verification and the buyer’s rules, rather than a model claiming success, determine payment eligibility.',
                ][step]
              }
            </p>
            {step === 0 && (
              <button
                className="walkthrough-primary"
                disabled={waiting}
                onClick={() => act('Recording both demo approvals', approve)}
              >
                {busy ? <Loader2 className="spin" size={16} /> : null}Approve both demo roles
                <ArrowRight size={16} />
              </button>
            )}
            {step === 1 && (
              <button
                className="walkthrough-primary"
                disabled={waiting || !consent}
                onClick={() => act('Authorizing demo payment and rules', authorize)}
              >
                {busy ? <Loader2 className="spin" size={16} /> : null}
                {a.payment.status === 'authorized'
                  ? 'Save demo payment rules'
                  : 'Authorize $75 demo payment'}
                <ArrowRight size={16} />
              </button>
            )}
            {step === 2 && (
              <button
                className="walkthrough-primary"
                disabled={waiting}
                onClick={() =>
                  failedRun
                    ? act('Continuing after the failed check', () =>
                        call('/demo/walkthrough/continue', {}),
                      )
                    : act('Starting independent browser checks', () => check('broken'))
                }
              >
                {waiting ? <Loader2 className="spin" size={16} /> : <Play size={16} />}{' '}
                {waiting
                  ? 'Browser check running…'
                  : failedRun
                    ? 'See the corrected delivery'
                    : 'Check the first delivery'}
              </button>
            )}
            {step === 3 && (
              <button
                className="walkthrough-primary"
                disabled={waiting || passed || a.payment.status === 'capture_pending'}
                onClick={() => act('Verifying the corrected delivery', () => check('fixed'))}
              >
                {waiting ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}{' '}
                {waiting
                  ? 'Verifying the correction…'
                  : passed
                    ? 'Waiting for payment confirmation…'
                    : 'Verify the corrected delivery'}
              </button>
            )}
            {step === 3 && bookingFailure && (
              <div className="walkthrough-lesson">
                <span>WHAT BLOCKED PAYMENT</span>
                <strong>{bookingFailure.observed}</strong>
                {bookingFailure.screenshot && (
                  <button onClick={() => onEvidence(bookingFailure)}>
                    Inspect the failed booking evidence
                    <ArrowUpRight size={13} />
                  </button>
                )}
              </div>
            )}
            {step === 4 && (
              <>
                <button className="walkthrough-primary" onClick={() => onExplore(a.id, 'Evidence')}>
                  Explore evidence & receipt
                  <ArrowUpRight size={16} />
                </button>
                <div className="walkthrough-next-chapters">
                  <span className="walkthrough-kicker">NEXT CHAPTERS · OPTIONAL</span>
                  <button
                    disabled={!!busy}
                    onClick={() => act('Preparing the agreement-change chapter', termsChapter)}
                  >
                    <FileDiff size={20} />
                    <div>
                      <strong>A $2 increase. What else changed?</strong>
                      <span>Review a new job’s price and data-sharing clause.</span>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      act('Opening buyer support', async () => {
                        await switchRole('buyer');
                        onReport();
                      })
                    }
                  >
                    <ShieldCheck size={20} />
                    <div>
                      <strong>What if the buyer has a problem?</strong>
                      <span>Open a case and pause automatic payments.</span>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                  {ai && (
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        act('Opening model-backed agent setup', async () => {
                          await switchRole('buyer');
                          onAgent();
                        })
                      }
                    >
                      <Play size={20} />
                      <div>
                        <strong>Run an actual repair agent</strong>
                        <span>Commission a separate model-backed task in the workspace.</span>
                      </div>
                      <ChevronRight size={17} />
                    </button>
                  )}
                </div>
              </>
            )}
            <div className="walkthrough-context">
              <strong>
                {step === 4 ? 'What happened' : step === 1 ? 'Why this matters' : 'What to notice'}
              </strong>
              <p>
                {step === 0
                  ? 'Five objective requirements make success testable. Subjective projects can still require human review.'
                  : step === 1
                    ? 'Consent is specific. Spending limits do not authorize new terms, arbitrary charges, or subscriptions.'
                    : step === 2
                      ? 'A real browser performs a test reservation. Missing evidence never becomes a pass.'
                      : step === 3
                        ? 'The original failure stays in history. The corrected result is assessed against the same checks.'
                        : failedRun
                          ? 'The first delivery failed. The correction passed. The standing rule captured a simulated payment.'
                          : 'A verified delivery met the buyer’s payment rules. See the stored findings for the actual run history.'}
              </p>
            </div>
            <button
              className="walkthrough-text-button"
              onClick={() => onExplore(a.id, step < 2 ? 'Agreement' : 'Evidence')}
            >
              Open this step in the workspace
              <ArrowUpRight size={13} />
            </button>
            <button className="walkthrough-text-button" disabled={!!busy} onClick={onRestart}>
              <RotateCcw size={13} />
              {step === 4 ? 'Start a fresh private demo' : 'Restart in a fresh private demo'}
            </button>
          </aside>
        </div>
        <footer className="walkthrough-footer">
          <span>
            <ShieldCheck size={14} />
            Your example is private to this demo session.
          </span>
          <button onClick={onClose}>
            Leave the guide and explore
            <ArrowUpRight size={13} />
          </button>
        </footer>
      </div>
    </div>
  );
}
