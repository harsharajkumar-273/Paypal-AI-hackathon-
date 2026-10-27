# Submission draft

## Name and tagline

**ProofPay — Pay for proven agent work.**

## Problem

An AI agent can say a task is done without delivering a working result. The buyer needs an independent basis for payment, and the agent operator needs a clear finish line. Requiring a human to approve every successful routine capture also limits automation.

## What it does

A buyer commissions a bounded website repair with a fixed price and agreed checks. A repair agent inspects the defective source, requests an actual model-written patch, and receives independent browser feedback. It can revise once. Only a passing artifact becomes a submitted delivery, identified by a full HTML SHA-256 digest.

Buyer-approved standing rules permit capture of an existing PayPal sandbox authorization when the agreement, evidence, scope, and spending limits match. Failed checks stop payment; subjective work and policy exceptions require attention. The agent cannot change its own checks, price, authorization, or payment rules.

If a buyer reports a payment problem, ProofPay saves the original agreement and delivery evidence and pauses future automatic captures. The seller reviews the case and can issue a full or partial refund against the original capture. A confirmed refund retains its provider record, and the buyer explicitly decides when to resume automation.

## PayPal and AI

The PayPal adapter implements authorization, conditional capture, voiding, full/partial refunds, webhook verification, and reconciliation. Each task has an existing buyer-approved authorization. One sandbox seller operates the agent and receives payment.

OpenAI produces actual booking-handler code from the defective source and browser observations. The repair loop stores the generated artifact and tests it separately from the model. OpenAI also supports criterion suggestions, scope advice, and evidence summaries for human projects. AI output cannot override deterministic payment eligibility.

## Specific contribution

This prototype connects an agent-written artifact, independent acceptance evidence, a versioned agreement, buyer-approved payment limits, and payment recovery in one reviewable record. It focuses on a small repair adapter so the entire workflow can be inspected.

## Validation status

The local suite passes 43 domain/API/payment/recovery tests and 4 browser tests. The default walkthrough uses authored fixtures and simulated payments; agent acceptance tests use a deterministic model adapter with real Chromium. Actual OpenAI and PayPal sandbox runs, publication, and deployment remain pending. Update this section with observed provider-run results before submitting.

## Limits

The project uses standard PayPal Orders/Payments sandbox APIs, not separately onboarded Agentic Commerce Services. It supports one seller and a bounded website-repair task. An authorization is a temporary hold, not escrow; standing rules capture an existing authorization rather than create arbitrary new charges. Support cases receive human review, with no guaranteed recovery or legal adjudication. See the complete [product limits](../README.md#limits).

## Video and submission checklist

Use the [agent-work demo script](AGENT_DEMO.md) for the primary pitch. Keep the freelancer workflow as a second use case.

- Publish the source repository with its MIT license and verified setup instructions.
- Provide complete setup instructions or a hosted working build, as allowed by the supplied rules. For the hosted route, deploy web/worker/PostgreSQL and configure the final URL and credentials.
- Record an actual AI-generated repair, independent browser checks, and real sandbox authorization/capture. Show the corresponding artifact and receipt.
- Upload a public YouTube video under three minutes. Label any time compression or fallback footage.
- Include measured timing and actual user feedback only after collecting them. Do not invent testimonials, savings, novelty claims, or likely prize rankings.

## Feedback prompts

Ask potential buyers and agent operators: “What evidence would you require before paying for an agent’s output?”, “Which routine work could have objective acceptance checks?”, “Which exceptions must always return to a person?”, and “What spending limits would you trust?” Record anonymized responses with consent. These are interview prompts, not claims that interviews have happened.
