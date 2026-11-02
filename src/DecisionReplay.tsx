import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Play,
  ShieldCheck,
  FlaskConical,
  CheckCircle2,
} from 'lucide-react';
import type { Agreement, Result } from '../server/domain';
import type { DecisionRecord } from '../server/decisions';
import type { AutoDecision } from '../server/automation';

type Replay = {
  source: string;
  record: DecisionRecord | null;
  events: Agreement['events'];
  agentSteps: { at: string; tool: string; detail: string; runId: string }[];
};
type Simulation = {
  source: string;
  at: string;
  original: AutoDecision;
  result: AutoDecision;
  note: string;
};
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const stages = [
  'Agreed task',
  'Delivery attempts',
  'Browser evidence',
  'Payment policy',
  'Receipt & recovery',
];
export function DecisionReplay({
  a,
  call,
  onEvidence,
}: {
  a: Agreement;
  call: (path: string, body?: unknown) => Promise<any>;
  onEvidence: (result: Result) => void;
}) {
  const [data, setData] = useState<Replay | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [limit, setLimit] = useState('');
  const [failed, setFailed] = useState('');
  const [terms, setTerms] = useState(false);
  const [complaint, setComplaint] = useState(false);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    setSimulation(null);
    void call(`/agreements/${a.id}/decision-replay`)
      .then((value) => {
        if (live) setData(value);
      })
      .catch((error) => {
        if (live) setError(error.message);
      });
    return () => {
      live = false;
    };
  }, [
    a.id,
    a.version,
    a.payment.status,
    a.payment.captureId,
    a.runs[0]?.id,
    a.runs[0]?.status,
    loadRevision,
  ]);
  useEffect(() => {
    setSimulation(null);
  }, [limit, failed, terms, complaint]);
  const record = data?.record;
  const agreement = record?.agreement || a;
  const run = agreement.runs.find((r) => r.version === agreement.version);
  const automatic = record?.automatic;
  async function simulate() {
    setPending(true);
    setError('');
    setSimulation(null);
    try {
      const dollars = limit.trim() ? Number(limit) : undefined;
      if (
        dollars !== undefined &&
        (!Number.isFinite(dollars) ||
          dollars < 0 ||
          Math.abs(dollars * 100 - Math.round(dollars * 100)) > 0.000001)
      )
        throw new Error('Enter a nonnegative limit with at most two decimal places.');
      setSimulation(
        await call(`/agreements/${a.id}/decision-simulation`, {
          perPaymentLimit: dollars === undefined ? undefined : Math.round(dollars * 100),
          failedCriterion: failed || undefined,
          unapprovedTerms: terms,
          buyerComplaint: complaint,
        }),
      );
    } catch (error: any) {
      setError(error.message);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="decision-replay" aria-label="Payment decision replay">
      <div className="block-title">
        <div>
          <h3>Every payment has a reason.</h3>
          <p>Follow the work, inspect the proof, and explore what would change the decision.</p>
        </div>
        <a className="button secondary" href={`/api/agreements/${a.id}/proof-bundle`} download>
          <Download size={16} /> Download proof bundle
        </a>
      </div>
      {error && (
        <p role="alert" className="replay-error">
          {error}
        </p>
      )}
      {!data ? (
        error ? (
          <button className="button secondary" onClick={() => setLoadRevision((n) => n + 1)}>
            Retry loading the decision
          </button>
        ) : (
          <p role="status">Loading the recorded decision…</p>
        )
      ) : (
        <>
          <div className="replay-provenance">
            <ShieldCheck size={21} />
            <div>
              <strong>
                {data.source === 'recorded-capture-inputs'
                  ? 'Recorded at the capture decision'
                  : data.source === 'current-inputs'
                    ? 'Current inputs · payment has not been captured'
                    : 'Historical decision inputs unavailable'}
              </strong>
              <p>
                {record
                  ? `${new Date(record.at).toLocaleString()} · Agreement v${agreement.version} · ${a.payment.mode === 'demo' ? 'Simulated payment' : 'PayPal sandbox'}`
                  : 'This older receipt has no capture-time snapshot. Its actual events remain available; historical eligibility is not reconstructed.'}
              </p>
            </div>
          </div>
          <div className="replay-workspace">
            <nav aria-label="Decision replay chapters">
              <ol>
                {stages.map((label, i) => (
                  <li key={label}>
                    <button
                      aria-current={step === i ? 'step' : undefined}
                      onClick={() => setStep(i)}
                    >
                      <span>{i + 1}</span>
                      {label}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="replay-chapter" aria-live="polite">
              <span className="replay-eyebrow">
                STEP {step + 1} OF {stages.length}
              </span>
              <h4>{stages[step]}</h4>
              {step === 0 && (
                <>
                  <p>
                    {agreement.title} · <strong>{money(agreement.amount)}</strong> · Version{' '}
                    {agreement.version}
                  </p>
                  <p>{agreement.brief}</p>
                  <ul className="replay-facts">
                    {(['buyer', 'developer'] as const).map((role) => (
                      <li key={role}>
                        {role === 'buyer' ? 'Buyer' : 'Business'} approval:{' '}
                        <strong>{agreement.approvals[role] || 'Not recorded'}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {step === 1 && (
                <>
                  {data.agentSteps.length ? (
                    <ol className="replay-events">
                      {data.agentSteps.map((s, i) => (
                        <li key={s.runId + ':' + i}>
                          <strong>{s.tool.replaceAll('_', ' ')}</strong>
                          <p>{s.detail}</p>
                          <time>{new Date(s.at).toLocaleString()}</time>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>
                      No model-backed agent trace is recorded for this agreement. Authored fixture
                      deliveries are identified by their fixture URLs.
                    </p>
                  )}
                  <ul className="replay-facts">
                    {agreement.runs.map((r) => (
                      <li key={r.id}>
                        {r.url} · {r.status} · v{r.version}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {step === 2 && (
                <>
                  {run ? (
                    <>
                      <p>
                        Run {run.id} · <strong>{run.status}</strong>
                        {run.artifactSha256 && (
                          <>
                            {' '}
                            · Artifact SHA-256 <code>{run.artifactSha256}</code>
                          </>
                        )}
                      </p>
                      <ul className="replay-evidence">
                        {agreement.criteria.map((c) => {
                          const result = run.results.find((r) => r.criterionId === c.id);
                          return (
                            <li key={c.id}>
                              <div>
                                <strong>{c.title}</strong>
                                <p>
                                  {result?.observed ||
                                    (c.type === 'manual'
                                      ? 'Human judgment required.'
                                      : 'No recorded finding.')}
                                </p>
                              </div>
                              <span className={'replay-badge ' + result?.status}>
                                {result?.status || 'unrecorded'}
                              </span>
                              {result?.screenshot && (
                                <button className="text-button" onClick={() => onEvidence(result)}>
                                  Evidence
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <p>No verification run is recorded for this version.</p>
                  )}
                </>
              )}
              {step === 3 && (
                <>
                  {record ? (
                    <>
                      <p>
                        <strong>
                          {data.source === 'recorded-capture-inputs'
                            ? `Capture requested through ${record.method === 'automatic' ? 'buyer-approved standing rules' : 'explicit buyer approval'}.`
                            : 'Eligibility using current recorded inputs.'}
                        </strong>
                      </p>
                      <span className={'replay-badge ' + automatic?.outcome}>
                        Automatic policy: {automatic?.outcome}
                      </span>
                      <ul>
                        {automatic?.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                      <p>
                        Explicit buyer capture: <strong>{record.manual.outcome}</strong>
                      </p>
                      <ul>
                        {record.manual.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                      <dl className="replay-metrics">
                        <div>
                          <dt>Rules</dt>
                          <dd>
                            v{record.rules.version} · {record.rules.enabled ? 'Enabled' : 'Paused'}
                          </dd>
                        </div>
                        <div>
                          <dt>Per-payment limit</dt>
                          <dd>{money(record.rules.perPaymentLimit)}</dd>
                        </div>
                        <div>
                          <dt>Budget used / reserved</dt>
                          <dd>
                            {money(record.budget.spent)} / {money(record.budget.reserved)}
                          </dd>
                        </div>
                        <div>
                          <dt>Monthly limit · {record.budget.month} UTC</dt>
                          <dd>{money(record.rules.monthlyLimit)}</dd>
                        </div>
                      </dl>
                    </>
                  ) : (
                    <p>Capture-time policy inputs were not recorded for this older payment.</p>
                  )}
                </>
              )}
              {step === 4 && (
                <>
                  <p>
                    {a.payment.mode === 'demo' ? 'Simulated payment' : 'PayPal sandbox'} ·{' '}
                    <strong>{a.payment.status}</strong>
                  </p>
                  <p>
                    Capture: <code>{a.payment.captureId || 'No confirmed capture'}</code>
                  </p>
                  <p>
                    Authorization: <code>{a.payment.authorizationId || 'Not recorded'}</code>
                  </p>
                  {a.payment.error && <p className="replay-error">{a.payment.error}</p>}
                  <ul className="replay-facts">
                    {a.payment.refunds?.map((r) => (
                      <li key={r.id}>
                        Refund {money(r.amount)} · {r.status} ·{' '}
                        {r.providerId || 'Provider confirmation unavailable'}
                      </li>
                    ))}
                  </ul>
                  <details>
                    <summary>Recorded agreement and payment events ({data.events.length})</summary>
                    <ol className="replay-events">
                      {data.events.map((e) => (
                        <li key={e.id}>
                          <strong>{e.title}</strong>
                          <p>{e.detail}</p>
                          <time>{new Date(e.at).toLocaleString()}</time>
                        </li>
                      ))}
                    </ol>
                  </details>
                </>
              )}
              <div className="replay-navigation">
                <button
                  className="button secondary"
                  disabled={step === 0}
                  onClick={() => setStep((s) => s - 1)}
                >
                  <ArrowLeft size={15} /> Previous
                </button>
                <button
                  className="button primary"
                  disabled={step === stages.length - 1}
                  onClick={() => setStep((s) => s + 1)}
                >
                  Next <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </div>
          <section className="replay-simulator" aria-label="What would block this payment?">
            <div className="block-title">
              <div>
                <span className="replay-eyebrow">
                  <FlaskConical size={15} /> ISOLATED POLICY LAB
                </span>
                <h3>What would block this payment?</h3>
                <p>
                  {record ? (
                    <>
                      Test automatic-payment rules against{' '}
                      {data.source === 'recorded-capture-inputs'
                        ? 'the capture-time inputs and clock'
                        : 'current inputs'}
                      . Recorded funds and evidence stay unchanged.
                    </>
                  ) : (
                    'Scenarios become available on new captures with recorded decision inputs.'
                  )}
                </p>
              </div>
            </div>
            <fieldset disabled={!record || pending}>
              <legend className="sr-only">Hypothetical payment conditions</legend>
              <div className="replay-controls">
                <label>
                  Per-payment limit (USD)
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    step="0.01"
                    placeholder={
                      record ? (record.rules.perPaymentLimit / 100).toFixed(2) : 'Unavailable'
                    }
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                  />
                </label>
                <label>
                  Make a required check fail
                  <select value={failed} onChange={(e) => setFailed(e.target.value)}>
                    <option value="">Keep recorded findings</option>
                    {agreement.criteria
                      .filter((c) => c.required && c.type !== 'manual')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="replay-check">
                  <input
                    type="checkbox"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                  />{' '}
                  Introduce an unapproved agreement change
                </label>
                <label className="replay-check">
                  <input
                    type="checkbox"
                    checked={complaint}
                    onChange={(e) => setComplaint(e.target.checked)}
                  />{' '}
                  Buyer opens a complaint and pauses auto-pay
                </label>
              </div>
              <button className="button primary" onClick={() => void simulate()}>
                <Play size={15} />
                {pending ? 'Evaluating…' : 'Run isolated scenario'}
              </button>
            </fieldset>
            {simulation && (
              <div className={'replay-result ' + simulation.result.outcome} role="status">
                <CheckCircle2 size={20} />
                <div>
                  <strong>
                    Automatic policy: {simulation.original.outcome} → {simulation.result.outcome}
                  </strong>
                  <ul>
                    {simulation.result.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <small>{simulation.note}</small>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
