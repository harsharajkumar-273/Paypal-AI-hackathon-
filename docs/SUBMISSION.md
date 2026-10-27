# Submission draft

## Name and tagline

**ProofPay — Pay for proven agent work.**

## Problem

An AI agent can say a task is done without delivering a working result. The buyer needs an independent basis for payment, and the agent operator needs a clear finish line. Requiring a human to approve every successful routine capture also limits automation.

## What it does

A buyer commissions a bounded website repair with a fixed price and agreed checks. A repair agent inspects the defective source, requests an actual model-written patch, and receives independent browser feedback. It can revise once. Only a passing artifact becomes a submitted delivery, identified by a full HTML SHA-256 digest.

Buyer-approved standing rules permit capture of an existing PayPal sandbox authorization when the agreement, evidence, scope, and spending limits match. Failed checks stop payment; subjective work and policy exceptions require attention. The agent cannot change its own checks, price, authorization, or payment rules.

## PayPal and AI

PayPal supports authorization, conditional capture, voiding, webhook verification, and reconciliation. Each task has an existing buyer-approved authorization. Standing rules do not create arbitrary new charges or subscriptions. One sandbox seller operates the agent and receives payment; the model itself does not own an account. Authorization is not escrow.

OpenAI produces actual booking-handler code from the defective source and browser observations. The repair loop stores the generated artifact and tests it separately from the model. OpenAI also supports criterion suggestions, scope advice, and evidence summaries for human projects. AI output cannot override deterministic payment eligibility.

## Specific contribution

This prototype connects an agent-written artifact, independent acceptance evidence, a versioned agreement, buyer-approved payment limits, and a sandbox capture in one reviewable record. It deliberately focuses on a small repair adapter so the entire workflow can be inspected. We do not claim to be the first verified agent-payment product or a general marketplace.

## Working status and honest disclosure

The default no-key walkthrough uses authored broken/corrected fixtures and simulated payments. The real repair agent requires an OpenAI API key and never substitutes the fixed fixture for generated code. Automated acceptance tests use a deterministic model adapter with real Chromium; they are not evidence of a live OpenAI call. Actual OpenAI and PayPal sandbox execution must be demonstrated before the final submission claims those integrations worked live.

This project uses PayPal’s standard Orders/Payments APIs. It does not claim access to PayPal’s separately onboarded Agentic Commerce Services.

## Video and submission checklist

Use the [agent-work demo script](AGENT_DEMO.md) for the primary pitch. Keep the freelancer workflow as a second use case.

- Publish the source repository with its MIT license and verified setup instructions.
- Deploy the web service, browser worker, and PostgreSQL database; set the final public URL and credentials.
- Record an actual AI-generated repair, independent browser checks, and real sandbox authorization/capture. Show the corresponding artifact and receipt.
- Upload a public YouTube video under three minutes. Label any time compression or fallback footage.
- Include measured timing and actual user feedback only after collecting them. Do not invent testimonials, savings, novelty claims, or likely prize rankings.

## Feedback prompts

Ask potential buyers and agent operators: “What evidence would you require before paying for an agent’s output?”, “Which routine work could have objective acceptance checks?”, “Which exceptions must always return to a person?”, and “What spending limits would you trust?” Record anonymized responses with consent. These are interview prompts, not claims that interviews have happened.
