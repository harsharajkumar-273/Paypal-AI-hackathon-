# Architecture and interfaces

## Data flow

React → same-origin Express API → PostgreSQL job queue → bounded OpenAI repair loop → independent Playwright verification → artifact and evidence → buyer-approved standing rules or explicit buyer capture → PayPal sandbox.

OpenAI proposes booking-handler code, criteria, scope advice, and summaries. The worker runs generated HTML/JavaScript only in the restricted browser artifact context; it never executes model output through Node or a shell. The model cannot change agreed checks or authorize payment. A model failure preserves recorded browser evidence; an unavailable verifier produces an error/inconclusive result, never a pass. Human deliveries use the same verifier and payment eligibility rules without the repair loop.

Buyer support cases snapshot the agreement and evidence, pause automatic capture, and lead to seller review and optional full/partial refund. Only the buyer can clear the recovery pause once cases and pending refunds are resolved.

Local development uses PGlite with the same PostgreSQL schema. Hosted web and worker share a PostgreSQL database. Workspaces contain versioned agreement aggregates in JSONB. Optimistic revision checks retry synchronous mutations safely across processes. Payment network operations occur outside retried mutations. Jobs use an atomic update with `FOR UPDATE SKIP LOCKED`. The worker reclassifies jobs abandoned for more than three minutes as errors.

## Records

- `workspaces`: ID, JSONB body (demo flag, agreements), revision, creation time.
- `sessions`: hashed random token, workspace ID, fixed buyer/developer role, demo flag, expiration. Real invites never become client-side permanent role selectors.
- `jobs`: agreement/run/workspace IDs, queue state, start time, creation time.
- `webhook_events`: unique PayPal event ID, verified body, processing flag, timestamp.
- `agent_artifacts`: immutable generated HTML, full SHA-256 digest, and owning workspace/agreement identifiers.
- Agreements retain brief, price in integer USD cents, approved delivery URL, due date, criteria, version-specific approvals, payment record, runs, manual acceptances, and an event timeline. A replacement has a new ID and links back to its predecessor.

Screenshots are stored with check results in JSONB for this small prototype. The API returns authenticated evidence URLs rather than base64 payloads in the workspace response. External object storage is appropriate for a larger installation.

## Browser checks

| Type       | Selector              | Expected                    | Pass condition                                                          |
| ---------- | --------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `text`     | Explicit CSS selector | Literal text                | Selected element contains text                                          |
| `link`     | Anchor selector       | Exact href                  | Attribute equals expected value                                         |
| `required` | Form selector         | Comma-separated input names | Each is unique, visible, enabled, required                              |
| `form`     | Form selector         | Literal success message     | Approved action URL returns successful POST and success text is visible |
| `mobile`   | `body`                | `390`                       | Document width does not exceed 390px viewport                           |
| `manual`   | Empty                 | Review instructions         | Buyer explicitly accepts after review                                   |

Selectors and values are agreed data, not executable scripts. Form verification is deliberately narrow; unsupported forms become inconclusive. Optional criteria do not block payment; required criteria do. The latest run for the current agreement version is authoritative.

## API

All mutation requests use `application/json` and enforce the configured Origin. Sessions use a random HttpOnly, SameSite=Lax cookie, Secure on HTTPS. Most routes require a session.

| Method / route                                 | Role            | Purpose                                                            |
| ---------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| `POST /api/session`                            | Public          | Empty body creates isolated demo; `{invite}` enters real workspace |
| `GET /api/workspace`                           | Member          | Read only own workspace; returns role/configuration flags          |
| `POST /api/logout`                             | Member          | Revoke session                                                     |
| `POST /api/demo/role`                          | Demo member     | Switch role within own isolated walkthrough                        |
| `POST /api/ai/criteria`                        | Developer       | `{brief}` → validated proposed checks and provenance               |
| `POST /api/agreements`                         | Developer       | Create fixed-price agreement                                       |
| `PATCH /api/agreements/:id`                    | Member          | Edit draft criteria/brief; increment version; reset approvals      |
| `POST /api/agreements/:id/approve`             | Member          | Approve current version as authenticated role                      |
| `POST /api/agreements/:id/verify`              | Developer       | `{url}` queues an approved delivery run                            |
| `POST /api/agreements/:id/manual`              | Buyer           | `{criterionId,accepted}` records manual review                     |
| `POST /api/agreements/:id/scope`               | Member          | `{request}` → advisory scope verdict                               |
| `POST /api/agreements/:id/replacement`         | Developer       | `{amount,criteria}` creates replacement after void                 |
| `POST /api/agreements/:id/payments/order`      | Buyer           | Create AUTHORIZE order                                             |
| `POST /api/agreements/:id/payments/authorize`  | Buyer           | Confirm buyer-approved PayPal authorization                        |
| `POST /api/agreements/:id/payments/capture`    | Buyer           | Explicitly capture agreed price if eligible                        |
| `POST /api/agreements/:id/payments/void`       | Buyer           | Void authorization; permit replacement                             |
| `POST /api/agreements/:id/payments/cancel`     | Buyer           | Void and cancel agreement                                          |
| `POST /api/agreements/:id/payments/reconcile`  | Buyer           | Retrieve authoritative order/payment state                         |
| `GET /api/evidence/:agreement/:run/:criterion` | Member          | Retrieve own evidence screenshot                                   |
| `POST /api/paypal/webhook`                     | Verified PayPal | Deduplicate and reconcile matching order                           |
| `GET /api/health`                              | Public          | Database readiness                                                 |

## Payment consistency

Orders and authorization operations use stable IDs tied to agreement and authorization cycle. Capture uses a stable ID tied to agreement version; its amount is server-owned. Network calls reserve a payment operation before leaving the database. Conflicting edits, replacement, delivery submission, manual changes, and cancellation are blocked while busy. A timeout during capture leaves `capture_pending`; callers retry the same operation or reconcile instead of creating a new charge. Completed capture is idempotent locally and cannot be cancelled. A pending result is not shown as paid.

Webhook signatures are verified using PayPal's verification API. A verified event is recorded uniquely before reconciliation and marked processed only after success. Duplicate deliveries do not repeat payment. Reconciliation checks order association, currency, and amount rather than trusting event prose.

## Network boundary and deployment

External verification requires HTTPS origins explicitly configured by the operator. Private/reserved DNS resolutions, unapproved redirects and subresources, WebSockets, and unapproved non-GET requests are blocked. Validated DNS answers are pinned in Chromium to resist rebinding. Built-in fixtures have a separate exact-origin/path exception. They are available only through demo runs, and use fictional data.

Browser execution has navigation, individual-action, and whole-run limits. Only one job runs per worker. Do not broaden origin allowlists to untrusted user-controlled infrastructure. Deploy the browser service with restricted egress and resource limits for stronger defense before accepting arbitrary third-party sites. No claim of a general-purpose hardened browsing sandbox is made.

## Standing rules and agent delivery

`PUT /api/payment-rules` is buyer-only and requires explicit consent when enabling automatic capture. The server records versioned limits and a rule history. Evaluations run after verification, manual acceptance, authorization, scope resolution, rule changes, and a background sweep. The final eligibility check and full-price reservation occur in the same optimistic workspace mutation. Pending captures never auto-retry; they require reconciliation or explicit buyer action.

`POST /api/agent-tasks` lets a buyer commission the bounded booking-handler task. `POST /api/agreements/:id/agent/start` requires both version approvals, a current authorization, an available model key, and no concurrent delivery. A persisted `kind=agent` job invokes the repair workflow on the browser worker. Missing credentials produce no queued or simulated AI run.

The repair model receives the actual defective handler, agreed criteria, and browser observations. It returns a validated handler/explanation object. The worker stores immutable artifact HTML and its SHA-256 in `agent_artifacts`, runs the independent verifier, and allows at most two patch attempts. Test results are held with the agent attempt until a passing artifact is submitted as the latest delivery run. The queued/running delivery placeholder prevents old evidence from enabling payment while the new work is incomplete.

`GET /fixtures/agent/:id` serves the stored artifact HTML with `sandbox allow-scripts allow-forms` and no same-origin permission. The browser context blocks unapproved requests and WebSockets. The only writable endpoint is the fictional `/fixtures/reserve`, which accepts synthetic test data and returns no user or payment information. This endpoint permits CORS for opaque-origin artifact execution; authenticated API routes do not. `GET /api/agent-evidence/:agreement/:agent/:artifact/:criterion` requires workspace membership.

`POST /api/agreements/:id/scope/resolve` records the buyer’s decision to exclude the new request and continue the original agreement. The current scope-request ID is required so a stale click cannot resolve a newer request. AI scope classification alone cannot clear this pause.

This is a narrow repair adapter, not a general code-execution service. Retain process isolation and egress restrictions before expanding task types. Public artifact delivery links are intentionally shareable; do not put private source or credentials in this demo adapter.

## Recovery and refunds

Agreement aggregates now retain `cases` and `payment.refunds`; workspaces optionally retain a `recoveryPause`. Existing records need no migration because these are optional JSONB fields. Original capture status and IDs remain intact after refunds. Gross completed captures continue to count against the UTC monthly budget.

A case stores the buyer’s reason, description, requested amount, fixed agreement/payment/policy/evidence snapshot, participant messages, and a review/refund state. Opening a case atomically pauses future automatic capture in that workspace, including on other agreements. It blocks capture of the affected agreement. Already-dispatched capture requests can still complete; support then follows their authoritative result.

| Route                                                            | Role             | Behavior                                                                   |
| ---------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `POST /api/agreements/:id/cases`                                 | Buyer            | Open a case and pause automation                                           |
| `POST /api/agreements/:id/cases/:case/messages`                  | Member           | Add case information                                                       |
| `POST /api/agreements/:id/cases/:case/review`                    | Seller/Developer | Record review or explained decline                                         |
| `POST /api/agreements/:id/cases/:case/buyer-decision`            | Buyer            | Accept confirmed partial settlement or request another review              |
| `POST /api/agreements/:id/cases/:case/refunds`                   | Seller/Developer | Reserve and request a refund; UUID request ID required                     |
| `POST /api/agreements/:id/cases/:case/refunds/:refund/retry`     | Seller/Developer | Retry the same immutable request/key                                       |
| `POST /api/agreements/:id/cases/:case/refunds/:refund/reconcile` | Seller/Developer | Retrieve authoritative provider refund status                              |
| `POST /api/agreements/:id/cases/:case/reconcile-payment`         | Member           | Resolve the original capture’s uncertain status                            |
| `POST /api/recovery/resume`                                      | Buyer            | Explicitly clear safety pause after cases and pending refunds are resolved |

Refund operations reserve the amount and payment-operation lock in the workspace mutation before calling PayPal. Only one uncertain refund can exist for a capture. A stable `refund-<request UUID>` idempotency key identifies the immutable capture/amount/note operation. Completed and pending refunds reduce the available refundable balance. Definitive provider rejection releases the reservation; ambiguous transport, server, throttling, or in-progress responses retain it. Mismatched amounts/IDs never produce completion. Retrieving a refund or a verified matching refund webhook can confirm an already-tracked operation. A delayed pending response cannot undo confirmed completion.

Webhook event IDs are deduplicated as before. Refund notifications match stored provider refund IDs and trigger server-side retrieval; event prose is never a refund decision. External refund/dispute imports and a full PayPal Disputes integration are outside this adapter; preserve the PayPal escalation path rather than imply universal dispute coverage.

Case and money-state mutations remain version checked and workspace scoped. Refunds can be issued only by the seller role. Only the buyer may resume standing rules, and the server refuses while cases or pending refunds remain open. AI has no refund or case-rejection authority.
