# Submission

## Before submitting

Do these in order. Each step feeds the next.

1. **Check the machine.** Fill `.env` with the OpenAI key, PayPal sandbox app credentials, and two role invitations, then run `npm run preflight`. Continue when it reports the full live run is ready.
2. **Do the live run once, off camera.** Follow the [provider-run steps](SETUP.md#paypal-sandbox-run): commission the agent task, approve as both roles, authorize with the sandbox buyer, enable standing rules, start the agent, and wait for the automatic capture. Then report a problem as Buyer and refund as Seller.
3. **Write down what happened** in the [results table](#live-run-results) below and in [VALIDATION.md](VALIDATION.md). A failed model call or repair is a result too; record it and rerun.
4. **Record the video** using the [demo script](AGENT_DEMO.md). With the OpenAI key set, the guided demo shows the model-written repair in one flow with simulated payment; use the merchant workspace for the PayPal sandbox capture. Tell one story: failure, model-written fix, independent proof, sandbox capture, decision replay. Leave terms review, scope changes, and the freelancer workflow out of the video.
5. **Upload to YouTube** as public, under three minutes. Label any time compression.
6. **Host it if time allows.** Deploy the [Render Blueprint](../render.yaml), then run `npm run smoke -- https://your-host`. Otherwise the repository setup instructions are the evaluation route.
7. **Update the status lines** in the [README](../README.md#current-verification) and the Devpost text below so they match the results table, then paste the text into Devpost.

## Live run results

Fill these from the actual run. Leave a row as "not run" rather than guessing.

| Item                                       | Observed |
| ------------------------------------------ | -------- |
| Date and commit                            | not run  |
| Model and number of repair attempts        | not run  |
| Agent run duration                         | not run  |
| Browser checks on the final artifact       | not run  |
| Artifact SHA-256 (first 12 characters)     | not run  |
| PayPal sandbox authorization ID            | not run  |
| PayPal sandbox capture ID                  | not run  |
| PayPal sandbox refund ID                   | not run  |
| Signed webhook received and processed once | not run  |
| Hosted URL and smoke result                | not run  |
| YouTube link                               | not run  |

## Devpost text

Edit the wording into your own voice. Keep the claims in line with the results table.

### Name and tagline

**ProofPay — Pay for proven agent work.**

### Inspiration

An AI agent can say a task is done without delivering a working result. If agents are going to be paid for work, the buyer needs a basis for payment that the agent did not write itself, and the agent's operator needs a clear finish line. Asking a person to approve every routine payment defeats the point of using an agent.

### What it does

A buyer commissions a small website repair at a fixed price, with five acceptance checks agreed up front. The buyer authorizes that amount through PayPal and sets a per-payment and monthly limit.

A repair agent reads the broken booking form, asks a model for a patch, and gets back the results of an independent browser test. It can revise once. Only an artifact that passes every check becomes a delivery, identified by the SHA-256 of its HTML.

Payment follows the evidence. The buyer's standing rules capture the existing PayPal authorization only when the agreement version, the checks, the scope, and the budget all match. A failed or inconclusive check blocks payment. The agent can change the code; it cannot change its checks, its price, or the payment rules.

Afterwards the buyer can ask **why did this payment happen?** Decision replay shows the agreement, each delivery attempt, the findings, and the policy inputs saved at capture time. A policy lab reruns the same evaluator on copies, for example with a lower limit or a failed check, without touching the real record. A proof bundle exports all of it with a checksum.

If something is wrong, the buyer reports a problem from the receipt. Automatic payments pause, the seller reviews the case, and a full or partial refund goes back against the original PayPal capture.

The café repair is small on purpose. The same pattern fits any agent task whose result a machine can check.

### How we built it

- **PayPal:** Orders and Payments sandbox APIs for authorization, conditional capture, void, full and partial refund, and reconciliation, with request IDs so a retried call cannot pay twice. Webhooks are signature-verified before processing.
- **AI:** OpenAI structured outputs write the booking-handler patch from the defective source and the browser observations. The model's output is stored and tested separately; it never decides payment eligibility.
- **Verification:** a Playwright worker runs real Chromium against the stored artifact under a sandboxed origin and keeps screenshots as evidence.
- **App:** React and Vite front end, Express API, PostgreSQL (embedded PGlite locally), TypeScript throughout. 78 unit and API tests and 7 real-browser acceptance tests run in CI.

### Challenges

- **A patch that claims success.** In testing, a patch that showed a success message without sending the reservation looked fine on screen. The check therefore requires a successful POST to the agreed endpoint, not only the visible message.
- **Money and retries.** A capture or refund can time out with the outcome unknown. Amounts stay reserved until PayPal confirms either way, and a retry reuses the same request ID.
- **Keeping the agent away from its own finish line.** Checks, price, and rules live in a versioned agreement that only the two people can approve. Any change to terms pauses payment and needs fresh consent and a fresh authorization.
- **Honest labeling.** Every screen and export says whether a payment was simulated or went through the PayPal sandbox.

### Accomplishments

- One record ties together the agreement version, the agent's artifact, the independent evidence, the payment policy, and the PayPal receipt.
- A payment decision can be replayed and questioned after the fact with its original inputs.
- The no-key guided demo lets anyone watch a real browser catch the failure without any credentials.

### What we learned

Verification has to be independent of the agent and agreed before the work starts, or it is not evidence. Automatic payment is acceptable to a buyer only when the limits are theirs, the exceptions come back to a person, and a refund path exists.

### What's next

More task types with machine-checkable results, multiple sellers, PayPal Disputes integration, and PayPal's agentic commerce services so external agents can take and settle tasks directly.

### Built with

PayPal Orders and Payments APIs (sandbox), OpenAI, Playwright, TypeScript, React, Vite, Express, PostgreSQL, PGlite, Docker, Render.

### Status (update before pasting)

Sandbox sign-in and a buyer-approved $75 authorization have succeeded. The model-written repair, sandbox capture and refund, signed webhook delivery, and hosted deployment are not yet run; replace this paragraph with the results table once they are. The no-key guided demo uses authored fixtures and simulated payments with real browser checks.

## Limits

The project uses standard PayPal Orders/Payments sandbox APIs, not separately onboarded Agentic Commerce Services. It supports one seller and a bounded website-repair task. An authorization is a temporary hold, not escrow; standing rules capture an existing authorization rather than create arbitrary new charges. Support cases receive human review, with no guaranteed recovery or legal adjudication. See the complete [product limits](../README.md#limits).

Do not invent testimonials, savings, novelty claims, or prize rankings. Include timings and user feedback only after collecting them.

## Feedback prompts

Ask potential buyers and agent operators: “What evidence would you require before paying for an agent’s output?”, “Which routine work could have objective acceptance checks?”, “Which exceptions must always return to a person?”, and “What spending limits would you trust?” Record anonymized responses with consent. These are interview prompts, not claims that interviews have happened.
