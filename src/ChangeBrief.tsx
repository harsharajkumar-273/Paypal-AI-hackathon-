import type { AgreementChange } from '../server/changes';
export function ChangeBrief({ c }: { c: AgreementChange }) {
  const delta = c.after.amount - c.before.amount;
  const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
    (Math.abs(delta) / c.before.amount) * 100,
  );
  const added = c.diffs.filter((d) => !d.before).length,
    removed = c.diffs.filter((d) => !d.after).length;
  const changed = c.diffs.length - added - removed;
  const clauses = c.diffs.filter((d) => d.ref.startsWith('clause:'));
  return (
    <section className="terms-brief" aria-label="Recorded change summary">
      <div className="terms-section-header">
        <strong>Your decision at a glance</strong>
        <span className="terms-status">Recorded facts</span>
      </div>
      <div className="terms-brief-stats">
        <div>
          <strong>{delta === 0 ? '0%' : `${delta > 0 ? '+' : '−'}${percent}%`}</strong>
          <span>one-time price change</span>
        </div>
        <div>
          <strong>{c.diffs.length}</strong>
          <span>changed fields</span>
        </div>
        <div>
          <strong>{clauses.length}</strong>
          <span>additional clauses changed</span>
        </div>
      </div>
      <div className="terms-change-counts">
        <span>{added} added</span>
        <span>{changed} edited</span>
        <span>{removed} removed</span>
      </div>
      <p>
        {delta > 0
          ? 'The proposed increase applies only after you accept and provide fresh payment authorization.'
          : delta < 0
            ? 'The lower price still requires acceptance of the complete replacement agreement.'
            : 'An unchanged price can still come with changed obligations.'}{' '}
        The existing agreement is not silently rewritten.
      </p>
    </section>
  );
}
export function ChangedText({
  value,
  other,
  side,
}: {
  value: string;
  other: string;
  side: 'before' | 'after';
}) {
  const tokens = value.split(/(\s+)/),
    comparison = other.split(/(\s+)/);
  let start = 0,
    end = 0;
  while (start < tokens.length && start < comparison.length && tokens[start] === comparison[start])
    start++;
  while (
    end < tokens.length - start &&
    end < comparison.length - start &&
    tokens[tokens.length - end - 1] === comparison[comparison.length - end - 1]
  )
    end++;
  const prefix = tokens.slice(0, start).join(''),
    middle = tokens.slice(start, tokens.length - end).join(''),
    suffix = end ? tokens.slice(-end).join('') : '';
  return (
    <>
      {prefix}
      {middle && (side === 'before' ? <del>{middle}</del> : <ins>{middle}</ins>)}
      {suffix}
    </>
  );
}
