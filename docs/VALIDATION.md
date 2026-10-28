# Validation record

## Verified during implementation

- TypeScript validation and Vite production build.
- Initial prototype fresh-source check: npm ci and production build passed without existing node_modules or generated assets. The expanded agent build also passes TypeScript and Vite checks.
- Source formatting check passed.
- Current automated suite: 55 passing domain/API/standing-rule/payment-adapter/recovery/agreement-change tests and 4 passing browser acceptance tests.
- Completed the full simulated walkthrough through the interface, including both roles, both deliveries, manual acceptance, scope advice fallback, and receipt.
- Observed local UI run durations: 7.6 seconds for the broken fixture and 3.8 seconds for the corrected fixture. These are individual development-machine observations, not benchmarks.
- Real Chromium fixture test: broken delivery returns four automated passes and a failed booking check; corrected delivery returns five automated passes. Screenshots are captured and manual design remains a buyer decision.
- Dependency audit after upgrading Zod: zero known vulnerabilities reported.

See the current test suite for the exact assertions; rerun it after configuration or deployment changes.

## Provider connection check

- PayPal sandbox OAuth authentication returned HTTP 200 with the configured REST app credentials. The running local app reports `paypalConfigured: true` and `aiConfigured: false`. Secrets remain in the ignored local `.env`; no access token is stored in this record.
- After the user approved checkout with a sandbox personal buyer, the application confirmed an actual $75 sandbox authorization through the configured REST app. The stored payment status is `authorized`, with a provider authorization ID and expiry; no capture was issued and standing rules remain disabled.
- Sandbox capture, refund, and verified webhook delivery still need an end-to-end provider run. The model-backed delivery is also pending AI configuration.

## Agent-work validation

- Verified task commissioning and the missing-key behavior through the interface. The app shows no fabricated agent run when OpenAI is unavailable.
- Verified buyer-only consent for standing rules, monthly-budget reservation under concurrent deliveries, paused rules, expired authorizations, scope resolution, and unresolved captures.
- With real Chromium and a **deterministic test model adapter**, a false-success patch failed because no reservation POST succeeded. A revised patch passed five browser checks, submitted a stored artifact, and triggered simulated automatic capture under the buyer’s standing rules.
- The artifact’s full HTML SHA-256 matches the submitted delivery record. Generated content runs under an opaque-origin CSP, and screenshots remain authenticated.
- An unsuccessful two-attempt repair did not submit a passing delivery or capture payment.
- Browser tests run sequentially to match the single-job worker. One concurrent-run fixture failure was investigated; the complete sequential suite passes.

## Not yet verified

PayPal sandbox OAuth and buyer-approved authorization are confirmed in the provider connection check above. A live model-generated repair, an actual OpenAI call, sandbox capture/refund, verified provider webhook delivery, external PostgreSQL deployment, Render deployment, public repository publication, and YouTube upload remain unverified.

## Launch acceptance

- Configure `.env`, real role invitations, and an HTTPS test website with an approved form endpoint.
- Generate criteria with a real AI call; check selectors and manual criteria.
- Confirm separate buyer/developer sessions cannot switch roles or access another workspace.
- Authorize and capture a real sandbox order. Record transaction IDs and confirm the sandbox seller receives the capture.
- Retry the capture request and confirm the same transaction returns.
- Replay a signed webhook and confirm it is processed once; verify an unsigned event is rejected.
- Test cancellation, genuine authorization expiration, a pending PayPal result, and recovery after network failure.
- Deploy web/worker/PostgreSQL and test worker restart recovery.
- Run the full judge demo from a clean browser and a fresh repository checkout.
- Record measured timing, collect actual feedback, publish source with license, and upload the final video.

## Recovery validation

- Completed the interface walkthrough: buyer reported a simulated $75 capture, seller recorded a review and full simulated refund, and buyer saw a $0 refundable balance. Standing rules remained under a safety pause after refund confirmation. See [recovery preview](recovery-preview.png).
- Full and partial simulated refunds retain the original capture receipt and enforce cumulative balance limits.
- Concurrent refund attempts cannot exceed the captured amount; identical request IDs do not duplicate refunds.
- A simulated network failure keeps the amount reserved. Retrying preserves the exact request ID, amount, and note; provider status reconciliation confirms completion.
- Mismatched provider amounts never become confirmed refunds. Definitive failures release reservations, while in-progress/uncertain responses remain pending.
- Verified, duplicate refund webhooks reconcile a tracked operation once. These use mocked PayPal responses, not live sandbox transactions.
- Cases snapshot agreement/evidence data, block capture of the affected agreement, pause new automatic payments across the workspace, and require explicit buyer resumption.
- Buyer/seller permissions, cross-workspace isolation, case reopening, partial-settlement acceptance, and authorization cancellation are covered.
- Actual PayPal sandbox refunds and external PayPal disputes remain unverified without configured accounts. No refund guarantee or legal adjudication is claimed.

## Agreement-change validation

- Proposed changes preserve immutable old/new snapshots, business explanation, effective time, exact diffs, and a canonical proposal SHA-256. JSONB object-key ordering does not create false check changes.
- Pending proposals block manual capture, new authorization, and standing-rule capture for the affected agreement. Cross-workspace access, wrong-role decisions, missing consent, stale versions, modified digests, and duplicate acceptance are rejected.
- Accepting after void creates a new version with fresh approvals and no inherited payment or verification results. A future effective time blocks premature authorization. Declining or withdrawal retains the original terms and records the decision.
- The buyer can ask about changed clauses in a private persisted thread. Review failure leaves the proposal pending with the complete exact comparison available.
- A mocked model response validates full-document review and exact changed-clause citations; fabricated references and quotations are rejected. This is not a live AI review.
- Completed the interface proposal flow with a $2 fixed-price increase and added data-sharing clause, switched to Buyer, verified two exact changes and consent controls, and recorded a buyer question. The isolated demo proposal remains pending for inspection.
