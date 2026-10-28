import { useState, useRef } from 'react';
import { MessageCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import type { AgreementChange } from '../server/changes';
import type { Role } from '../server/domain';
type Props = {
  c: AgreementChange;
  role: Role;
  busy: string;
  act: (label: string, fn: () => Promise<any>) => Promise<void>;
  action: (suffix: string, body?: unknown) => Promise<any>;
};
export function ChangeDiscussion({ c, role, busy, act, action }: Props) {
  const draft = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState(''),
    [ref, setRef] = useState(''),
    [replyTo, setReplyTo] = useState('');
  const questions = c.messages.filter((m) => m.role === 'buyer' && !m.threadId);
  const open = questions.filter((q) => !q.resolution).length;
  const add = () =>
    act('Saving private agreement discussion', async () => {
      await action('/changes/' + c.id + '/messages', {
        text: message,
        ...(ref ? { ref } : {}),
        ...(replyTo ? { threadId: replyTo } : {}),
      });
      setMessage('');
      setReplyTo('');
      setRef('');
    });
  return (
    <section className="terms-questions">
      <div className="terms-section-header">
        <h4>
          <MessageCircle size={17} /> Questions before consent
        </h4>
        <span className={open ? 'terms-status waiting' : 'terms-status'}>
          {open ? `${open} open` : 'No open questions'}
        </span>
      </div>
      <p>
        Business replies do not close your questions. Only the buyer can mark a concern addressed or
        no longer blocking acceptance.
      </p>
      {questions.map((q) => (
        <Question
          key={q.id}
          {...{ q, c, role, busy, act, action }}
          onReply={() => {
            setReplyTo(q.id);
            setRef('');
            draft.current?.focus();
          }}
        />
      ))}
      {c.messages
        .filter((m) => m.role === 'developer' && !m.threadId)
        .map((m) => (
          <div className="terms-business-note" key={m.id}>
            <strong>Business note · {new Date(m.at).toLocaleString()}</strong>
            <p>{m.text}</p>
          </div>
        ))}
      <label>
        {role === 'buyer' ? 'Ask about a specific change' : 'Respond to a buyer question'}
        <select value={replyTo} onChange={(e) => setReplyTo(e.target.value)}>
          <option value="">
            {role === 'buyer' ? 'Start a new question' : 'Add a general business note'}
          </option>
          {questions.map((q) => (
            <option key={q.id} value={q.id}>
              Reply: {q.text.slice(0, 90)}
            </option>
          ))}
        </select>
      </label>
      {role === 'buyer' && !replyTo && (
        <label>
          Related change
          <select value={ref} onChange={(e) => setRef(e.target.value)}>
            <option value="">Whole proposal</option>
            {c.diffs.map((d) => (
              <option key={d.ref} value={d.ref}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label htmlFor={'question-' + c.id}>{replyTo ? 'Reply' : 'Question or response'}</label>
      <textarea
        ref={draft}
        id={'question-' + c.id}
        value={message}
        maxLength={2000}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Ask who receives data, request evidence for the price explanation, or clarify cancellation rights."
      />
      <button
        className="terms-secondary"
        disabled={!!busy || message.trim().length < 5}
        onClick={add}
      >
        {replyTo
          ? 'Send private reply'
          : role === 'buyer'
            ? 'Ask the business'
            : 'Add business note'}
      </button>
    </section>
  );
}
function Question({
  q,
  c,
  role,
  busy,
  act,
  action,
  onReply,
}: Props & { q: AgreementChange['messages'][number]; onReply: () => void }) {
  const [resolution, setResolution] = useState('');
  const label = c.diffs.find((d) => d.ref === q.ref)?.title;
  return (
    <article className={'terms-question-thread ' + (q.resolution ? 'addressed' : '')}>
      <div className="terms-section-header">
        <strong>{label || 'Whole proposal'}</strong>
        <span className={q.resolution ? 'terms-status' : 'terms-status waiting'}>
          {q.resolution ? 'Buyer marked addressed' : 'Awaiting buyer resolution'}
        </span>
      </div>
      <p className="terms-thread-label">Buyer · {new Date(q.at).toLocaleString()}</p>
      <p>{q.text}</p>
      {c.messages
        .filter((m) => m.threadId === q.id)
        .map((m) => (
          <div key={m.id} className="terms-thread-reply">
            <strong>
              {m.role === 'buyer' ? 'Buyer' : 'Business'} · {new Date(m.at).toLocaleString()}
            </strong>
            <p>{m.text}</p>
          </div>
        ))}
      <button className="terms-secondary" disabled={!!busy} onClick={onReply}>
        Reply to this question
      </button>
      {q.resolution ? (
        <div className="terms-question-resolution">
          <CheckCircle2 size={16} />
          <div>
            <strong>Buyer’s resolution</strong>
            <p>{q.resolution.note}</p>
            <small>{new Date(q.resolution.at).toLocaleString()}</small>
            {role === 'buyer' && (
              <button
                className="terms-secondary"
                disabled={!!busy}
                onClick={() =>
                  act('Reopening agreement question', () =>
                    action('/changes/' + c.id + '/questions/' + q.id, {
                      resolved: false,
                      note: 'Buyer reopened this question for further clarification.',
                    }),
                  )
                }
              >
                <RotateCcw size={13} />
                Reopen question
              </button>
            )}
          </div>
        </div>
      ) : (
        role === 'buyer' && (
          <div className="terms-question-resolve">
            <label htmlFor={'resolve-' + q.id}>Why is this addressed or no longer blocking?</label>
            <textarea
              id={'resolve-' + q.id}
              value={resolution}
              minLength={10}
              maxLength={1000}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Record the clarification you received, or why you no longer need this question answered."
            />
            <button
              className="terms-secondary"
              disabled={!!busy || resolution.trim().length < 10}
              onClick={() =>
                act('Recording buyer question resolution', async () => {
                  await action('/changes/' + c.id + '/questions/' + q.id, {
                    resolved: true,
                    note: resolution,
                    lastMessageId: c.messages
                      .filter((m) => m.id === q.id || m.threadId === q.id)
                      .at(-1)!.id,
                  });
                  setResolution('');
                })
              }
            >
              Mark addressed · save my explanation
            </button>
          </div>
        )
      )}
    </article>
  );
}
