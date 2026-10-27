import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PaymentRules, AutoDecision } from './automation.js';
import type { AgentRun } from './agent.js';
export const criterionSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().min(3).max(160),
    type: z.enum(['text', 'link', 'required', 'form', 'mobile', 'manual']),
    selector: z.string().max(200),
    expected: z.string().min(1).max(500),
    required: z.boolean(),
  })
  .refine(
    (c) => c.type === 'manual' || c.selector.trim().length > 0,
    'Browser checks need an explicit selector',
  )
  .refine(
    (c) => c.type !== 'mobile' || (c.selector === 'body' && c.expected === '390'),
    'Mobile checks use body at 390px',
  );
export const agreementInput = z.object({
  title: z.string().trim().min(3).max(120),
  client: z.string().trim().min(2).max(80),
  brief: z.string().trim().min(20).max(6000),
  amount: z.number().int().min(100).max(1000000),
  deliveryUrl: z.string().url().max(2048),
  dueAt: z.string().datetime(),
  criteria: z
    .array(criterionSchema)
    .min(1)
    .max(12)
    .refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length, 'Check IDs must be unique'),
});
export type Criterion = z.infer<typeof criterionSchema>;
export type Role = 'buyer' | 'developer';
export type Result = {
  criterionId: string;
  status: 'pass' | 'fail' | 'inconclusive' | 'manual';
  observed: string;
  screenshot?: string;
  durationMs: number;
};
export type Run = {
  id: string;
  version: number;
  url: string;
  status: 'queued' | 'running' | 'completed' | 'error';
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  results: Result[];
  summary?: string;
  error?: string;
  artifactId?: string;
  artifactSha256?: string;
};
export type RefundRecord = {
  id: string;
  caseId: string;
  amount: number;
  note: string;
  status: 'pending' | 'completed' | 'failed';
  providerId?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
};
export type RecoveryCase = {
  id: string;
  reason: 'unrecognized' | 'wrong_amount' | 'duplicate' | 'delivery' | 'other';
  description: string;
  requestedAmount: number;
  status:
    | 'requested'
    | 'under_review'
    | 'refund_pending'
    | 'partially_refunded'
    | 'refunded'
    | 'declined'
    | 'cancelled'
    | 'resolved';
  createdAt: string;
  updatedAt: string;
  messages: { id: string; at: string; role: Role; body: string }[];
  snapshot: {
    version: number;
    title: string;
    brief: string;
    amount: number;
    paymentMode: 'demo' | 'sandbox';
    paymentStatus: string;
    captureId?: string;
    orderId?: string;
    authorizationId?: string;
    approvals: Partial<Record<Role, string>>;
    criteria: Criterion[];
    paymentRules: PaymentRules;
    delivery?: {
      id: string;
      url: string;
      createdAt: string;
      artifactId?: string;
      artifactSha256?: string;
      results: Omit<Result, 'screenshot'>[];
    };
  };
};
export function isCaseOpen(c: RecoveryCase) {
  return ['requested', 'under_review', 'refund_pending', 'partially_refunded'].includes(c.status);
}
export type Payment = {
  mode: 'demo' | 'sandbox';
  status: 'none' | 'created' | 'authorized' | 'capture_pending' | 'captured' | 'voided' | 'expired';
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  approvalUrl?: string;
  expiresAt?: string;
  version?: number;
  operation?: string;
  busy?: string;
  busyAt?: number;
  error?: string;
  captureMethod?: 'manual' | 'automatic';
  capturedAt?: string;
  ruleVersion?: number;
  budgetMonth?: string;
  refunds?: RefundRecord[];
};
export type Agreement = z.infer<typeof agreementInput> & {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'completed' | 'cancelled' | 'superseded';
  approvals: Partial<Record<Role, string>>;
  manualAccepted: string[];
  payment: Payment;
  runs: Run[];
  events: { id: string; at: string; title: string; detail: string }[];
  createdAt: string;
  previousId?: string;
  cases?: RecoveryCase[];
  agentTask?: boolean;
  agentRuns?: AgentRun[];
  scope?: {
    request: string;
    verdict: 'included' | 'additional' | 'unclear';
    explanation: string;
    source: string;
    id?: string;
    resolvedAt?: string;
  };
  automation?: AutoDecision;
};
export type Workspace = {
  id: string;
  demo: boolean;
  agreements: Agreement[];
  recoveryPause?: { since: string; caseId: string };
  paymentRules?: PaymentRules;
  ruleHistory?: {
    at: string;
    version: number;
    enabled: boolean;
    perPaymentLimit: number;
    monthlyLimit: number;
  }[];
};
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(condition: unknown, message: string, status = 409): asserts condition {
  if (!condition) throw new AppError(status, message);
}
export function event(a: Agreement, title: string, detail = '') {
  a.events.unshift({ id: randomUUID(), at: new Date().toISOString(), title, detail });
}
export function approved(a: Agreement) {
  return Boolean(a.approvals.buyer && a.approvals.developer);
}
export function latestRun(a: Agreement) {
  return a.runs.filter((r) => r.version === a.version)[0];
}
export function eligible(a: Agreement) {
  const run = latestRun(a);
  return (
    approved(a) &&
    a.status === 'active' &&
    run?.status === 'completed' &&
    a.criteria
      .filter((c) => c.required)
      .every((c) =>
        c.type === 'manual'
          ? a.manualAccepted.includes(c.id)
          : run.results.some((r) => r.criterionId === c.id && r.status === 'pass'),
      )
  );
}
export function assertPaymentReady(a: Agreement) {
  ensure(!a.cases?.some(isCaseOpen), 'Resolve this payment’s open support case before capture.');
  ensure(eligible(a), 'Complete the agreed checks and accept manual criteria before payment.');
  ensure(
    a.payment.status === 'authorized' || a.payment.status === 'capture_pending',
    'A valid buyer authorization is required.',
  );
  ensure(a.payment.version === a.version, 'Authorization belongs to an older agreement.');
  ensure(
    a.payment.expiresAt && Date.parse(a.payment.expiresAt) > Date.now(),
    'Authorization expired. Ask the buyer to authorize again.',
  );
}
export const cafeCriteria: Criterion[] = [
  {
    id: 'hero',
    title: 'Approved headline appears on the page',
    type: 'text',
    selector: 'h1',
    expected: 'Good days start here.',
    required: true,
  },
  {
    id: 'menu',
    title: 'Menu link opens the menu section',
    type: 'link',
    selector: 'a[data-check="menu"]',
    expected: '#menu',
    required: true,
  },
  {
    id: 'fields',
    title: 'Booking form requires name and email',
    type: 'required',
    selector: '#booking',
    expected: 'name,email',
    required: true,
  },
  {
    id: 'booking',
    title: 'Booking form submits successfully',
    type: 'form',
    selector: '#booking',
    expected: 'Your table is reserved.',
    required: true,
  },
  {
    id: 'mobile',
    title: 'Mobile layout fits a 390px screen',
    type: 'mobile',
    selector: 'body',
    expected: '390',
    required: true,
  },
  {
    id: 'design',
    title: 'Visual direction matches the approved brief',
    type: 'manual',
    selector: '',
    expected: 'Warm neutrals, olive accents, editorial typography.',
    required: true,
  },
];
export function seedWorkspace(id: string, demo = true): Workspace {
  const createdAt = new Date().toISOString();
  return {
    id,
    demo,
    agreements: [
      {
        id: randomUUID(),
        title: 'A fresh start for Sunday Café',
        client: 'Sunday Café',
        brief:
          'Build a warm, editorial landing page for Sunday Café. Use the headline “Good days start here.” Include a menu link to #menu and a table booking form with required name and email fields that confirms a successful reservation. The page must fit a 390px mobile screen. Use warm neutrals and olive accents.',
        amount: 15000,
        deliveryUrl: 'fixture:broken',
        dueAt: new Date(Date.now() + 48 * 3600000).toISOString(),
        criteria: structuredClone(cafeCriteria),
        version: 1,
        status: 'draft',
        approvals: {},
        manualAccepted: [],
        payment: { mode: demo ? 'demo' : 'sandbox', status: 'none' },
        runs: [],
        events: [
          {
            id: randomUUID(),
            at: createdAt,
            title: 'Project workspace created',
            detail: 'Six clear checks. One shared definition of done.',
          },
        ],
        createdAt,
      },
    ],
  };
}

export function refreshExpiration(a: Agreement) {
  if (
    a.payment.status === 'authorized' &&
    !a.payment.busy &&
    a.payment.expiresAt &&
    Date.parse(a.payment.expiresAt) <= Date.now()
  )
    a.payment.status = 'expired';
}
