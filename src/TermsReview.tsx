import { useState } from 'react';
import { BellRing, FileDiff, ShieldCheck, Sparkles, Plus, Trash2 } from 'lucide-react';
import type { Agreement, Role } from '../server/domain';
import type { AgreementChange, AgreementClause, TermsSnapshot } from '../server/changes';
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const localTime = (d: string) => {
  const date = new Date(d);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
type Props = {
  a: Agreement;
  role: Role;
  busy: string;
  ai: boolean;
  demo: boolean;
  act: (label: string, fn: () => Promise<any>) => Promise<void>;
  action: (suffix: string, body?: unknown) => Promise<any>;
  onReplacement: (id: string) => void;
};
export function ChangeNotice({
  agreements,
  onOpen,
}: {
  agreements: Agreement[];
  onOpen: (id: string) => void;
}) {
  const pending = agreements.filter(
    (a) => ['draft', 'active'].includes(a.status) && a.changes?.some((c) => c.status === 'pending'),
  );
  if (!pending.length) return null;
  return (
    <section className="change-notice" aria-label="Agreement change notifications">
      <BellRing size={22} />
      <div>
        <strong>
          {pending.length} agreement{pending.length === 1 ? ' needs' : 's need'} renewed approval
        </strong>
        <p>
          Proposed price or terms changes pause payment for the affected job. Existing spending
          limits do not accept new terms.
        </p>
        <div className="change-notice-links">
          {pending.map((a) => (
            <button key={a.id} onClick={() => onOpen(a.id)}>
              Review {a.title} ↗
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
function FullDocument({ s, label }: { s: TermsSnapshot; label: string }) {
  return (
    <details className="terms-full">
      <summary>{label} · complete recorded agreement</summary>
      <h4>{s.title}</h4>
      <p>
        Customer: {s.client} · Fixed price: {money(s.amount)}
      </p>
      <p>
        Delivery: {new Date(s.dueAt).toLocaleString()} · {s.deliveryUrl}
      </p>
      <p className="terms-preserve">{s.brief}</p>
      <h4>Acceptance checks</h4>
      {s.criteria.map((c) => (
        <div key={c.id}>
          <strong>{c.title}</strong>
          <p>
            {c.type} · {c.required ? 'Required' : 'Optional'} · Selector:{' '}
            {c.selector || 'Human review'} · Expected: {c.expected}
          </p>
        </div>
      ))}
      <h4>Additional clauses</h4>
      {s.terms.length ? (
        s.terms.map((t) => (
          <div key={t.id}>
            <strong>
              {t.title} · {t.id}
            </strong>
            <p className="terms-preserve">{t.text}</p>
          </div>
        ))
      ) : (
        <p>No additional clauses were recorded for this version.</p>
      )}
    </details>
  );
}
export function TermsReviewPanel(props: Props) {
  const { a, role, busy, ai, demo, act, action, onReplacement } = props;
  const [price, setPrice] = useState(String(a.amount / 100)),
    [brief, setBrief] = useState(a.brief),
    [due, setDue] = useState(localTime(a.dueAt)),
    [effective, setEffective] = useState(localTime(new Date().toISOString())),
    [reason, setReason] = useState(''),
    [terms, setTerms] = useState<AgreementClause[]>(structuredClone(a.terms || []));
  const pending = a.changes?.find((c) => c.status === 'pending');
  const update = (i: number, field: 'title' | 'text', value: string) =>
    setTerms(terms.map((t, j) => (i === j ? { ...t, [field]: value } : t)));
  return (
    <div className="terms-review">
      <div className="block-title">
        <div>
          <h3>Know what changes before you agree.</h3>
          <p>Price, obligations, and data permissions in one exact comparison.</p>
        </div>
        <FileDiff size={22} />
      </div>
      <div className="terms-intro">
        <ShieldCheck size={19} />
        <p>
          The business proposes. The buyer reviews and decides. AI explains recorded text; it cannot
          establish the business’s motive, approve terms, or guarantee a legal outcome.
        </p>
      </div>
      {a.changeOrigin && (
        <div className="terms-success">
          This version was accepted from a recorded change proposal. Fresh payment authorization and
          delivery verification are required.
          <button
            className="terms-secondary"
            onClick={() => onReplacement(a.changeOrigin!.agreementId)}
          >
            View accepted proposal &amp; approval record
          </button>
        </div>
      )}
      {a.effectiveAt && Date.parse(a.effectiveAt) > Date.now() && (
        <p className="terms-business">
          This version becomes effective no earlier than {new Date(a.effectiveAt).toLocaleString()}.
          Payment authorization is blocked until then.
        </p>
      )}
      {a.terms?.length ? (
        <details className="terms-full">
          <summary>Current additional agreement clauses</summary>
          {a.terms.map((t) => (
            <div key={t.id}>
              <h4>{t.title}</h4>
              <p className="terms-preserve">{t.text}</p>
            </div>
          ))}
        </details>
      ) : (
        <p className="terms-muted">
          No additional clauses are recorded on this version. Previously approved checks and the
          brief remain available in Agreement.
        </p>
      )}
      {pending && <Proposal key={pending.id} {...props} c={pending} />}
      {role === 'developer' &&
        !pending &&
        ['draft', 'active'].includes(a.status) &&
        !['captured', 'capture_pending'].includes(a.payment.status) && (
          <form
            className="terms-propose"
            onSubmit={(e) => {
              e.preventDefault();
              void act('Publishing proposed terms', () =>
                action('/changes', {
                  baseVersion: a.version,
                  amount: Math.round(Number(price) * 100),
                  brief,
                  dueAt: due === localTime(a.dueAt) ? a.dueAt : new Date(due).toISOString(),
                  effectiveAt: new Date(effective).toISOString(),
                  reason,
                  terms,
                  criteria: a.criteria,
                }),
              );
            }}
          >
            <h4>Propose a replacement agreement</h4>
            <p>
              This publishes an in-app notice for this agreement’s buyer. Submission records the
              business’s approval of this exact proposal.
            </p>
            {demo && (
              <button
                type="button"
                className="terms-secondary"
                onClick={() => {
                  setPrice(String((a.amount + 200) / 100));
                  setReason(
                    'Example proposal: the business says service operating costs increased. This explanation has not been independently verified.',
                  );
                  setTerms([
                    ...terms.filter((t) => t.id !== 'usage-sharing'),
                    {
                      id: 'usage-sharing',
                      title: 'Usage data sharing',
                      text: 'The service may share booking-flow usage data with analytics partners for product improvement.',
                    },
                  ]);
                }}
              >
                Load example: +$2 and a data-sharing clause
              </button>
            )}
            <div className="terms-form-grid">
              <label>
                New fixed price (USD)
                <input
                  required
                  type="number"
                  min="1"
                  max="10000"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label>
                Earliest effective time
                <input
                  required
                  type="datetime-local"
                  value={effective}
                  onChange={(e) => setEffective(e.target.value)}
                />
              </label>
              <label>
                Delivery deadline
                <input
                  required
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
            </div>
            <label>
              Business explanation
              <textarea
                required
                minLength={20}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain the proposed change. The buyer sees this as the business’s claim."
              />
            </label>
            <label>
              Full proposed work brief
              <textarea
                required
                minLength={20}
                maxLength={6000}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </label>
            <h4>Full proposed additional clauses</h4>
            <p>
              Keep unchanged clauses. Removing one is recorded as a deletion. Acceptance checks
              remain unchanged in this form.
            </p>
            {terms.map((t, i) => (
              <fieldset key={t.id}>
                <legend>
                  Clause {i + 1} · {t.id}
                </legend>
                <label>
                  Heading
                  <input
                    required
                    minLength={3}
                    maxLength={120}
                    value={t.title}
                    onChange={(e) => update(i, 'title', e.target.value)}
                  />
                </label>
                <label>
                  Exact clause text
                  <textarea
                    required
                    minLength={5}
                    maxLength={3000}
                    value={t.text}
                    onChange={(e) => update(i, 'text', e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="terms-secondary"
                  onClick={() => setTerms(terms.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} />
                  Remove clause
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="terms-secondary"
              disabled={terms.length >= 16}
              onClick={() => setTerms([...terms, { id: crypto.randomUUID(), title: '', text: '' }])}
            >
              <Plus size={14} />
              Add clause
            </button>
            <button className="terms-primary" disabled={!!busy}>
              Publish proposal & notify buyer
            </button>
          </form>
        )}
      {(a.changes || [])
        .filter((c) => c.status !== 'pending')
        .map((c) => (
          <details key={c.id} className="terms-full">
            <summary>
              {c.status.toUpperCase()} · {money(c.before.amount)} → {money(c.after.amount)} ·{' '}
              {new Date(c.createdAt).toLocaleString()}
            </summary>
            <p>{c.reason}</p>
            <p>{c.decisionNote || 'Proposal withdrawn by the business.'}</p>
            <p>
              Original agreement digest: <code>{c.digest}</code>
            </p>
            <FullDocument s={c.before} label="Original" />
            <FullDocument s={c.after} label="Proposed" />
            {c.replacementId && (
              <button className="terms-secondary" onClick={() => onReplacement(c.replacementId!)}>
                Open accepted version
              </button>
            )}
          </details>
        ))}
      {role === 'buyer' && !pending && (
        <p className="terms-muted">No proposed changes need your decision on this agreement.</p>
      )}
    </div>
  );
}
function Proposal({
  a,
  c,
  role,
  busy,
  ai,
  act,
  action,
  onReplacement,
}: Props & { c: AgreementChange }) {
  const [ack, setAck] = useState(false),
    [note, setNote] = useState(''),
    [message, setMessage] = useState('');
  const delta = c.after.amount - c.before.amount;
  const needsVoid = !['none', 'voided', 'expired'].includes(a.payment.status);
  return (
    <article className="terms-proposal">
      <div className="terms-eyebrow">
        RENEWED APPROVAL REQUIRED · VERSION {c.baseVersion} → {c.baseVersion + 1}
      </div>
      <h3>
        {delta > 0
          ? `${money(delta)} increase for this job`
          : delta < 0
            ? `${money(-delta)} decrease for this job`
            : 'Terms changed; price unchanged'}
      </h3>
      <div className="terms-price">
        <div>
          <small>Current fixed price</small>
          <strong>{money(c.before.amount)}</strong>
        </div>
        <span>→</span>
        <div>
          <small>Proposed fixed price</small>
          <strong>{money(c.after.amount)}</strong>
        </div>
      </div>
      {c.diffs.some((d) => d.ref !== 'amount') && (
        <div className="terms-beyond">
          <strong>Look beyond the price</strong>
          <p>
            Also changing:{' '}
            {c.diffs
              .filter((d) => d.ref !== 'amount')
              .map((d) => d.title)
              .join(' · ')}
            .
          </p>
          <p>Read these changes before accepting the new price.</p>
        </div>
      )}
      <p>
        Effective no earlier than <strong>{new Date(c.effectiveAt).toLocaleString()}</strong>, after
        buyer acceptance and fresh authorization. This is a one-time job, not a subscription.
      </p>
      <div className="terms-business">
        <strong>Business explanation · unverified claim</strong>
        <p>{c.reason}</p>
      </div>
      <h4>
        Every recorded change <span>({c.diffs.length})</span>
      </h4>
      <p className="terms-muted">
        Compare all changes, including additions and removals. AI findings do not replace this
        complete list.
      </p>
      {c.diffs.map((d) => (
        <section key={d.ref} id={'diff-' + c.id + '-' + d.ref} className="terms-diff">
          <h4>{d.title}</h4>
          <code>{d.ref}</code>
          <div className="terms-diff-grid">
            <div>
              <small>BEFORE</small>
              <p>{d.ref === 'amount' ? money(Number(d.before)) : d.before || 'Not present'}</p>
            </div>
            <div>
              <small>PROPOSED</small>
              <p>{d.ref === 'amount' ? money(Number(d.after)) : d.after || 'Removed'}</p>
            </div>
          </div>
        </section>
      ))}
      <FullDocument s={c.before} label="Original" />
      <FullDocument s={c.after} label="Proposed" />
      <section className="terms-agent">
        <h4>
          <Sparkles size={17} />
          Buyer-side review agent
        </h4>
        <p>
          Review cost, data use, permissions, service, cancellation, and legal wording. The agent
          can inspect supplied text, not prove why the business changed it.
        </p>
        {role === 'buyer' && (
          <button
            className="terms-secondary"
            disabled={!!busy || !ai}
            onClick={() =>
              act('Reviewing complete agreement changes', () =>
                action('/changes/' + c.id + '/review'),
              )
            }
          >
            {ai ? 'Explain changes with AI' : 'AI key needed · exact comparison available'}
          </button>
        )}
        {c.review && (
          <>
            <p role="status">
              <strong>
                {c.review.status === 'completed'
                  ? 'AI explanation · source quotes checked'
                  : c.review.status === 'pending'
                    ? 'Review in progress'
                    : 'AI review unavailable'}
              </strong>
            </p>
            <p>{c.review.summary}</p>
            {c.review.findings.map((f, i) => (
              <div className="terms-finding" key={i}>
                <span>{f.category}</span>
                <p>{f.explanation}</p>
                <blockquote>{f.quote}</blockquote>
                <a href={'#diff-' + c.id + '-' + f.ref}>Read exact source · {f.ref}</a>
                <p>
                  <strong>Question to ask:</strong> {f.question}
                </p>
              </div>
            ))}
            {c.review.status === 'completed' && (
              <p className="terms-muted">
                A missing finding does not mean a term is safe or unchanged. Review the full
                comparison.
              </p>
            )}
          </>
        )}
      </section>
      <section className="terms-questions">
        <h4>Ask before accepting</h4>
        {c.messages.map((m) => (
          <div key={m.id}>
            <strong>
              {m.role === 'buyer' ? 'Buyer' : 'Business'} · {new Date(m.at).toLocaleString()}
            </strong>
            <p>{m.text}</p>
          </div>
        ))}
        <label>
          Question or response
          <textarea
            value={message}
            maxLength={2000}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask about an obligation or request evidence for the explanation."
          />
        </label>
        <button
          className="terms-secondary"
          disabled={!!busy || message.trim().length < 5}
          onClick={() =>
            act('Adding agreement question', async () => {
              await action('/changes/' + c.id + '/messages', { text: message });
              setMessage('');
            })
          }
        >
          Add to private discussion
        </button>
      </section>
      {role === 'buyer' ? (
        <div className="terms-decision">
          <h4>Your decision controls the agreement</h4>
          {needsVoid && (
            <div className="terms-void">
              <p>
                Before accepting, void the previous order/authorization. No captured funds are
                refunded by this action. You can decline the proposal without voiding.
              </p>
              <button
                className="terms-secondary"
                disabled={!!busy}
                onClick={() =>
                  act('Voiding previous authorization', () => action('/payments/void'))
                }
              >
                Void old authorization before replacement
              </button>
            </div>
          )}
          <label>
            Decision note
            <textarea
              minLength={10}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Record your decision or explain why you decline."
            />
          </label>
          <label className="terms-check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
            reviewed the complete changes. Accepting approves this exact new version; declining
            keeps the original terms and permits its existing payment rules to continue.
          </label>
          <div className="terms-actions">
            <button
              className="terms-primary"
              disabled={!!busy || !ack || note.trim().length < 10 || needsVoid}
              onClick={() =>
                act('Recording acceptance of changed terms', async () => {
                  const r = await action('/changes/' + c.id + '/decision', {
                    decision: 'accept',
                    digest: c.proposalDigest,
                    acknowledge: ack,
                    note,
                  });
                  if (r.replacementId) onReplacement(r.replacementId);
                })
              }
            >
              Accept new version · authorize separately
            </button>
            <button
              className="terms-secondary"
              disabled={!!busy || !ack || note.trim().length < 10}
              onClick={() =>
                act('Keeping original agreement terms', () =>
                  action('/changes/' + c.id + '/decision', {
                    decision: 'decline',
                    digest: c.proposalDigest,
                    acknowledge: ack,
                    note,
                  }),
                )
              }
            >
              Decline changes & keep original terms
            </button>
          </div>
        </div>
      ) : (
        <button
          className="terms-secondary"
          disabled={!!busy}
          onClick={() =>
            act('Withdrawing change proposal', () => action('/changes/' + c.id + '/withdraw'))
          }
        >
          Withdraw proposal · keep original terms
        </button>
      )}
      <p className="terms-muted terms-digest">
        Proposal SHA-256: <code>{c.proposalDigest}</code>
        <br />
        Acceptance is recorded with version and time; it is not a legal certification.
      </p>
    </article>
  );
}
