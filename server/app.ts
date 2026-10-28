import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { query, createWorkspace, getWorkspace, mutate } from './db.js';
import {
  seedWorkspace,
  agreementInput,
  criterionSchema,
  AppError,
  ensure,
  event,
  eligible,
  type Role,
  type Workspace,
} from './domain.js';
import {
  find,
  editable,
  approve,
  createAuthorization,
  confirmAuthorization,
  capture,
  settleAutomaticPayments,
  voidAuthorization,
  reconcile,
  idle,
} from './service.js';
import { propose, compareScope } from './ai.js';
import { paypalConfigured, verifyWebhook } from './paypal.js';
import { safeUrl } from './verifier.js';
import { cafeHtml } from './fixtures.js';
import {
  proposeChange,
  decideChange,
  reviewChange,
  changeMessage,
  withdrawChange,
} from './changes.js';
import { artifactHeaders } from './agent.js';
import {
  paymentRulesInput,
  rulesFor,
  monthlyBudget,
  evaluateAutomaticPayment,
} from './automation.js';
import {
  reportInput,
  refundInput,
  reportProblem,
  addCaseMessage,
  reviewCase,
  buyerCaseDecision,
  issueRefund,
  retryRefund,
  reconcileRefund,
  resumeAfterRecovery,
  refundTotals,
  findCase,
} from './recovery.js';
type Session = { workspace_id: string; role: Role; demo: boolean };
type Authed = Request & { auth: Session };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const handle =
  (fn: (req: any, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(fn(req, res)).catch(next);
  };
function role(req: Authed, r: Role) {
  ensure(req.auth.role === r, `Only the ${r} can do this.`, 403);
}
async function session(res: Response, w: Workspace, r: Role) {
  const token = randomBytes(32).toString('hex');
  await query(
    "INSERT INTO sessions(token_hash,workspace_id,role,demo,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')",
    [hash(token), w.id, r, w.demo],
  );
  res.cookie('proofpay_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.APP_URL?.startsWith('https:') || false,
    maxAge: 7 * 86400000,
    path: '/',
  });
}
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          frameSrc: ["'self'"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.get(
    '/api/health',
    handle(async (_req, res) => {
      await query('SELECT 1');
      res.json({ ok: true });
    }),
  );
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path !== '/paypal/webhook') {
      const origin = req.headers.origin;
      const allowed = new Set([process.env.APP_URL || 'http://localhost:5173']);
      if (process.env.NODE_ENV !== 'production')
        for (const host of ['localhost', '127.0.0.1'])
          for (const port of [5173, Number(process.env.PORT || 3001)])
            allowed.add(`http://${host}:${port}`);
      if (origin && !allowed.has(origin))
        return res.status(403).json({ error: 'Request origin is not allowed.' });
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
      if (!req.is('application/json'))
        return res.status(415).json({ error: 'Use application/json.' });
    }
    next();
  });
  app.get('/api/config', (_req, res) =>
    res.json({
      paypalConfigured: paypalConfigured(),
      aiConfigured: Boolean(process.env.OPENAI_API_KEY),
      allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    }),
  );
  app.post(
    '/api/session',
    rateLimit({ windowMs: 3600000, limit: 30, legacyHeaders: false }),
    handle(async (req, res) => {
      const { invite } = z.object({ invite: z.string().max(256).optional() }).parse(req.body);
      if (!invite) {
        const w = seedWorkspace(randomUUID(), true);
        await createWorkspace(w);
        await session(res, w, 'developer');
        res.json({ ok: true });
        return;
      }
      const dev = process.env.DEVELOPER_INVITE || '',
        buyer = process.env.BUYER_INVITE || '';
      ensure(
        dev.length >= 32 && buyer.length >= 32 && dev !== buyer,
        'Real workspace invites have not been configured.',
        503,
      );
      const r: Role | undefined = equal(invite, dev)
        ? 'developer'
        : equal(invite, buyer)
          ? 'buyer'
          : undefined;
      ensure(r, 'Invalid invitation.', 401);
      let w: Workspace;
      try {
        w = await getWorkspace('merchant');
      } catch (err) {
        if (!(err instanceof AppError) || err.status !== 404) throw err;
        w = seedWorkspace('merchant', false);
        w.agreements = [];
        await query('INSERT INTO workspaces(id,body) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [
          w.id,
          JSON.stringify(w),
        ]);
      }
      await session(res, w, r);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/paypal/webhook',
    handle(async (req, res) => {
      await verifyWebhook(req.headers, req.body);
      const body = req.body;
      ensure(typeof body.id === 'string', 'Invalid webhook.', 400);
      await query('INSERT INTO webhook_events(id,body) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [
        body.id,
        JSON.stringify(body),
      ]);
      const existing = await query('SELECT processed FROM webhook_events WHERE id=$1', [body.id]);
      if (existing.rows[0]?.processed) {
        res.json({ ok: true });
        return;
      }
      const order = body.resource?.supplementary_data?.related_ids?.order_id;
      const authId = body.resource?.id;
      const workspaces = await query<{ id: string; body: Workspace }>(
        `SELECT id,body FROM workspaces WHERE body->>'demo'='false'`,
      );
      for (const w of workspaces.rows)
        for (const a of w.body.agreements) {
          const trackedRefund = a.payment.refunds?.find((r) => r.providerId === body.resource?.id);
          if (trackedRefund && String(body.event_type).includes('REFUND')) {
            await reconcileRefund(w.id, a.id, trackedRefund.caseId, trackedRefund.id);
            continue;
          }

          if (
            (order && a.payment.orderId === order) ||
            (authId && a.payment.authorizationId === authId)
          )
            await reconcile(w.id, a.id);
        }
      await query('UPDATE webhook_events SET processed=true WHERE id=$1', [body.id]);
      res.json({ ok: true });
    }),
  );
  app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
    const authenticate = async () => {
      const cookie = req.headers.cookie
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('proofpay_session='))
        ?.slice('proofpay_session='.length);
      const token = cookie || req.headers.authorization?.replace(/^Bearer /, '');
      ensure(token, 'Start a walkthrough or use your invitation.', 401);
      const { rows } = await query<Session>(
        'SELECT workspace_id,role,demo FROM sessions WHERE token_hash=$1 AND expires_at>now()',
        [hash(token)],
      );
      ensure(rows[0], 'Your session expired. Start a new walkthrough.', 401);
      (req as Authed).auth = rows[0];
      next();
    };
    void authenticate().catch(next);
  });
  app.get(
    '/api/workspace',
    handle(async (req: Authed, res) => {
      const w = await getWorkspace(req.auth.workspace_id);
      const body = structuredClone(w);
      for (const a of body.agreements)
        for (const run of a.runs)
          for (const r of run.results)
            if (r.screenshot)
              r.screenshot = `/api/evidence/${a.id}/${run.id}/${encodeURIComponent(r.criterionId)}`;
      for (const a of body.agreements)
        for (const agent of a.agentRuns || [])
          for (const attempt of agent.attempts)
            for (const result of attempt.results)
              if (result.screenshot)
                result.screenshot = `/api/agent-evidence/${a.id}/${agent.id}/${attempt.artifactId}/${encodeURIComponent(result.criterionId)}`;
      res.json({
        ...body,
        paymentRules: rulesFor(w),
        paymentBudget: monthlyBudget(w),
        refundBalances: Object.fromEntries(w.agreements.map((a) => [a.id, refundTotals(a)])),
        automaticDecisions: Object.fromEntries(
          w.agreements.map((a) => [a.id, evaluateAutomaticPayment(w, a)]),
        ),
        role: req.auth.role,
        aiConfigured: Boolean(process.env.OPENAI_API_KEY),
        paypalConfigured: paypalConfigured(),
      });
    }),
  );
  app.put(
    '/api/payment-rules',
    handle(async (req: Authed, res) => {
      role(req, 'buyer');
      const input = paymentRulesInput.parse(req.body);
      await mutate(req.auth.workspace_id, (w) => {
        ensure(
          !input.enabled || !w.recoveryPause,
          'Resolve payment cases and explicitly clear the recovery pause before enabling auto-pay.',
        );
        const version = rulesFor(w).version + 1,
          at = new Date().toISOString();
        w.paymentRules = {
          enabled: input.enabled,
          perPaymentLimit: input.perPaymentLimit,
          monthlyLimit: input.monthlyLimit,
          version,
          updatedAt: at,
        };
        w.ruleHistory = [
          {
            at,
            version,
            enabled: input.enabled,
            perPaymentLimit: input.perPaymentLimit,
            monthlyLimit: input.monthlyLimit,
          },
          ...(w.ruleHistory || []),
        ].slice(0, 100);
        for (const a of w.agreements.filter((a) => a.status === 'active' || a.status === 'draft'))
          event(
            a,
            input.enabled
              ? 'Buyer enabled standing payment rules'
              : 'Buyer paused automatic payments',
            `Rules v${version} · up to $${(input.perPaymentLimit / 100).toFixed(2)} per payment · $${(input.monthlyLimit / 100).toFixed(2)} per UTC calendar month. Already dispatched captures cannot be recalled.`,
          );
      });
      await settleAutomaticPayments(req.auth.workspace_id);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/logout',
    handle(async (req: Authed, res) => {
      const cookie = req.headers.cookie
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('proofpay_session='))
        ?.slice('proofpay_session='.length);
      if (cookie) await query('DELETE FROM sessions WHERE token_hash=$1', [hash(cookie)]);
      res.clearCookie('proofpay_session');
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/demo/role',
    handle(async (req: Authed, res) => {
      ensure(req.auth.demo, 'Role switching is only available in an isolated walkthrough.', 403);
      const { role: r } = z.object({ role: z.enum(['buyer', 'developer']) }).parse(req.body);
      const cookie = req.headers
        .cookie!.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('proofpay_session='))!
        .slice('proofpay_session='.length);
      await query('UPDATE sessions SET role=$1 WHERE token_hash=$2', [r, hash(cookie)]);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agent-tasks',
    handle(async (req: Authed, res) => {
      role(req, 'buyer');
      const { amount } = z
        .object({ amount: z.number().int().min(100).max(1000000) })
        .parse(req.body);
      const a = seedWorkspace(randomUUID(), req.auth.demo).agreements[0];
      a.title = 'Repair Sunday Café’s booking flow';
      a.amount = amount;
      a.agentTask = true;
      a.agentRuns = [];
      a.criteria = a.criteria.filter((c) => c.type !== 'manual');
      a.brief =
        'Commission a bounded website repair agent to fix the broken Sunday Café booking submit handler. Preserve the headline, menu destination, required name and email fields, and 390px mobile layout. POST only to the approved test reservation endpoint and show the agreed success text after a successful response. No visual redesign, new features, price changes, or altered acceptance checks are included.';
      a.events = [];
      event(
        a,
        'Agent task commissioned',
        'Buyer-posted task · one operator/seller · five objective checks · payment requires existing authorization.',
      );
      await mutate(req.auth.workspace_id, (w) => {
        ensure(w.agreements.length < 20, 'Workspace agreement limit reached.');
        w.agreements.unshift(a);
      });
      res.status(201).json({ id: a.id });
    }),
  );
  app.post(
    '/api/agreements/:id/agent/start',
    handle(async (req: Authed, res) => {
      ensure(
        process.env.OPENAI_API_KEY,
        'Configure OPENAI_API_KEY to run a real repair agent. No AI delivery is simulated.',
        503,
      );
      const runId = randomUUID(),
        jobId = randomUUID();
      await mutate(req.auth.workspace_id, (w) => {
        const a = find(w, req.params.id as string);
        idle(a);
        ensure(
          a.agentTask && a.status === 'active' && a.approvals.buyer && a.approvals.developer,
          'Both parties must approve an agent task first.',
        );
        ensure(
          a.payment.status === 'authorized' &&
            a.payment.version === a.version &&
            a.payment.expiresAt &&
            Date.parse(a.payment.expiresAt) > Date.now(),
          'A current buyer-approved authorization is required.',
        );
        ensure(
          !a.runs.some((r) => r.status === 'running' || r.status === 'queued'),
          'A delivery is already running.',
        );
        ensure((a.agentRuns?.length || 0) < 5 && a.runs.length < 20, 'Agent run limit reached.');
        a.agentRuns ||= [];
        a.agentRuns.unshift({
          id: runId,
          status: 'queued',
          version: a.version,
          createdAt: new Date().toISOString(),
          steps: [],
          attempts: [],
        });
        a.runs.unshift({
          id: runId,
          status: 'queued',
          version: a.version,
          url: 'fixture:broken',
          createdAt: new Date().toISOString(),
          results: [],
        });
        a.manualAccepted = [];
        event(
          a,
          'Repair agent queued',
          'The model will inspect the source, write a bounded patch, and submit only after independent checks pass.',
        );
      });
      try {
        await query(
          "INSERT INTO jobs(id,workspace_id,agreement_id,run_id,kind) VALUES($1,$2,$3,$4,'agent')",
          [jobId, req.auth.workspace_id, req.params.id, runId],
        );
      } catch (err) {
        await mutate(req.auth.workspace_id, (w) => {
          const a = find(w, req.params.id as string),
            agent = a.agentRuns!.find((r) => r.id === runId)!;
          agent.status = 'error';
          agent.error = 'Could not queue the agent. Retry.';
          const r = a.runs.find((r) => r.id === runId)!;
          r.status = 'error';
          r.error = agent.error;
        });
        throw err;
      }
      res.status(202).json({ runId });
    }),
  );
  app.get(
    '/api/agent-evidence/:agreement/:agent/:artifact/:criterion',
    handle(async (req: Authed, res) => {
      const a = find(await getWorkspace(req.auth.workspace_id), req.params.agreement as string);
      const result = a.agentRuns
        ?.find((r) => r.id === req.params.agent)
        ?.attempts.find((a) => a.artifactId === req.params.artifact)
        ?.results.find((r) => r.criterionId === req.params.criterion);
      ensure(result?.screenshot, 'Evidence not found.', 404);
      res.type('image/jpeg').send(Buffer.from(result.screenshot, 'base64'));
    }),
  );
  app.post(
    '/api/demo/routine-project',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      ensure(req.auth.demo, 'This example is only available in isolated walkthroughs.', 403);
      const a = seedWorkspace(randomUUID(), true).agreements[0];
      a.title = 'Booking flow repair for Sunday Café';
      a.amount = 7500;
      a.criteria = a.criteria.filter((c) => c.type !== 'manual');
      a.brief =
        'Repair the Sunday Café booking flow at the approved website. Keep the headline “Good days start here.” and menu link to #menu. Require name and email; submit to the approved test endpoint and show “Your table is reserved.” Keep the mobile page within 390px. This routine job commissions only these objective requirements; no visual redesign is included.';
      a.events = [];
      event(
        a,
        'Routine update drafted',
        'Five objective checks. Buyer and developer approval plus buyer authorization are still required.',
      );
      await mutate(req.auth.workspace_id, (w) => {
        ensure(w.agreements.length < 20, 'Workspace agreement limit reached.');
        w.agreements.unshift(a);
      });
      res.status(201).json({ id: a.id });
    }),
  );
  app.get(
    '/api/evidence/:agreement/:run/:criterion',
    handle(async (req: Authed, res) => {
      const w = await getWorkspace(req.auth.workspace_id),
        a = find(w, req.params.agreement as string),
        r = a.runs
          .find((r) => r.id === req.params.run)
          ?.results.find((r) => r.criterionId === req.params.criterion);
      ensure(r?.screenshot, 'Evidence not found.', 404);
      res.type('image/jpeg').send(Buffer.from(r.screenshot, 'base64'));
    }),
  );
  const aiLimit = rateLimit({ windowMs: 600000, limit: 12, legacyHeaders: false });
  app.post(
    '/api/agreements/:id/changes',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      res
        .status(201)
        .json(await proposeChange(req.auth.workspace_id, req.params.id as string, req.body));
    }),
  );
  app.post(
    '/api/agreements/:id/changes/:change/review',
    aiLimit,
    handle(async (req: Authed, res) => {
      role(req, 'buyer');
      res.json(
        await reviewChange(
          req.auth.workspace_id,
          req.params.id as string,
          req.params.change as string,
        ),
      );
    }),
  );
  app.post(
    '/api/agreements/:id/changes/:change/decision',
    handle(async (req: Authed, res) => {
      role(req, 'buyer');
      res.json(
        await decideChange(
          req.auth.workspace_id,
          req.params.id as string,
          req.params.change as string,
          req.body,
        ),
      );
    }),
  );
  app.post(
    '/api/agreements/:id/changes/:change/messages',
    handle(async (req: Authed, res) => {
      await changeMessage(
        req.auth.workspace_id,
        req.params.id as string,
        req.params.change as string,
        req.auth.role,
        req.body,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/changes/:change/withdraw',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      await withdrawChange(
        req.auth.workspace_id,
        req.params.id as string,
        req.params.change as string,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/ai/criteria',
    aiLimit,
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      const { brief } = z.object({ brief: z.string().min(20).max(6000) }).parse(req.body);
      res.json(await propose(brief));
    }),
  );
  app.post(
    '/api/agreements',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      const input = agreementInput.parse(req.body);
      ensure(
        Date.parse(input.dueAt) > Date.now() &&
          Date.parse(input.dueAt) <= Date.now() + 72 * 3600000,
        'Delivery must be due within the next 72 hours.',
        400,
      );
      await safeUrl(
        input.deliveryUrl,
        (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
      );
      const a = {
        ...input,
        id: randomUUID(),
        version: 1,
        status: 'draft' as const,
        approvals: {},
        manualAccepted: [],
        payment: {
          mode: req.auth.demo ? ('demo' as const) : ('sandbox' as const),
          status: 'none' as const,
        },
        runs: [],
        events: [],
        createdAt: new Date().toISOString(),
      };
      event(a, 'Agreement drafted', 'Review every check before approving.');
      await mutate(req.auth.workspace_id, (w) => {
        ensure(w.agreements.length < 20, 'Workspace agreement limit reached.');
        w.agreements.unshift(a);
      });
      res.status(201).json({ id: a.id });
    }),
  );
  app.patch(
    '/api/agreements/:id',
    handle(async (req: Authed, res) => {
      const input = z
        .object({
          criteria: z
            .array(criterionSchema)
            .min(1)
            .max(12)
            .refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length),
          brief: z.string().min(20).max(6000).optional(),
        })
        .parse(req.body);
      await mutate(req.auth.workspace_id, (w) => {
        const a = find(w, req.params.id as string);
        editable(a);
        a.criteria = input.criteria;
        if (input.brief) a.brief = input.brief;
        a.version++;
        a.approvals = {};
        a.manualAccepted = [];
        a.payment = { mode: w.demo ? 'demo' : 'sandbox', status: 'none' };
        event(
          a,
          'Agreement updated',
          `Version ${a.version} requires fresh approval from both parties.`,
        );
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/approve',
    handle(async (req: Authed, res) => {
      await approve(req.auth.workspace_id, req.params.id as string, req.auth.role);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/verify',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      const { url } = z.object({ url: z.string().max(2048) }).parse(req.body);
      const w = await getWorkspace(req.auth.workspace_id),
        a = find(w, req.params.id as string);
      ensure(
        !a.agentTask,
        'Agent tasks submit their own independently verified artifact. Use the Agent work tab.',
        400,
      );
      if (url.startsWith('fixture:'))
        ensure(
          w.demo && ['fixture:broken', 'fixture:fixed'].includes(url),
          'Built-in fixtures are only available in walkthroughs.',
          400,
        );
      else {
        ensure(url === a.deliveryUrl, 'Delivery URL must match the approved agreement.', 400);
        await safeUrl(url, (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean));
      }
      const runId = randomUUID(),
        jobId = randomUUID();
      await mutate(w.id, (w) => {
        const a = find(w, req.params.id as string);
        idle(a);
        ensure(a.status === 'active', 'Both parties must approve the agreement first.');
        ensure(
          a.payment.status === 'authorized',
          'Authorize payment before delivery verification.',
        );
        ensure(
          !a.runs.some((r) => ['queued', 'running'].includes(r.status)),
          'A verification run is already in progress.',
        );
        ensure(a.runs.length < 20, 'Verification limit reached.');
        a.manualAccepted = [];
        a.runs.unshift({
          id: runId,
          version: a.version,
          url,
          status: 'queued',
          createdAt: new Date().toISOString(),
          results: [],
        });
        event(
          a,
          'Delivery submitted',
          url.startsWith('fixture:')
            ? `${url === 'fixture:fixed' ? 'Corrected' : 'Broken'} café fixture`
            : url,
        );
      });
      try {
        await query('INSERT INTO jobs(id,workspace_id,agreement_id,run_id) VALUES($1,$2,$3,$4)', [
          jobId,
          w.id,
          a.id,
          runId,
        ]);
      } catch (err) {
        await mutate(w.id, (w) => {
          const r = find(w, a.id).runs.find((r) => r.id === runId)!;
          r.status = 'error';
          r.error = 'Could not queue the browser job. Please retry.';
        });
        throw err;
      }
      res.status(202).json({ runId });
    }),
  );
  app.post(
    '/api/agreements/:id/manual',
    handle(async (req: Authed, res) => {
      role(req, 'buyer');
      const { criterionId, accepted } = z
        .object({ criterionId: z.string(), accepted: z.boolean() })
        .parse(req.body);
      await mutate(req.auth.workspace_id, (w) => {
        const a = find(w, req.params.id as string);
        idle(a);
        ensure(
          a.status === 'active' && !['capture_pending', 'captured'].includes(a.payment.status),
          'Agreement cannot be changed during or after payment.',
        );
        ensure(
          a.criteria.some((c) => c.id === criterionId && c.type === 'manual'),
          'Manual criterion not found.',
          404,
        );
        a.manualAccepted = a.manualAccepted.filter((id) => id !== criterionId);
        if (accepted) a.manualAccepted.push(criterionId);
        event(a, accepted ? 'Buyer accepted visual direction' : 'Buyer withdrew manual acceptance');
      });
      await settleAutomaticPayments(req.auth.workspace_id, req.params.id as string);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/scope',
    aiLimit,
    handle(async (req: Authed, res) => {
      const { request } = z
        .object({ request: z.string().trim().min(10).max(3000) })
        .parse(req.body);
      const w = await getWorkspace(req.auth.workspace_id),
        a = find(w, req.params.id as string);
      ensure(['draft', 'active'].includes(a.status), 'Agreement is closed.');
      const version = a.version,
        scopeId = randomUUID();
      // Reserve review before the AI call: automation cannot race a pending comparison.
      await mutate(w.id, (w) => {
        const current = find(w, req.params.id as string);
        idle(current);
        ensure(
          current.version === version &&
            ['draft', 'active'].includes(current.status) &&
            current.payment.status !== 'capture_pending',
          'Agreement changed or payment was already dispatched.',
        );
        current.scope = {
          id: scopeId,
          request,
          verdict: 'unclear',
          explanation:
            'Scope comparison is pending. Buyer review is required before automatic payment.',
          source: 'pending',
        };
        event(current, 'New scope request pauses auto-pay', request);
      });
      const result = await compareScope(request, a.brief, a.criteria);
      await mutate(w.id, (w) => {
        const current = find(w, req.params.id as string);
        ensure(
          current.version === version && current.scope?.id === scopeId,
          'Agreement or scope request changed. Compare again.',
        );
        current.scope = { ...current.scope, request, ...result };
        event(
          current,
          'Scope request reviewed',
          'Advisory only. Buyer decides whether to continue the original agreement.',
        );
      });
      res.json(result);
    }),
  );
  app.post(
    '/api/agreements/:id/scope/resolve',
    handle(async (req: Authed, res) => {
      role(req, 'buyer');
      const { scopeId } = z.object({ scopeId: z.string().min(1) }).parse(req.body);
      await mutate(req.auth.workspace_id, (w) => {
        const a = find(w, req.params.id as string);
        idle(a);
        ensure(
          a.status === 'active' && a.scope?.id === scopeId,
          'Scope request changed or agreement is closed.',
        );
        ensure(a.scope.source !== 'pending', 'Wait for the scope comparison to complete.');
        a.scope.resolvedAt = new Date().toISOString();
        event(
          a,
          'Buyer kept the original scope',
          'This new request is excluded from the current agreement. Standing rules may now resume against the original checks.',
        );
      });
      await settleAutomaticPayments(req.auth.workspace_id, req.params.id as string);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/replacement',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      const { amount, criteria } = z
        .object({
          amount: z.number().int().min(100).max(1000000),
          criteria: z
            .array(criterionSchema)
            .min(1)
            .max(12)
            .refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length),
        })
        .parse(req.body);
      const replacementId = randomUUID();
      await mutate(req.auth.workspace_id, (w) => {
        const a = find(w, req.params.id as string);
        idle(a);
        ensure(a.scope, 'Add a scope request first.');
        ensure(
          !a.changes?.some((c) => c.status === 'pending'),
          'Resolve the proposed terms before drafting a scope replacement.',
        );
        ensure(
          a.payment.status === 'voided',
          'Void the existing authorization before creating a replacement.',
        );
        ensure(a.status !== 'superseded', 'A replacement already exists.');
        ensure(w.agreements.length < 20, 'Workspace agreement limit reached.');
        a.status = 'superseded';
        const replacement = {
          ...structuredClone(a),
          id: replacementId,
          previousId: a.id,
          version: a.version + 1,
          title: a.title,
          brief: a.brief + '\n\nAdditional request: ' + a.scope.request,
          amount,
          criteria,
          status: 'draft' as const,
          approvals: {},
          manualAccepted: [],
          payment: { mode: a.payment.mode, status: 'none' as const },
          runs: [],
          events: [],
          scope: undefined,
          automation: undefined,
          agentRuns: [],
          cases: [],
          changes: [],
          createdAt: new Date().toISOString(),
          dueAt: new Date(Date.now() + 48 * 3600000).toISOString(),
        };
        event(
          replacement,
          'Replacement agreement drafted',
          'Previous approval and authorization do not apply. Both parties must review the new checks and price.',
        );
        event(a, 'Replaced by a new agreement');
        w.agreements.unshift(replacement);
      });
      res.status(201).json({ id: replacementId });
    }),
  );
  app.post(
    '/api/agreements/:id/cases',
    handle(async (req: Authed, res) => {
      role(req, 'buyer');
      const input = reportInput.parse(req.body);
      const caseId = await reportProblem(req.auth.workspace_id, req.params.id as string, input);
      res.status(201).json({ id: caseId });
    }),
  );
  app.post(
    '/api/agreements/:id/cases/:case/messages',
    handle(async (req: Authed, res) => {
      const { message } = z
        .object({ message: z.string().trim().min(10).max(2000) })
        .parse(req.body);
      await addCaseMessage(
        req.auth.workspace_id,
        req.params.id as string,
        req.params.case as string,
        req.auth.role,
        message,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/cases/:case/review',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      const { decision, message } = z
        .object({
          decision: z.enum(['review', 'decline']),
          message: z.string().trim().min(20).max(2000),
        })
        .parse(req.body);
      await reviewCase(
        req.auth.workspace_id,
        req.params.id as string,
        req.params.case as string,
        decision,
        message,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/cases/:case/buyer-decision',
    handle(async (req: Authed, res) => {
      role(req, 'buyer');
      const { decision, message } = z
        .object({
          decision: z.enum(['accept', 'reopen']),
          message: z.string().trim().min(20).max(2000),
        })
        .parse(req.body);
      await buyerCaseDecision(
        req.auth.workspace_id,
        req.params.id as string,
        req.params.case as string,
        decision,
        message,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/cases/:case/refunds',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      await issueRefund(
        req.auth.workspace_id,
        req.params.id as string,
        req.params.case as string,
        refundInput.parse(req.body),
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/cases/:case/refunds/:refund/retry',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      await retryRefund(
        req.auth.workspace_id,
        req.params.id as string,
        req.params.case as string,
        req.params.refund as string,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/cases/:case/refunds/:refund/reconcile',
    handle(async (req: Authed, res) => {
      role(req, 'developer');
      await reconcileRefund(
        req.auth.workspace_id,
        req.params.id as string,
        req.params.case as string,
        req.params.refund as string,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/agreements/:id/cases/:case/reconcile-payment',
    handle(async (req: Authed, res) => {
      findCase(
        find(await getWorkspace(req.auth.workspace_id), req.params.id as string),
        req.params.case as string,
      );
      await reconcile(req.auth.workspace_id, req.params.id as string);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/recovery/resume',
    handle(async (req: Authed, res) => {
      role(req, 'buyer');
      z.object({ confirmResume: z.literal(true) }).parse(req.body);
      await resumeAfterRecovery(req.auth.workspace_id);
      await settleAutomaticPayments(req.auth.workspace_id);
      res.json({ ok: true });
    }),
  );
  const paymentRoutes: Record<string, (workspace: string, id: string) => Promise<any>> = {
    order: createAuthorization,
    authorize: confirmAuthorization,
    capture,
    void: (w, id) => voidAuthorization(w, id, false),
    cancel: (w, id) => voidAuthorization(w, id, true),
    reconcile,
  };
  for (const [route, fn] of Object.entries(paymentRoutes))
    app.post(
      `/api/agreements/:id/payments/${route}`,
      handle(async (req: Authed, res) => {
        role(req, 'buyer');
        await fn(req.auth.workspace_id, req.params.id as string);
        if (['authorize', 'reconcile'].includes(route))
          await settleAutomaticPayments(req.auth.workspace_id, req.params.id as string);
        res.json({ ok: true });
      }),
    );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use('/fixtures', (_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
    );
    next();
  });
  app.get(
    '/fixtures/agent/:id',
    handle(async (req, res) => {
      const { rows } = await query<{ html: string }>(
        'SELECT html FROM agent_artifacts WHERE id=$1',
        [req.params.id],
      );
      ensure(rows[0]?.html, 'Agent artifact not found.', 404);
      const origin = new URL(`${req.protocol}://${req.get('host')}`).origin;
      res.set(artifactHeaders(origin));
      res.type('html').send(rows[0].html);
    }),
  );
  app.get('/fixtures/:version', (req, res) => {
    if (!['broken', 'fixed'].includes(req.params.version)) {
      res.status(404).send('Fixture not found.');
      return;
    }
    res.type('html').send(cafeHtml(req.params.version === 'fixed'));
  });
  app.options('/fixtures/reserve', (_req, res) =>
    res
      .set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      .sendStatus(204),
  );
  app.post('/fixtures/reserve', (_req, res) =>
    res
      .set('Access-Control-Allow-Origin', '*')
      .json({ ok: true, message: 'Your table is reserved.' }),
  );
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      return;
    }
    const status = err instanceof AppError ? err.status : 500;
    if (status === 500) console.error(err);
    res
      .status(status)
      .json({ error: status === 500 ? 'Something went wrong. Please retry.' : err.message });
  });
  return app;
}
