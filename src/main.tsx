import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  LayoutDashboard,
  FileCheck2,
  ShieldCheck,
  Settings,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MoreHorizontal,
  Monitor,
  Smartphone,
  Sparkles,
  X,
  Play,
  AlertCircle,
  RefreshCw,
  LockKeyhole,
  Copy,
  LogOut,
  BookOpen,
  Receipt,
  Loader2,
  Search,
  CheckCheck,
  Command,
  Zap,
  Pause,
  Bot,
  Code2,
  ShieldAlert,
  Undo2,
} from 'lucide-react';
import type { Agreement, Criterion, Role, Workspace, Run, Result } from '../server/domain';
import type { PaymentRules, AutoDecision } from '../server/automation';
import { RecoveryPanel, RecoveryBanner, ReportProblemModal } from './Recovery';
import { TermsReviewPanel, ChangeNotice } from './TermsReview';
import { GuidedWalkthrough, WalkthroughInvite } from './GuidedWalkthrough';
import './styles.css';
type State = Workspace & {
  role: Role;
  aiConfigured: boolean;
  paypalConfigured: boolean;
  paymentRules: PaymentRules;
  paymentBudget: { month: string; spent: number; reserved: number; total: number; limit: number };
  automaticDecisions: Record<string, AutoDecision>;
  refundBalances: Record<string, { completed: number; pending: number; available: number }>;
};
type Tab =
  | 'Overview'
  | 'Agreement'
  | 'Evidence'
  | 'Activity'
  | 'Scope changes'
  | 'Terms review'
  | 'Agent work'
  | 'Resolution';
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const date = (s: string) =>
  new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const time = (s: string) =>
  new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
async function api(path: string, body?: unknown, method?: string) {
  const res = await fetch('/api' + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data)
    throw Object.assign(
      new Error(
        data?.error ||
          'The response could not be confirmed. Refresh the case and check its status before starting another payment or refund.',
      ),
      { status: res.status },
    );
  return data;
}
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={'brand-mark ' + (small ? 'small' : '')}>
      <CheckCheck size={small ? 18 : 24} strokeWidth={2.1} />
    </span>
  );
}
function App() {
  const [state, setState] = useState<State | null>(null),
    [selected, setSelected] = useState(''),
    [tab, setTab] = useState<Tab>('Overview'),
    [filter, setFilter] = useState('All projects'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [modal, setModal] = useState<
      'new' | 'edit' | 'help' | 'connect' | 'rules' | 'agentTask' | 'report' | null
    >(null),
    [phone, setPhone] = useState(false),
    [query, setQuery] = useState(''),
    [preview, setPreview] = useState<'broken' | 'fixed'>('broken'),
    [guideOpen, setGuideOpen] = useState(false),
    [guideTarget, setGuideTarget] = useState<string | null>(null),
    [evidence, setEvidence] = useState<Result | null>(null);
  const projectRef = useRef<HTMLElement>(null);
  const refresh = useCallback(async () => {
    const w = await api('/workspace');
    setState(w);
    setSelected((current) =>
      w.agreements.some((a: Agreement) => a.id === current) ? current : w.agreements[0]?.id || '',
    );
    return w as State;
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await refresh();
      } catch (e: any) {
        if (e.status === 401) {
          try {
            await api('/session', {});
            if (live) await refresh();
          } catch (err: any) {
            setError(err.message);
          }
        } else setError(e.message);
      }
    })();
    return () => {
      live = false;
    };
  }, [refresh]);
  const list =
    state?.agreements.filter(
      (a) =>
        (filter !== 'Completed' || a.status === 'completed') &&
        (filter !== 'Active agreements' || a.status === 'active') &&
        a.title.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const a = list.find((a) => a.id === selected) || list[0],
    run = a?.runs.filter((r) => r.version === a.version)[0];
  useEffect(() => {
    if (!state) return;
    const active = state.agreements.some(
      (a) =>
        a.runs.some((r) => r.status === 'queued' || r.status === 'running') ||
        Boolean(a.payment.busy) ||
        a.payment.status === 'capture_pending' ||
        a.payment.refunds?.some((r) => r.status === 'pending') ||
        a.cases?.some((c) =>
          ['requested', 'under_review', 'refund_pending', 'partially_refunded'].includes(c.status),
        ) ||
        a.changes?.some((c) => c.status === 'pending') ||
        (state.paymentRules?.enabled && a.status === 'active'),
    );
    const reload = () => {
      if (!document.hidden) void refresh().catch((e) => setError(e.message));
    };
    const id = setInterval(reload, active ? 1600 : 10000);
    window.addEventListener('focus', reload);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', reload);
    };
  }, [state, refresh]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 5500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (
      guideOpen ||
      !guideTarget ||
      selected !== guideTarget ||
      !state?.agreements.some((a) => a.id === guideTarget)
    )
      return;
    const frame = requestAnimationFrame(() => {
      projectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      projectRef.current?.focus({ preventScroll: true });
      setGuideTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [guideOpen, guideTarget, selected, state]);
  async function act(label: string, fn: () => Promise<any>) {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
      await refresh().catch(() => {});
    } finally {
      setBusy('');
    }
  }
  function launchGuide(fresh = false) {
    if (!state?.demo) {
      setModal('help');
      return;
    }
    setModal(null);
    setError('');
    if (
      !fresh &&
      state.walkthrough &&
      state.agreements.some((a) => a.id === state.walkthrough!.agreementId)
    ) {
      setSelected(state.walkthrough.agreementId);
      setFilter('All projects');
      setQuery('');
      setGuideOpen(true);
      return;
    }
    void act('Preparing your private guided example', async () => {
      const result = await api('/demo/walkthrough', {});
      setSelected(result.id);
      setFilter('All projects');
      setQuery('');
      setTab('Agreement');
      setGuideOpen(true);
    });
  }
  const action = (suffix: string, body: unknown = {}) => api(`/agreements/${a!.id}${suffix}`, body);
  const switchRole = (r: Role) => act('Switching view', () => api('/demo/role', { role: r }));
  const ready = Boolean(
    a &&
    !a.changes?.some((c) => c.status === 'pending') &&
    (!a.effectiveAt || Date.parse(a.effectiveAt) <= Date.now()) &&
    !a.cases?.some((c) =>
      ['requested', 'under_review', 'refund_pending', 'partially_refunded'].includes(c.status),
    ) &&
    run?.status === 'completed' &&
    a.criteria
      .filter((c) => c.required)
      .every((c) =>
        c.type === 'manual'
          ? a.manualAccepted.includes(c.id)
          : run.results.some((r) => r.criterionId === c.id && r.status === 'pass'),
      ),
  );
  const passed = run?.results.filter((r) => r.status === 'pass').length || 0,
    automated = a?.criteria.filter((c) => c.type !== 'manual').length || 0;

  const totals = state?.agreements.reduce(
    (s, a) => ({
      active: s.active + (a.status === 'active' ? 1 : 0),
      value: s.value + (!['cancelled', 'superseded'].includes(a.status) ? a.amount : 0),
      paid: s.paid + (a.payment.status === 'captured' ? a.amount : 0),
    }),
    { active: 0, value: 0, paid: 0 },
  );
  async function verify(which: 'broken' | 'fixed') {
    setPreview(which);
    await act('Running browser checks', async () => {
      await action('/verify', { url: state?.demo ? `fixture:${which}` : a!.deliveryUrl });
      setTab('Evidence');
    });
  }
  const paymentBusy = Boolean(a?.payment.busy || busy);
  const autoDecision = a ? state?.automaticDecisions?.[a.id] : undefined;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="ProofPay home">
          <Mark />
          <span>
            proofpay<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">H</span>
          <div>
            <strong>Your workspace</strong>
            <span>{state?.demo ? 'Personal walkthrough' : 'Merchant workspace'}</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            { label: 'All projects', icon: LayoutDashboard },
            { label: 'Active agreements', icon: FileCheck2 },
            { label: 'Completed', icon: ShieldCheck },
          ].map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={'nav-item ' + (filter === label ? 'selected' : '')}
              onClick={() => setFilter(label)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === 'All projects' && (
                <span className="nav-count">{state?.agreements.length || 0}</span>
              )}
            </button>
          ))}
        </nav>
        <button
          className="new-side"
          onClick={() => setModal('new')}
          disabled={state?.role === 'buyer'}
        >
          <Plus size={16} />
          New project
        </button>
        <div className="sidebar-note">
          <div className="mini-symbol">✳</div>
          <h3>
            Agents do the work.
            <br />
            Proof earns the payment.
          </h3>
          <p>
            Clear tasks. Independent checks.
            <br />
            Payments within your rules.
          </p>
          <span className="note-line" />
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal('help')}>
            <BookOpen size={17} />
            The ProofPay guide
            <ArrowUpRight size={14} />
          </button>
          <button className="nav-item" onClick={() => setModal('connect')}>
            <Settings size={17} />
            Connections & access
          </button>
          <div className="profile">
            <span className="profile-avatar">{state?.role === 'buyer' ? 'SC' : 'HK'}</span>
            <div>
              <strong>{state?.role === 'buyer' ? 'Sunday Café' : 'Your business view'}</strong>
              <span>{state?.demo ? 'Isolated demo workspace' : 'Private workspace'}</span>
            </div>
            <button
              aria-label="Sign out"
              onClick={() =>
                act('Signing out', async () => {
                  await api('/logout', {});
                  location.reload();
                })
              }
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} />
            <span>
              {state?.role === 'buyer'
                ? 'Buyer workspace'
                : state?.role === 'developer'
                  ? 'Business workspace'
                  : 'Agent workspace'}
            </span>
          </div>
          <div className="topbar-right">
            {state?.demo && (
              <label className="top-role">
                <span>Demo view</span>
                <select
                  aria-label="Walkthrough role"
                  value={state.role}
                  disabled={!!busy}
                  onChange={(e) => switchRole(e.target.value as Role)}
                >
                  <option value="buyer">Buyer</option>
                  <option value="developer">Business</option>
                </select>
              </label>
            )}
            <span className="environment">
              <span />
              {state?.demo ? 'Walkthrough mode' : 'PayPal sandbox'}
            </span>
            <button className="help-button" onClick={() => setModal('help')}>
              ?
            </button>
            <span className="top-avatar">{state?.role === 'buyer' ? 'SC' : 'HK'}</span>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {state?.role === 'buyer'
                  ? 'BUYER · AGREEMENTS & PAYMENTS'
                  : 'BUSINESS · DELIVERY & BUYER SUPPORT'}
              </div>
              <h1>
                Pay for proven
                <br />
                agent work<span>.</span>
              </h1>
              <p>
                {state?.role === 'buyer'
                  ? 'Review the work and the terms. Pay within your rules.'
                  : 'Deliver work. Answer buyer questions. Get paid for proven results.'}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button primary"
                disabled={!state || (!state.demo && state.role !== 'buyer')}
                onClick={() => {
                  if (state?.demo && state.role === 'developer') {
                    void act('Opening buyer view', async () => {
                      await api('/demo/role', { role: 'buyer' });
                      setModal('agentTask');
                    });
                  } else setModal('agentTask');
                }}
              >
                <Bot size={16} />
                Commission agent task
              </button>
              <button
                className="button secondary"
                onClick={() => setModal('new')}
                disabled={!state || state.role === 'buyer'}
              >
                <Plus size={16} />
                New project
              </button>
            </div>
          </div>
          {state?.demo && (
            <WalkthroughInvite
              resume={Boolean(state.walkthrough)}
              busy={busy}
              onStart={() => launchGuide(true)}
              onResume={() => launchGuide()}
            />
          )}
          {state?.recoveryPause && (
            <RecoveryBanner
              workspace={state}
              role={state.role}
              busy={busy}
              onCase={(id) => {
                setSelected(id);
                setFilter('All projects');
                setQuery('');
                setTab('Resolution');
              }}
              onResume={() =>
                act('Resuming after case review', () =>
                  api('/recovery/resume', { confirmResume: true }),
                )
              }
            />
          )}
          {state && (
            <ChangeNotice
              agreements={state.agreements}
              onOpen={(id) => {
                setSelected(id);
                setFilter('All projects');
                setQuery('');
                setTab('Terms review');
              }}
            />
          )}
          {error && (
            <div className="alert error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={17} />
              {notice}
            </div>
          )}
          <div className="stats-grid">
            <Stat
              label="PROJECT VALUE"
              value={money(totals?.value || 0)}
              sub="Across your agreements"
              icon={<Receipt size={17} />}
            />
            <Stat
              label="ACTIVE AGREEMENTS"
              value={String(totals?.active || 0).padStart(2, '0')}
              sub="Clear expectations, shared"
              icon={<FileCheck2 size={17} />}
            />
            <Stat
              label="DELIVERY CHECKS"
              value={
                run ? `${passed} / ${automated}` : String(a?.criteria.length || 0).padStart(2, '0')
              }
              sub={run ? 'Automated checks passed' : 'Acceptance criteria defined'}
              icon={<CheckCheck size={18} />}
            />
            <Stat
              label={state?.demo ? 'SIMULATED PAYMENTS' : 'PAYMENTS COMPLETED'}
              value={money(totals?.paid || 0)}
              sub={state?.demo ? 'No real money moves' : 'Confirmed sandbox captures'}
              icon={<ShieldCheck size={18} />}
            />
          </div>
          <div className="section-heading">
            <div className="section-title">
              Tasks & projects <span>{list.length}</span>
            </div>
            <div className="section-tools">
              <div className="search">
                <Search size={14} />
                <input
                  aria-label="Search projects"
                  placeholder="Find a project…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <span className="quiet">Built on clarity. Backed by proof.</span>
            </div>
          </div>
          {!state ? (
            <div className="loading-panel">
              <Loader2 className="spin" />
              Preparing your private workspace…
            </div>
          ) : list.length === 0 ? (
            <div className="empty-state">
              <FileCheck2 size={30} />
              <h2>{query ? 'No matching projects' : 'A clear agreement starts here.'}</h2>
              <p>
                {state.role === 'buyer'
                  ? 'Commission a repair agent with clear checks and a fixed budget.'
                  : 'Create a project and turn the brief into a shared definition of done.'}
              </p>
              <button
                className="button primary"
                onClick={() => setModal(state.role === 'buyer' ? 'agentTask' : 'new')}
              >
                {state.role === 'buyer' ? 'Commission agent task' : 'Create a project'}
                <Plus size={15} />
              </button>
            </div>
          ) : (
            <>
              {list.length > 1 && (
                <div className="project-pills">
                  {list.map((p) => (
                    <button
                      className={p.id === a?.id ? 'active' : ''}
                      key={p.id}
                      onClick={() => {
                        setSelected(p.id);
                        setTab('Overview');
                      }}
                    >
                      {p.agentTask ? 'Agent repair · ' + money(p.amount) : p.client}
                      <span className={'tiny-dot ' + p.status} />
                    </button>
                  ))}
                </div>
              )}
              {a && (
                <div className="project-layout">
                  <section
                    ref={projectRef}
                    className="project-card"
                    tabIndex={-1}
                    aria-label={a.title}
                  >
                    <div className="project-header">
                      <div className="client-icon">
                        s<span>.</span>
                      </div>
                      <div className="project-identity">
                        <div className="project-kicker">
                          {a.client} <span>·</span> WEBSITE DELIVERY
                        </div>
                        <h2>{a.title}</h2>
                        <div className="project-meta">
                          <span>PP–{a.id.slice(0, 4).toUpperCase()}</span>
                          <span>Version {a.version}.0</span>
                          <span>
                            <Clock3 size={12} />
                            Due {date(a.dueAt)}
                          </span>
                        </div>
                      </div>
                      <span className={'status-pill ' + a.status}>
                        <span />
                        {a.status === 'draft'
                          ? 'Awaiting approval'
                          : a.status === 'active'
                            ? 'In progress'
                            : a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                      </span>
                    </div>
                    <div
                      className={'project-tabs ' + (a.agentTask ? 'agent-tabs' : '')}
                      role="tablist"
                    >
                      {(
                        [
                          'Overview',
                          'Agreement',
                          ...(a.agentTask ? ['Agent work'] : []),
                          'Evidence',
                          'Activity',
                          'Scope changes',
                          'Terms review',
                          ...(a.cases?.length ||
                          ['created', 'authorized', 'capture_pending', 'captured'].includes(
                            a.payment.status,
                          )
                            ? ['Resolution']
                            : []),
                        ] as Tab[]
                      ).map((t) => (
                        <button
                          key={t}
                          role="tab"
                          aria-selected={tab === t}
                          className={tab === t ? 'active' : ''}
                          onClick={() => setTab(t)}
                        >
                          {t}
                          {t === 'Evidence' && run && <span>{run.results.length}</span>}
                          {t === 'Scope changes' && a.scope && <i />}
                          {t === 'Terms review' &&
                            a.changes?.some((c) => c.status === 'pending') && <i />}
                        </button>
                      ))}
                    </div>
                    <div className="project-body">
                      {tab === 'Overview' && (
                        <>
                          <div className="journey">
                            {[
                              {
                                n: 1,
                                label: 'Agree',
                                done: Boolean(a.approvals.buyer && a.approvals.developer),
                              },
                              {
                                n: 2,
                                label: 'Authorize',
                                done: ['authorized', 'captured', 'capture_pending'].includes(
                                  a.payment.status,
                                ),
                              },
                              {
                                n: 3,
                                label: 'Verify',
                                done: ready || a.payment.status === 'captured',
                              },
                              {
                                n: 4,
                                label: 'Approve & pay',
                                done: a.payment.status === 'captured',
                              },
                            ].map((s, i) => (
                              <React.Fragment key={s.n}>
                                <div className={'journey-step ' + (s.done ? 'done' : '')}>
                                  <span>{s.done ? <Check size={12} /> : s.n}</span>
                                  <strong>{s.label}</strong>
                                </div>
                                {i < 3 && (
                                  <div className={'journey-line ' + (s.done ? 'done' : '')} />
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                          <div className="block-title">
                            <div>
                              <h3>A shared picture of done</h3>
                              <p>The brief, the build, and the proof. All in one place.</p>
                            </div>
                            <button className="text-button" onClick={() => setTab('Agreement')}>
                              View agreement
                              <ArrowUpRight size={14} />
                            </button>
                          </div>
                          <div className="preview-frame">
                            <div className="preview-toolbar">
                              <div className="browser-dots">
                                <i />
                                <i />
                                <i />
                              </div>
                              <span>
                                <LockKeyhole size={10} />
                                {state.demo || a.agentTask
                                  ? 'sunday-cafe.demo'
                                  : new URL(a.deliveryUrl).hostname}
                              </span>
                              <div className="viewport-switch">
                                <button
                                  className={!phone ? 'selected' : ''}
                                  aria-label="Desktop preview"
                                  onClick={() => setPhone(false)}
                                >
                                  <Monitor size={13} />
                                </button>
                                <button
                                  className={phone ? 'selected' : ''}
                                  aria-label="Mobile preview"
                                  onClick={() => setPhone(true)}
                                >
                                  <Smartphone size={13} />
                                </button>
                              </div>
                            </div>
                            <div className={'preview-viewport ' + (phone ? 'phone' : '')}>
                              {state.demo || a.agentTask ? (
                                <iframe
                                  title="Sunday Café delivery preview"
                                  sandbox="allow-scripts allow-same-origin"
                                  src={
                                    run?.artifactId
                                      ? `/fixtures/agent/${run.artifactId}`
                                      : `/fixtures/${run?.url === 'fixture:fixed' ? 'fixed' : run?.url === 'fixture:broken' ? 'broken' : preview}`
                                  }
                                />
                              ) : (
                                <div className="external-preview">
                                  <Monitor size={32} />
                                  <h3>Your approved delivery website</h3>
                                  <p>{a.deliveryUrl}</p>
                                  <a
                                    className="button secondary"
                                    href={a.deliveryUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open website
                                    <ExternalLink size={14} />
                                  </a>
                                </div>
                              )}
                            </div>
                            <div className="preview-footer">
                              <span className="preview-label">
                                <span />
                                {run?.artifactId
                                  ? 'Agent-written artifact'
                                  : state.demo || a.agentTask
                                    ? 'Fictional café fixture'
                                    : 'Approved delivery URL'}
                              </span>
                              <span>Preview is not verification evidence</span>
                            </div>
                          </div>
                          <div className="next-step">
                            <span className="next-icon">
                              <FileCheck2 size={19} />
                            </span>
                            <div>
                              <strong>
                                {a.status === 'draft'
                                  ? 'First, agree on what great looks like.'
                                  : a.payment.status === 'captured'
                                    ? 'A clear finish. A confident payment.'
                                    : !['authorized', 'capture_pending'].includes(a.payment.status)
                                      ? 'Next, authorize the agreed payment.'
                                      : run?.status === 'completed'
                                        ? 'The evidence is ready for review.'
                                        : 'Ready to put the delivery to the test?'}
                              </strong>
                              <p>
                                {a.status === 'draft'
                                  ? 'Both parties review and approve the same version of the agreement.'
                                  : 'Every decision stays connected to the agreed version.'}
                              </p>
                            </div>
                            <button
                              className="button secondary small-button"
                              onClick={() =>
                                setTab(a.status === 'draft' ? 'Agreement' : 'Evidence')
                              }
                            >
                              {a.status === 'draft' ? 'Review checks' : 'View evidence'}
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        </>
                      )}
                      {tab === 'Agreement' && (
                        <>
                          <div className="block-title">
                            <div>
                              <h3>Your definition of done</h3>
                              <p>Specific checks, agreed before the work begins.</p>
                            </div>
                            {a.status === 'draft' && (
                              <button
                                className="text-button"
                                disabled={!!busy}
                                onClick={() => setModal('edit')}
                              >
                                Edit checks
                                <ArrowUpRight size={14} />
                              </button>
                            )}
                          </div>
                          <div className="brief-box">
                            <span className="eyebrow">THE BRIEF</span>
                            <p>{a.brief}</p>
                          </div>
                          <div className="criteria-list">
                            {a.criteria.map((c, i) => (
                              <div className="criterion" key={c.id}>
                                <span className="criterion-number">
                                  {String(i + 1).padStart(2, '0')}
                                </span>
                                <div>
                                  <strong>{c.title}</strong>
                                  <p>
                                    {c.type === 'manual'
                                      ? c.expected
                                      : `${c.selector} → ${c.expected}`}
                                  </p>
                                </div>
                                <span
                                  className={'check-type ' + (c.type === 'manual' ? 'manual' : '')}
                                >
                                  {c.type === 'manual' ? 'Human review' : 'Browser check'}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="approval-row">
                            {(['developer', 'buyer'] as Role[]).map((r) => (
                              <div
                                key={r}
                                className={'approval ' + (a.approvals[r] ? 'approved' : '')}
                              >
                                <span className="approval-avatar">
                                  {r === 'developer' ? 'D' : 'B'}
                                </span>
                                <div>
                                  <strong>{r === 'developer' ? 'Business' : 'Buyer'}</strong>
                                  <span>
                                    {a.approvals[r]
                                      ? `Approved v${a.version} · ${date(a.approvals[r]!)}`
                                      : 'Review and approval needed'}
                                  </span>
                                </div>
                                {a.approvals[r] ? <CheckCircle2 size={18} /> : <Clock3 size={17} />}
                              </div>
                            ))}
                          </div>
                          <div className="action-footer">
                            <span>
                              <LockKeyhole size={13} />
                              Edits require fresh approval from both parties.
                            </span>
                            <button
                              className="button primary"
                              disabled={
                                !!busy ||
                                !!a.approvals[state.role] ||
                                !['draft', 'active'].includes(a.status)
                              }
                              onClick={() => act('Approving agreement', () => action('/approve'))}
                            >
                              {a.approvals[state.role] ? (
                                <>
                                  <Check size={15} />
                                  You approved v{a.version}
                                </>
                              ) : (
                                <>
                                  Approve as {state.role}
                                  <Check size={15} />
                                </>
                              )}
                            </button>
                          </div>
                        </>
                      )}
                      {tab === 'Evidence' && (
                        <>
                          <div className="block-title">
                            <div>
                              <h3>Evidence over assumptions</h3>
                              <p>Real browser checks against the approved agreement.</p>
                            </div>
                            <span className="version-label">VERSION {a.version}.0</span>
                          </div>
                          {run?.status === 'queued' || run?.status === 'running' ? (
                            <div className="verification-running">
                              <div className="radar">
                                <ShieldCheck size={29} />
                              </div>
                              <h3>Putting the delivery to the test.</h3>
                              <p>
                                A browser is checking the approved criteria and saving evidence.
                              </p>
                              <span className="status-pill active">
                                <Loader2 size={12} className="spin" />
                                {run.status === 'queued'
                                  ? 'Queued for browser'
                                  : 'Browser is running'}
                              </span>
                            </div>
                          ) : run?.status === 'error' ? (
                            <div className="alert error">
                              <AlertCircle size={18} />
                              <span>{run.error}</span>
                            </div>
                          ) : run?.status === 'completed' ? (
                            <>
                              <div
                                className={
                                  'evidence-summary ' + (passed === automated ? 'success' : '')
                                }
                              >
                                <div className="evidence-score">
                                  {passed}
                                  <span>/{automated}</span>
                                </div>
                                <div>
                                  <strong>
                                    {passed === automated
                                      ? 'The automated checks are clear.'
                                      : 'A little more work. A lot more clarity.'}
                                  </strong>
                                  <p>{run.summary}</p>
                                  <span>
                                    {((run.durationMs || 0) / 1000).toFixed(1)}s verification ·{' '}
                                    {time(run.completedAt!)} ·{' '}
                                    {state.aiConfigured ? 'AI summary' : 'Template summary'}
                                  </span>
                                </div>
                              </div>
                              <div className="criteria-list evidence-list">
                                {a.criteria.map((c) => {
                                  const r = run.results.find((r) => r.criterionId === c.id),
                                    manual = c.type === 'manual',
                                    accepted = a.manualAccepted.includes(c.id),
                                    status = manual
                                      ? accepted
                                        ? 'pass'
                                        : 'manual'
                                      : r?.status || 'inconclusive';
                                  return (
                                    <div className="evidence-item" key={c.id}>
                                      <div className={'result-icon ' + status}>
                                        {status === 'pass' ? (
                                          <Check size={16} />
                                        ) : status === 'fail' ? (
                                          <X size={15} />
                                        ) : (
                                          <Clock3 size={15} />
                                        )}
                                      </div>
                                      <div className="evidence-text">
                                        <strong>{c.title}</strong>
                                        <p>
                                          {manual
                                            ? c.expected
                                            : r?.observed || 'No evidence recorded.'}
                                        </p>
                                        {manual && (
                                          <label className="manual-checkbox">
                                            <input
                                              type="checkbox"
                                              checked={accepted}
                                              disabled={
                                                state.role !== 'buyer' ||
                                                !!busy ||
                                                a.status !== 'active'
                                              }
                                              onChange={(e) =>
                                                act('Saving buyer review', () =>
                                                  action('/manual', {
                                                    criterionId: c.id,
                                                    accepted: e.target.checked,
                                                  }),
                                                )
                                              }
                                            />
                                            I reviewed and accept this requirement
                                            {state.role !== 'buyer' && <span> · Buyer review</span>}
                                          </label>
                                        )}
                                      </div>
                                      <div className="evidence-right">
                                        <span className={'result-label ' + status}>
                                          {status === 'pass'
                                            ? 'Passed'
                                            : status === 'fail'
                                              ? 'Needs a fix'
                                              : status === 'manual'
                                                ? 'Buyer review'
                                                : 'Inconclusive'}
                                        </span>
                                        {r?.screenshot && (
                                          <button
                                            className="text-button"
                                            onClick={() => setEvidence(r)}
                                          >
                                            View proof
                                            <ArrowUpRight size={12} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          ) : (
                            <div className="empty-evidence">
                              <span>
                                <FileCheck2 size={26} />
                              </span>
                              <h3>Let the work speak for itself.</h3>
                              <p>
                                Submit the delivery to run {automated} browser checks.
                                <br />
                                Screenshots and observed results will appear here.
                              </p>
                            </div>
                          )}
                          <div className="verification-actions">
                            <div>
                              <strong>
                                {a.agentTask
                                  ? 'Agent delivery is verified independently'
                                  : state.demo
                                    ? 'Choose a demo delivery'
                                    : 'Verify the approved delivery'}
                              </strong>
                              <p>
                                {a.agentTask
                                  ? 'The agent submits an immutable artifact. Its agreed browser checks run outside the model.'
                                  : state.demo
                                    ? 'The first fixture has a broken booking form. The corrected one fixes it.'
                                    : 'The browser visits only operator-approved origins.'}
                              </p>
                            </div>
                            {a.agentTask ? (
                              <button
                                className="button primary"
                                onClick={() => setTab('Agent work')}
                              >
                                <Bot size={14} />
                                Open agent work
                              </button>
                            ) : (
                              <div className="button-row">
                                {state.demo && (
                                  <button
                                    className="button secondary"
                                    disabled={
                                      !!busy ||
                                      state.role !== 'developer' ||
                                      a.status !== 'active' ||
                                      a.payment.status !== 'authorized' ||
                                      run?.status === 'running' ||
                                      run?.status === 'queued'
                                    }
                                    onClick={() => verify('broken')}
                                  >
                                    <Play size={13} />
                                    Check first delivery
                                  </button>
                                )}
                                <button
                                  className="button primary"
                                  disabled={
                                    !!busy ||
                                    state.role !== 'developer' ||
                                    a.status !== 'active' ||
                                    a.payment.status !== 'authorized' ||
                                    run?.status === 'running' ||
                                    run?.status === 'queued'
                                  }
                                  onClick={() => verify('fixed')}
                                >
                                  {run ? <RefreshCw size={14} /> : <Play size={13} />}
                                  {state.demo ? 'Check corrected delivery' : 'Run verification'}
                                </button>
                              </div>
                            )}
                            {a.payment.status !== 'authorized' && a.status !== 'completed' && (
                              <p className="prerequisite">
                                Both parties must approve and the buyer must authorize payment
                                before verification.
                              </p>
                            )}
                          </div>
                          {a.runs.length > 1 && (
                            <details className="run-history">
                              <summary>Previous verification runs ({a.runs.length - 1})</summary>
                              {a.runs.slice(1).map((r) => (
                                <div key={r.id}>
                                  {date(r.createdAt)} · {time(r.createdAt)} · {r.url} ·{' '}
                                  {r.results.filter((x) => x.status === 'pass').length} passed ·{' '}
                                  {r.status}
                                </div>
                              ))}
                            </details>
                          )}
                        </>
                      )}
                      {tab === 'Agent work' && a.agentTask && (
                        <AgentWorkbench
                          a={a}
                          configured={state.aiConfigured}
                          busy={busy}
                          act={act}
                          action={action}
                          onEvidence={setEvidence}
                        />
                      )}
                      {tab === 'Activity' && (
                        <>
                          <div className="block-title">
                            <div>
                              <h3>A record everyone can follow</h3>
                              <p>Approvals, delivery evidence, and payment events.</p>
                            </div>
                            <Clock3 size={18} />
                          </div>
                          <div className="activity-list">
                            {a.events.map((e, i) => (
                              <div className="activity-item" key={e.id}>
                                <span className={'activity-icon ' + (i === 0 ? 'recent' : '')}>
                                  <Check size={12} />
                                </span>
                                <div>
                                  <strong>{e.title}</strong>
                                  {e.detail && <p>{e.detail}</p>}
                                  <span>
                                    {date(e.at)} at {time(e.at)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      {tab === 'Resolution' && (
                        <RecoveryPanel
                          a={a}
                          role={state.role}
                          busy={busy}
                          act={act}
                          action={action}
                          onReport={() => setModal('report')}
                          onEvidence={setEvidence}
                        />
                      )}
                      {tab === 'Scope changes' && (
                        <ScopePanel
                          a={a}
                          busy={busy}
                          role={state.role}
                          ai={state.aiConfigured}
                          act={act}
                          action={action}
                          onReplacement={(id) => {
                            setSelected(id);
                            setTab('Agreement');
                          }}
                        />
                      )}
                      {tab === 'Terms review' && (
                        <TermsReviewPanel
                          key={a.id}
                          a={a}
                          role={state.role}
                          ai={state.aiConfigured}
                          demo={state.demo}
                          busy={busy}
                          act={act}
                          action={action}
                          onReplacement={(id) => {
                            setSelected(id);
                            setFilter('All projects');
                            setQuery('');
                            setTab('Terms review');
                          }}
                        />
                      )}
                    </div>
                  </section>
                  <aside className="right-column">
                    <div className="payment-card">
                      <div className="card-label">
                        <span>PAYMENT SUMMARY</span>
                        <LockKeyhole size={14} />
                      </div>
                      <div className="payment-amount">
                        {money(a.amount)}
                        <span>USD</span>
                      </div>
                      <p className="payment-caption">One deliverable. One agreed price.</p>
                      <div className={'payment-state ' + a.payment.status}>
                        <span />
                        {
                          {
                            none: 'Not yet authorized',
                            created: 'Awaiting buyer authorization',
                            authorized: 'Authorized · not yet captured',
                            capture_pending: 'Awaiting PayPal confirmation',
                            captured:
                              (state.refundBalances?.[a.id]?.completed || 0) >= a.amount
                                ? 'Fully refunded'
                                : (state.refundBalances?.[a.id]?.completed || 0) > 0
                                  ? 'Partially refunded'
                                  : state.demo
                                    ? 'Simulated payment complete'
                                    : 'Sandbox payment complete',
                            voided: 'Authorization voided',
                            expired: 'Authorization expired',
                          }[a.payment.status]
                        }
                      </div>
                      <div className="payment-divider" />
                      <div className="payment-details">
                        <div>
                          <span>Payment provider</span>
                          <strong className="paypal-word">
                            PayPal <span>{state.demo ? 'Simulation' : 'Sandbox'}</span>
                          </strong>
                        </div>
                        <div>
                          <span>Agreement</span>
                          <strong>Version {a.version}.0</strong>
                        </div>
                        <div>
                          <span>Release condition</span>
                          <strong>
                            {state.paymentRules?.enabled
                              ? 'Checks + standing rules'
                              : 'Checks + buyer approval'}
                          </strong>
                        </div>
                      </div>
                      <div className="payment-condition">
                        <ShieldCheck size={20} />
                        <p>
                          {a.payment.status === 'captured'
                            ? a.payment.captureMethod === 'automatic'
                              ? 'Paid automatically within the buyer’s approved limits. The receipt is saved below.'
                              : 'The buyer approved the verified delivery. Your receipt is saved below.'
                            : state.paymentRules?.enabled
                              ? 'Qualifying deliveries can be paid automatically under the buyer’s standing rules. Exceptions return for review.'
                              : 'The buyer stays in control. Set standing rules for qualifying payments, or approve each payment yourself.'}
                        </p>
                      </div>
                      {autoDecision && state.paymentRules?.enabled && (
                        <div className={'auto-decision ' + autoDecision.outcome}>
                          <div>
                            <Zap size={13} />
                            <strong>
                              {
                                {
                                  paused: 'Auto-pay paused',
                                  review: 'Buyer attention needed',
                                  blocked: 'Auto-pay is blocked',
                                  ready: 'Ready for automatic payment',
                                  pending: 'Awaiting payment confirmation',
                                  paid:
                                    a.payment.captureMethod === 'automatic'
                                      ? 'Paid by your standing rules'
                                      : 'Payment complete',
                                }[autoDecision.outcome]
                              }
                            </strong>
                          </div>
                          <ul>
                            {autoDecision.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {a.payment.error && <p className="inline-error">{a.payment.error}</p>}
                      {state.role === 'buyer' ? (
                        <div className="payment-buttons">
                          {['none', 'voided', 'expired'].includes(a.payment.status) && (
                            <button
                              className="button primary full"
                              disabled={
                                paymentBusy ||
                                a.status !== 'active' ||
                                !a.approvals.buyer ||
                                !a.approvals.developer
                              }
                              onClick={() =>
                                act('Creating authorization', () => action('/payments/order'))
                              }
                            >
                              {state.demo
                                ? 'Start simulated authorization'
                                : 'Authorize with PayPal'}
                              <ArrowUpRight size={14} />
                            </button>
                          )}
                          {a.payment.status === 'created' && (
                            <>
                              {a.payment.approvalUrl && (
                                <a
                                  href={a.payment.approvalUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="button paypal full"
                                >
                                  Continue on PayPal
                                  <ExternalLink size={14} />
                                </a>
                              )}
                              <button
                                className="button primary full"
                                disabled={paymentBusy}
                                onClick={() =>
                                  act('Confirming authorization', () =>
                                    action('/payments/authorize'),
                                  )
                                }
                              >
                                {state.demo
                                  ? 'Confirm simulated authorization'
                                  : 'I approved · confirm authorization'}
                                <Check size={14} />
                              </button>
                            </>
                          )}
                          {['authorized', 'capture_pending'].includes(a.payment.status) && (
                            <button
                              className="button primary full"
                              disabled={paymentBusy || !ready}
                              onClick={() =>
                                act('Capturing payment', () => action('/payments/capture'))
                              }
                            >
                              {state.demo
                                ? 'Approve & simulate payment'
                                : 'Approve & capture payment'}
                              <ArrowRight size={14} />
                            </button>
                          )}
                          {a.payment.mode === 'sandbox' && a.payment.orderId && (
                            <button
                              className="text-button"
                              disabled={paymentBusy}
                              onClick={() =>
                                act('Reconciling payment', () => action('/payments/reconcile'))
                              }
                            >
                              <RefreshCw size={12} />
                              Reconcile with PayPal
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="buyer-reminder">
                          <LockKeyhole size={13} />
                          The buyer controls authorization and standing payment rules.
                        </div>
                      )}
                      {a.payment.captureId && (
                        <div className="receipt">
                          <Receipt size={17} />
                          <div>
                            <strong>{state.demo ? 'Simulated receipt' : 'Sandbox receipt'}</strong>
                            {a.payment.captureMethod === 'automatic' && (
                              <span className="receipt-auto">
                                <Zap size={10} />
                                Automatic · rules v{a.payment.ruleVersion}
                              </span>
                            )}
                            <span>{a.payment.captureId}</span>
                            {run?.artifactSha256 && (
                              <span>Artifact {run.artifactSha256.slice(0, 16)}…</span>
                            )}
                            <span>
                              {money(a.amount)} USD · {a.payment.status}
                            </span>
                          </div>
                          <button
                            aria-label="Copy receipt ID"
                            onClick={() => {
                              void navigator.clipboard.writeText(a.payment.captureId!);
                              setNotice('Receipt ID copied.');
                            }}
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      )}
                      {(state.refundBalances?.[a.id]?.completed || 0) > 0 && (
                        <div className="refund-receipt-summary">
                          <Undo2 size={16} />
                          <span>
                            {money(state.refundBalances[a.id].completed)} refund confirmed ·{' '}
                            {money(a.amount - state.refundBalances[a.id].completed)} not refunded
                          </span>
                        </div>
                      )}
                      {['created', 'authorized', 'capture_pending', 'captured'].includes(
                        a.payment.status,
                      ) && (
                        <div className="receipt-support">
                          {state.role === 'buyer' &&
                            (state.refundBalances?.[a.id]?.completed || 0) < a.amount && (
                              <button
                                className="text-button"
                                disabled={!!busy}
                                onClick={() => {
                                  if (
                                    a.cases?.some((c) =>
                                      [
                                        'requested',
                                        'under_review',
                                        'refund_pending',
                                        'partially_refunded',
                                      ].includes(c.status),
                                    )
                                  )
                                    setTab('Resolution');
                                  else setModal('report');
                                }}
                              >
                                <ShieldAlert size={14} />
                                {a.cases?.some((c) =>
                                  [
                                    'requested',
                                    'under_review',
                                    'refund_pending',
                                    'partially_refunded',
                                  ].includes(c.status),
                                )
                                  ? 'View your support case'
                                  : 'Report a problem'}
                              </button>
                            )}
                          {Boolean(a.cases?.length) && (
                            <button className="text-button" onClick={() => setTab('Resolution')}>
                              Support cases ({a.cases!.length})<ArrowUpRight size={12} />
                            </button>
                          )}
                        </div>
                      )}
                      <div className="sandbox-note">
                        <span className="tiny-dot" />
                        {state.demo
                          ? 'Walkthrough only. No money moves.'
                          : 'Sandbox only. No production funds.'}
                      </div>
                    </div>
                    <div className="standing-rules-card">
                      <div className="rules-heading">
                        <span className="rules-symbol">
                          <Zap size={17} />
                        </span>
                        <div>
                          <strong>Standing payment rules</strong>
                          <span>Human attention, only when needed.</span>
                        </div>
                        <span
                          className={
                            'rules-state ' +
                            (state.recoveryPause
                              ? 'safety'
                              : state.paymentRules?.enabled
                                ? 'on'
                                : '')
                          }
                        >
                          {state.recoveryPause
                            ? 'Safety pause'
                            : state.paymentRules?.enabled
                              ? 'On'
                              : 'Paused'}
                        </span>
                      </div>
                      <div className="rules-limits">
                        <div>
                          <span>Per payment</span>
                          <strong>{money(state.paymentRules?.perPaymentLimit || 15000)}</strong>
                        </div>
                        <div>
                          <span>Monthly budget</span>
                          <strong>{money(state.paymentRules?.monthlyLimit || 50000)}</strong>
                        </div>
                      </div>
                      <div
                        className="budget-track"
                        role="progressbar"
                        aria-label="Monthly payment budget used"
                        aria-valuemin={0}
                        aria-valuemax={state.paymentBudget?.limit || 50000}
                        aria-valuenow={Math.min(
                          state.paymentBudget?.total || 0,
                          state.paymentBudget?.limit || 50000,
                        )}
                      >
                        <span
                          style={{
                            width: `${Math.min(100, ((state.paymentBudget?.total || 0) / (state.paymentBudget?.limit || 50000)) * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="budget-description">
                        {money(state.paymentBudget?.spent || 0)} paid
                        {state.paymentBudget?.reserved
                          ? ` + ${money(state.paymentBudget.reserved)} pending`
                          : ''}{' '}
                        · {state.paymentBudget?.month} (UTC)
                      </p>
                      <p className="rules-explainer">
                        Only existing authorizations. Failed checks, human-review criteria, and new
                        scope return for attention.
                      </p>
                      {state.role === 'buyer' ? (
                        <div className="rules-buttons">
                          <button
                            className="button secondary small-button"
                            disabled={!!busy || Boolean(state.recoveryPause)}
                            onClick={() => setModal('rules')}
                          >
                            {state.paymentRules?.enabled ? 'Edit limits' : 'Set payment rules'}
                            <Settings size={12} />
                          </button>
                          {state.paymentRules?.enabled && (
                            <button
                              className="text-button"
                              disabled={!!busy}
                              onClick={() =>
                                act('Pausing automatic payments', () =>
                                  api(
                                    '/payment-rules',
                                    {
                                      enabled: false,
                                      perPaymentLimit: state.paymentRules.perPaymentLimit,
                                      monthlyLimit: state.paymentRules.monthlyLimit,
                                      confirmAutomaticCapture: false,
                                    },
                                    'PUT',
                                  ),
                                )
                              }
                            >
                              <Pause size={12} />
                              Pause
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="rules-readonly">
                          <LockKeyhole size={11} />
                          Only the buyer can enable or change rules.
                        </span>
                      )}
                      <p className="rules-disclosure">
                        Pausing stops new captures. A payment already dispatched cannot be recalled.
                      </p>
                    </div>
                    <div className="trust-card">
                      <div className="trust-top">
                        <span className="trust-icon">
                          <ShieldCheck size={22} />
                        </span>
                        <span className="eyebrow">CLARITY IS THE CONTRACT</span>
                      </div>
                      <h3>
                        No moving
                        <br />
                        finish lines.
                      </h3>
                      <p>
                        New requests deserve a new agreement. Your approved checks stay exactly as
                        agreed.
                      </p>
                      <button className="text-button" onClick={() => setTab('Scope changes')}>
                        Check a scope request
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                    {state.demo && (
                      <div className="demo-card">
                        <span className="eyebrow">YOUR PRIVATE WALKTHROUGH</span>
                        <p>
                          Try both sides of the agreement. Each visitor gets a separate workspace.
                        </p>
                        <div className="role-toggle">
                          <button
                            className={state.role === 'developer' ? 'active' : ''}
                            disabled={!!busy}
                            onClick={() => switchRole('developer')}
                          >
                            Business
                          </button>
                          <button
                            className={state.role === 'buyer' ? 'active' : ''}
                            disabled={!!busy}
                            onClick={() => switchRole('buyer')}
                          >
                            Buyer
                          </button>
                        </div>
                        <button className="text-button" onClick={() => launchGuide()}>
                          Open the guided demo
                          <ArrowRight size={13} />
                        </button>
                        {state.role === 'developer' && (
                          <button
                            className="text-button routine-demo"
                            disabled={!!busy}
                            onClick={() =>
                              act('Preparing routine-update example', async () => {
                                const result = await api('/demo/routine-project', {});
                                setSelected(result.id);
                                setFilter('All projects');
                                setQuery('');
                                setTab('Agreement');
                              })
                            }
                          >
                            Try an objective-only update
                            <Zap size={12} />
                          </button>
                        )}
                      </div>
                    )}
                    {state.role === 'buyer' &&
                      ['active', 'draft'].includes(a.status) &&
                      !['captured', 'capture_pending', 'voided'].includes(a.payment.status) && (
                        <div className="cancel-actions">
                          <button
                            disabled={paymentBusy}
                            onClick={() => {
                              if (
                                confirm(
                                  'Void this authorization? Funds will not be captured. A replacement agreement will need fresh approval.',
                                )
                              )
                                void act('Voiding authorization', () => action('/payments/void'));
                            }}
                          >
                            Void authorization
                          </button>
                          <button
                            disabled={paymentBusy}
                            onClick={() => {
                              if (confirm('Cancel this agreement and void any authorization?'))
                                void act('Cancelling agreement', () => action('/payments/cancel'));
                            }}
                          >
                            Cancel agreement
                          </button>
                        </div>
                      )}
                  </aside>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Mark small />A little proof goes a long way.
            </span>
            <span>
              Made for work worth paying for.<span className="footer-dot">·</span>
              <button onClick={() => setModal('help')}>
                How it works
                <ArrowUpRight size={11} />
              </button>
            </span>
          </footer>
        </div>
      </main>
      {busy && (
        <div className="busy-indicator" role="status">
          <Loader2 size={15} className="spin" />
          {busy}…
        </div>
      )}
      {modal === 'help' && (
        <Modal title="One story. From agreement to receipt." onClose={() => setModal(null)} wide>
          <p className="modal-intro">
            A café’s booking form looks ready, but fails the agreed test. ProofPay records the
            failure, verifies the correction, and pays within the buyer’s approved limits.
          </p>
          <div className="guide-story-cards">
            <div>
              <span>01</span>
              <strong>Agree</strong>
              <p>A fixed price and five observable checks.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Prove</strong>
              <p>An actual browser exposes the failure and tests the correction.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Pay</strong>
              <p>Approved rules determine whether a delivery earns payment.</p>
            </div>
          </div>
          <p className="quiet">
            The interactive guide uses authored website fixtures and simulated payments.
            Model-backed agent work is available separately when AI is configured.
          </p>
          {state?.demo ? (
            <button className="button primary" disabled={!!busy} onClick={() => launchGuide()}>
              {state.walkthrough ? 'Resume interactive demo' : 'Start interactive demo'}
              <ArrowRight size={15} />
            </button>
          ) : (
            <button className="button primary" onClick={() => setModal(null)}>
              Return to merchant workspace
              <ArrowRight size={15} />
            </button>
          )}
        </Modal>
      )}
      {modal === 'report' && a && (
        <Modal title="Let’s make this right." onClose={() => setModal(null)}>
          <ReportProblemModal
            a={a}
            busy={busy}
            error={error}
            onClose={() => setModal(null)}
            onSubmit={(body) =>
              act('Opening support case', async () => {
                await action('/cases', body);
                setTab('Resolution');
                setModal(null);
                setNotice('Your case is open. New automatic captures are paused.');
              })
            }
          />
        </Modal>
      )}
      {modal === 'agentTask' && (
        <AgentTaskModal
          busy={busy}
          onClose={() => setModal(null)}
          onCreate={(amount) =>
            act('Commissioning agent task', async () => {
              const created = await api('/agent-tasks', { amount });
              setSelected(created.id);
              setFilter('All projects');
              setQuery('');
              setTab('Agreement');
              setModal(null);
            })
          }
        />
      )}
      {modal === 'rules' && state && (
        <PaymentRulesModal
          rules={state.paymentRules}
          demo={state.demo}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={(data) =>
            act('Saving standing payment rules', async () => {
              await api('/payment-rules', data, 'PUT');
              setModal(null);
              setNotice(
                data.enabled
                  ? 'Standing rules enabled. Qualifying authorized payments can now be captured automatically.'
                  : 'Automatic payments paused.',
              );
            })
          }
        />
      )}
      {modal === 'connect' && (
        <ConnectModal state={state} act={act} onClose={() => setModal(null)} />
      )}
      {(modal === 'new' || modal === 'edit') && (
        <AgreementModal
          a={modal === 'edit' ? a : undefined}
          ai={state?.aiConfigured || false}
          onClose={() => setModal(null)}
          busy={busy}
          onSave={(data) =>
            act('Saving agreement', async () => {
              if (modal === 'edit') {
                await api(
                  `/agreements/${a!.id}`,
                  { criteria: data.criteria, brief: data.brief },
                  'PATCH',
                );
              } else {
                const result = await api('/agreements', data);
                setFilter('All projects');
                setQuery('');
                setSelected(result.id);
              }
              setTab('Agreement');
              setModal(null);
            })
          }
        />
      )}
      {guideOpen && state?.demo && state.walkthrough && (
        <GuidedWalkthrough
          key={state.id}
          workspace={state}
          busy={busy}
          error={error}
          act={act}
          call={api}
          ai={state.aiConfigured}
          onClose={() => setGuideOpen(false)}
          onRestart={() => launchGuide(true)}
          obscured={Boolean(evidence)}
          onEvidence={setEvidence}
          onExplore={(id, nextTab) => {
            setGuideTarget(id);
            setSelected(id);
            setFilter('All projects');
            setQuery('');
            setTab(nextTab);
            setGuideOpen(false);
          }}
          onReport={() => {
            setSelected(state.walkthrough!.agreementId);
            setFilter('All projects');
            setQuery('');
            setGuideOpen(false);
            setModal('report');
          }}
          onAgent={() => {
            setGuideOpen(false);
            setModal('agentTask');
          }}
        />
      )}
      {evidence && (
        <Modal title="The proof behind the result" onClose={() => setEvidence(null)} wide>
          <div className={'evidence-verdict ' + evidence.status}>
            {evidence.status === 'pass' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <p>{evidence.observed}</p>
          </div>
          <img
            className="evidence-image"
            src={evidence.screenshot}
            alt="Browser screenshot captured while executing the agreed check"
          />
          <p className="quiet">
            Captured by the browser runner · {(evidence.durationMs / 1000).toFixed(1)}s check ·
            Bound to agreement v{a?.version}
          </p>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        <span>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <p>{sub}</p>
    </div>
  );
}
function AgentTaskModal({
  busy,
  onClose,
  onCreate,
}: {
  busy: string;
  onClose: () => void;
  onCreate: (amount: number) => void;
}) {
  const [price, setPrice] = useState('75');
  return (
    <Modal title="Pay for the result. Not the promise." onClose={onClose}>
      <p className="modal-intro">
        Commission a bounded AI repair agent to fix the fictional café’s booking submit handler. The
        agent writes a real patch; an independent browser decides whether the five agreed checks
        pass.
      </p>
      <div className="agent-contract">
        <Bot size={22} />
        <div>
          <strong>Booking flow repair</strong>
          <p>
            Preserve headline, menu link, required fields, successful test reservation, and mobile
            layout. One seller operates the agent.
          </p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(Math.round(Number(price) * 100));
        }}
      >
        <label className="form-label">
          Fixed task price (USD)
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
        <div className="info-box">
          <LockKeyhole size={18} />
          <p>
            Both parties still approve the checks, and the buyer authorizes payment. Standing rules
            can capture a qualifying delivery automatically. No AI key means no agent run; it never
            substitutes the prewritten fixed fixture.
          </p>
        </div>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={!!busy || !Number.isFinite(Number(price)) || Number(price) < 1}
          >
            <Bot size={14} />
            Create agent task
          </button>
        </div>
      </form>
    </Modal>
  );
}
function AgentWorkbench({
  a,
  configured,
  busy,
  act,
  action,
  onEvidence,
}: {
  a: Agreement;
  configured: boolean;
  busy: string;
  act: (label: string, fn: () => Promise<any>) => Promise<void>;
  action: (suffix: string, body?: unknown) => Promise<any>;
  onEvidence: (r: Result) => void;
}) {
  const agent = a.agentRuns?.[0],
    running = agent?.status === 'queued' || agent?.status === 'running';
  const ready =
    a.status === 'active' &&
    Boolean(a.approvals.buyer && a.approvals.developer) &&
    a.payment.status === 'authorized';
  return (
    <>
      <div className="block-title">
        <div>
          <h3>An agent does the work. Evidence earns payment.</h3>
          <p>Inspect source → write patch → verify independently → submit.</p>
        </div>
        <Bot size={20} />
      </div>
      <div className="agent-authority">
        <LockKeyhole size={18} />
        <p>
          The agent can edit one booking handler. It cannot change the price, acceptance checks,
          payment rules, or authorization.
        </p>
      </div>
      <div className="agent-launch">
        <div>
          <span className="eyebrow">BOUNDED REPAIR AGENT</span>
          <h3>
            {running
              ? 'Working toward a provable result…'
              : agent?.status === 'completed'
                ? 'A verified artifact, ready for its receipt.'
                : 'A real repair, with a clear finish line.'}
          </h3>
          <p>
            Up to two model-written patches, each tested by a separate browser. No shell commands or
            server-side code execution.
          </p>
        </div>
        <button
          className="button primary"
          disabled={!!busy || running || !configured || !ready}
          onClick={() => act('Starting repair agent', () => action('/agent/start'))}
        >
          {running ? <Loader2 size={15} className="spin" /> : <Bot size={15} />}
          {running ? 'Agent running' : agent ? 'Retry repair agent' : 'Run repair agent'}
        </button>
      </div>
      {!configured && (
        <div className="alert agent-key-note">
          <AlertCircle size={17} />
          <span>
            AI is not connected. Configure OPENAI_API_KEY to run this agent. The existing fixture
            walkthrough remains available; no agent delivery is being simulated.
          </span>
        </div>
      )}
      {!ready && !running && a.status !== 'completed' && (
        <p className="prerequisite">
          Both parties must approve this task and the buyer must authorize its payment before the
          agent starts.
        </p>
      )}
      {agent && (
        <>
          <div className="agent-run-meta">
            <span>{agent.model || 'Model not called yet'}</span>
            <span>
              {agent.status} · {date(agent.createdAt)}
            </span>
          </div>
          {agent.error && (
            <div className="alert error">
              <AlertCircle size={16} />
              <span>{agent.error}</span>
            </div>
          )}
          <div className="agent-tool-log">
            {agent.steps.map((step, i) => (
              <div key={i}>
                <span className="agent-tool-number">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{step.tool.replaceAll('_', ' ')}</strong>
                  <p>{step.detail}</p>
                  <span>{time(step.at)}</span>
                </div>
              </div>
            ))}
          </div>
          {agent.attempts.map((attempt, i) => (
            <div className="agent-attempt" key={attempt.artifactId}>
              <div className="agent-attempt-heading">
                <Code2 size={16} />
                <strong>Patch {i + 1}</strong>
                <span>
                  {attempt.results.filter((r) => r.status === 'pass').length}/
                  {a.criteria.filter((c) => c.type !== 'manual').length} browser checks passed
                </span>
              </div>
              <p>{attempt.explanation}</p>
              <code className="artifact-digest">SHA-256 {attempt.sha256}</code>
              <details>
                <summary>Inspect agent-written handler</summary>
                <pre>{attempt.handler}</pre>
              </details>
              <div className="agent-attempt-proofs">
                {attempt.results
                  .filter((r) => r.screenshot)
                  .map((r) => (
                    <button
                      key={r.criterionId}
                      className="text-button"
                      onClick={() => onEvidence(r)}
                    >
                      {r.criterionId}: {r.status}
                      <ArrowUpRight size={11} />
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {agent.artifactId && (
            <div className="agent-submitted">
              <CheckCircle2 size={17} />
              <div>
                <strong>Verified artifact submitted</strong>
                <p>
                  The receipt references the same immutable source digest checked by the browser.
                </p>
                <a
                  className="text-button"
                  href={`/fixtures/agent/${agent.artifactId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open agent delivery
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
function PaymentRulesModal({
  rules,
  demo,
  busy,
  onClose,
  onSave,
}: {
  rules: PaymentRules;
  demo: boolean;
  busy: string;
  onClose: () => void;
  onSave: (data: any) => void;
}) {
  const [perPayment, setPerPayment] = useState(String(rules.perPaymentLimit / 100)),
    [monthly, setMonthly] = useState(String(rules.monthlyLimit / 100)),
    [consent, setConsent] = useState(false);
  const per = Math.round(Number(perPayment) * 100),
    cap = Math.round(Number(monthly) * 100);
  return (
    <Modal title="Approve the boundaries. Skip the busywork." onClose={onClose}>
      <p className="modal-intro">
        Allow automatic {demo ? 'simulated payments' : 'PayPal sandbox captures'} in this workspace
        when both parties approve the agreement, the required checks pass, and an existing buyer
        authorization covers the payment.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            enabled: true,
            perPaymentLimit: per,
            monthlyLimit: cap,
            confirmAutomaticCapture: consent,
          });
        }}
      >
        <div className="form-grid">
          <label>
            Maximum per payment (USD)
            <input
              required
              type="number"
              min="1"
              max="10000"
              step="0.01"
              value={perPayment}
              onChange={(e) => setPerPayment(e.target.value)}
            />
          </label>
          <label>
            Monthly budget (USD)
            <input
              required
              type="number"
              min={Number(perPayment) || 1}
              max="100000"
              step="0.01"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
          </label>
        </div>
        <div className="info-box">
          <ShieldCheck size={19} />
          <p>
            Required human reviews, new scope requests, failed or inconclusive checks, and limit
            exceptions stay with the buyer. Every pending capture reserves its full amount. All
            completed payments count toward the UTC calendar-month budget, including manually
            approved ones.
          </p>
        </div>
        <label className="rules-consent">
          <input
            required
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            I allow ProofPay to capture qualifying, already-authorized{' '}
            {demo ? 'simulated' : 'sandbox'} payments without asking me again for each capture.
          </span>
        </label>
        <p className="quiet">
          Applies to the single configured seller and agreements approved in this workspace. This
          does not authorize new charges or subscriptions. Pausing cannot undo an already-dispatched
          capture.
        </p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={
              !!busy ||
              !consent ||
              !Number.isFinite(per) ||
              !Number.isFinite(cap) ||
              per < 100 ||
              cap < per
            }
          >
            <Zap size={14} />
            {rules.enabled ? 'Save & authorize updated rules' : 'Enable automatic payments'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openerRef = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const opener = openerRef.current;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        const nodes = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    const prior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prior;
      if (
        document.activeElement === document.body ||
        dialogRef.current?.contains(document.activeElement)
      )
        opener?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={'modal ' + (wide ? 'wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">PROOFPAY WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <button autoFocus className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function ScopePanel({
  a,
  busy,
  role,
  ai,
  act,
  action,
  onReplacement,
}: {
  a: Agreement;
  busy: string;
  role: Role;
  ai: boolean;
  act: (label: string, fn: () => Promise<any>) => Promise<void>;
  action: (suffix: string, body?: unknown) => Promise<any>;
  onReplacement: (id: string) => void;
}) {
  const [request, setRequest] = useState(
      a.scope?.request || 'Could we also add a loyalty rewards program?',
    ),
    [price, setPrice] = useState(String(a.amount / 100 + 50));
  return (
    <>
      <div className="block-title">
        <div>
          <h3>Keep the finish line where you agreed.</h3>
          <p>Compare a new request with the approved work.</p>
        </div>
        <ShieldCheck size={19} />
      </div>
      <label className="field-label" htmlFor="scope-request">
        THE NEW REQUEST
      </label>
      <textarea
        id="scope-request"
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        rows={4}
      />
      <div className="scope-submit">
        <span className="quiet">
          {ai
            ? 'AI advice. Both parties make the decision.'
            : 'AI not connected · manual review fallback'}
        </span>
        <button
          className="button primary"
          disabled={!!busy || request.trim().length < 10 || !['draft', 'active'].includes(a.status)}
          onClick={() => act('Comparing scope', () => action('/scope', { request }))}
        >
          <Sparkles size={15} />
          Compare with agreement
        </button>
      </div>
      {a.scope && (
        <div className="scope-result">
          <span className={'scope-verdict ' + a.scope.verdict}>
            {a.scope.verdict === 'additional'
              ? 'Additional scope'
              : a.scope.verdict === 'included'
                ? 'Included in agreement'
                : 'Needs human review'}
          </span>
          <h3>
            {a.scope.verdict === 'additional'
              ? 'A new request deserves a new agreement.'
              : a.scope.verdict === 'included'
                ? 'This request appears to be covered.'
                : 'Let’s clarify this together.'}
          </h3>
          <p>{a.scope.explanation}</p>
          <div className="scope-original">
            <LockKeyhole size={15} />
            Your approved agreement has not changed.
          </div>
          {role === 'buyer' && a.status === 'active' && (
            <div className="scope-buyer-decision">
              {a.scope.resolvedAt ? (
                <p>
                  <CheckCircle2 size={14} />
                  You kept the original scope. The new request is excluded from this agreement.
                </p>
              ) : (
                <>
                  <p>
                    Automatic payment is paused for this request. Keep the original scope to resume
                    its standing rules, or ask for a replacement agreement.
                  </p>
                  <button
                    className="button secondary"
                    disabled={!!busy || a.scope.source === 'pending' || !a.scope.id}
                    onClick={() =>
                      act('Confirming original scope', () =>
                        action('/scope/resolve', { scopeId: a.scope!.id }),
                      )
                    }
                  >
                    Keep original scope & resume rules
                    <ArrowRight size={13} />
                  </button>
                </>
              )}
            </div>
          )}
          {role === 'developer' && (
            <div className="replacement">
              <label>
                Replacement total (USD)
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <p>
                Creates a new draft with the existing checks plus a manual criterion for this
                request. Review and edit it before both parties approve.
              </p>
              <button
                className="button secondary"
                disabled={
                  !!busy ||
                  a.payment.status !== 'voided' ||
                  !Number.isFinite(Number(price)) ||
                  Number(price) < 1
                }
                onClick={() =>
                  act('Creating replacement', async () => {
                    const result = await action('/replacement', {
                      amount: Math.round(Number(price) * 100),
                      criteria: [
                        ...a.criteria,
                        {
                          id: 'scope-' + Date.now(),
                          title: a.scope!.request.slice(0, 150),
                          type: 'manual',
                          selector: '',
                          expected: a.scope!.request.slice(0, 500),
                          required: true,
                        },
                      ],
                    });
                    onReplacement(result.id);
                  })
                }
              >
                Draft replacement agreement
                <ArrowRight size={14} />
              </button>
              {a.payment.status !== 'voided' && (
                <p className="prerequisite">
                  The buyer must void the existing authorization first.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
function ConnectModal({
  state,
  act,
  onClose,
}: {
  state: State | null;
  act: (label: string, fn: () => Promise<any>) => Promise<void>;
  onClose: () => void;
}) {
  const [invite, setInvite] = useState('');
  return (
    <Modal title="Connections & access" onClose={onClose}>
      <div className="connection">
        <span>PayPal sandbox</span>
        <strong>{state?.paypalConfigured ? 'Configured' : 'Credentials needed'}</strong>
      </div>
      <div className="connection">
        <span>AI criteria & summaries</span>
        <strong>{state?.aiConfigured ? 'Configured' : 'Template fallback'}</strong>
      </div>
      <p className="modal-intro">
        Service credentials belong in the server environment. Never paste API keys into a project or
        public repository.
      </p>
      <label className="field-label" htmlFor="invite">
        PRIVATE WORKSPACE INVITATION
      </label>
      <input
        type="password"
        id="invite"
        value={invite}
        onChange={(e) => setInvite(e.target.value)}
        placeholder="Buyer or developer invitation"
        autoComplete="off"
      />
      <p className="quiet">
        Invitations open the shared merchant sandbox workspace with a fixed role. Walkthrough
        visitors cannot access it.
      </p>
      <button
        className="button primary"
        disabled={invite.length < 32}
        onClick={() =>
          act('Opening private workspace', async () => {
            await api('/session', { invite });
            onClose();
          })
        }
      >
        Open invited workspace
        <ArrowRight size={15} />
      </button>
    </Modal>
  );
}
function AgreementModal({
  a,
  ai,
  busy,
  onClose,
  onSave,
}: {
  a?: Agreement;
  ai: boolean;
  busy: string;
  onClose: () => void;
  onSave: (data: any) => void;
}) {
  const [title, setTitle] = useState(a?.title || ''),
    [client, setClient] = useState(a?.client || ''),
    [brief, setBrief] = useState(a?.brief || ''),
    [amount, setAmount] = useState(String((a?.amount || 15000) / 100)),
    [url, setUrl] = useState(a?.deliveryUrl || ''),
    [due, setDue] = useState(
      new Date(Date.now() + 48 * 3600000 - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16),
    ),
    [criteria, setCriteria] = useState<Criterion[]>(a?.criteria || []),
    [generating, setGenerating] = useState(false),
    [message, setMessage] = useState('');
  async function suggest() {
    setGenerating(true);
    setMessage('');
    try {
      const result = await api('/ai/criteria', { brief });
      setCriteria(result.criteria);
      setMessage(result.note);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setGenerating(false);
    }
  }
  return (
    <Modal
      title={a ? 'Make the checks unmistakable.' : 'Start with a clear agreement.'}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!criteria.length) {
            setMessage('Add at least one acceptance check.');
            return;
          }
          onSave({
            title,
            client,
            brief,
            amount: Math.round(Number(amount) * 100),
            deliveryUrl: url,
            dueAt: new Date(due).toISOString(),
            criteria,
          });
        }}
      >
        {!a && (
          <>
            <div className="form-grid">
              <label>
                Project title
                <input
                  required
                  minLength={3}
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A fresh start for…"
                />
              </label>
              <label>
                Client name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  placeholder="Client or business"
                />
              </label>
              <label>
                Fixed price (USD)
                <input
                  required
                  type="number"
                  min="1"
                  max="10000"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Due within 72 hours
                <input
                  required
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
            </div>
            <label className="form-label">
              Approved website URL
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-approved-demo.example"
              />
            </label>
            <p className="quiet">
              The operator must allow this website origin before it can be verified.
            </p>
          </>
        )}
        <label className="form-label">
          The brief
          <textarea
            required
            minLength={20}
            maxLength={6000}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            placeholder="Describe the result, the required behavior, and the visual direction…"
          />
        </label>
        <div className="criteria-toolbar">
          <h3>
            Acceptance checks <span>{criteria.length}</span>
          </h3>
          <button
            type="button"
            className="button secondary small-button"
            disabled={generating || brief.length < 20}
            onClick={suggest}
          >
            {generating ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            {ai ? 'Suggest with AI' : 'Load café template'}
          </button>
        </div>
        {message && (
          <div className="info-box">
            <AlertCircle size={17} />
            <p>{message}</p>
          </div>
        )}
        <div className="edit-criteria">
          {criteria.map((c, i) => (
            <div className="edit-check" key={c.id}>
              <div>
                <span className="criterion-number">{i + 1}</span>
                <input
                  aria-label={`Check ${i + 1} title`}
                  required
                  minLength={3}
                  maxLength={160}
                  value={c.title}
                  onChange={(e) =>
                    setCriteria((cs) =>
                      cs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove check ${i + 1}`}
                  onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="check-fields">
                <label>
                  Check type
                  <select
                    value={c.type}
                    onChange={(e) =>
                      setCriteria((cs) =>
                        cs.map((x, j) =>
                          j === i ? { ...x, type: e.target.value as Criterion['type'] } : x,
                        ),
                      )
                    }
                  >
                    {['text', 'link', 'required', 'form', 'mobile', 'manual'].map((t) => (
                      <option key={t} value={t}>
                        {t === 'manual' ? 'Human review' : t}
                      </option>
                    ))}
                  </select>
                </label>
                {c.type !== 'manual' && (
                  <label>
                    CSS selector
                    <input
                      maxLength={200}
                      value={c.selector}
                      onChange={(e) =>
                        setCriteria((cs) =>
                          cs.map((x, j) => (j === i ? { ...x, selector: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                )}
                <label>
                  Expected result
                  <input
                    maxLength={500}
                    value={c.expected}
                    onChange={(e) =>
                      setCriteria((cs) =>
                        cs.map((x, j) => (j === i ? { ...x, expected: e.target.value } : x)),
                      )
                    }
                  />
                </label>
              </div>
              <label className="manual-checkbox">
                <input
                  type="checkbox"
                  checked={c.required}
                  onChange={(e) =>
                    setCriteria((cs) =>
                      cs.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)),
                    )
                  }
                />
                Required for payment
              </label>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="text-button"
          disabled={criteria.length >= 12}
          onClick={() =>
            setCriteria((cs) => [
              ...cs,
              {
                id: crypto.randomUUID(),
                title: 'New acceptance criterion',
                type: 'manual',
                selector: '',
                expected: 'Describe what the buyer will review.',
                required: true,
              },
            ])
          }
        >
          <Plus size={14} />
          Add a check
        </button>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!!busy || generating || criteria.length === 0}
            type="submit"
          >
            {a ? 'Save new version' : 'Create agreement'}
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
