# Demo video guide

Target length **2:45**, hard limit under 3:00. Public YouTube upload. Everything you say must match what is on screen and what is in [VALIDATION.md](VALIDATION.md).

**Pitch in one line:** ProofPay pays for proven agent output, inside limits the buyer set.

## Before you record

1. Run `npm run preflight` and fix every FAIL line.
2. Rehearse the whole flow twice. The first model call is the slowest; the second rehearsal shows the true timing.
3. Do the PayPal sandbox run once off camera (merchant workspace: authorize, agent repair, capture, report a problem, refund). Write the transaction IDs into the results table in [SUBMISSION.md](SUBMISSION.md). Record that clip separately.
4. Browser at 1920x1080, page zoom 110%, bookmarks bar hidden, notifications off, a clean profile. Start from a fresh private demo so every ID and timestamp is new.
5. Record the screen and your voice in one take per section. Cut the sections together afterwards. If you speed up the agent wait, put the words "sped up" on screen.

## Script (spoken words in quotes)

**0:00–0:15 · The problem** (landing page, "Pay for proven agent work")
"AI agents can now do real work, and soon they'll be paid for it. But an agent can say it's finished when the result doesn't work. ProofPay makes payment depend on proof the agent didn't write itself."

**0:15–0:35 · Agreement and limits** (Start interactive demo → chapters 1 and 2)
"A buyer commissions a seventy-five-dollar fix for a café's booking form, with five agreed checks. Both sides approve the same version. The buyer authorizes the amount and sets the rules: seventy-five per payment, a hundred and fifty a month. The agent will never be able to change any of this."

**0:35–0:55 · The failure** (chapter 3, run the checks, open the failed screenshot)
"The page looks finished. Chromium fills in the form like a customer, and four checks pass, but the reservation fails. Nothing is paid."

**0:55–1:35 · The agent** (chapter 4, click "Let the AI agent write the fix")
"Now the agent has to earn it. It reads the broken handler, asks a model for a patch, and every patch is tested by the same independent browser. [If patch 1 fails: Here the first patch fails, because the page showed success without sending the reservation. The browser says exactly why, and the agent tries again.] [If patch 1 passes: Here the first patch passes all five checks.] Here is the code the model wrote, and its SHA-256 digest. Only a patch that passes is submitted."

**1:35–1:55 · The payment** (receipt, then the sandbox clip)
"The buyer's rules capture the payment automatically: no extra click. This guided flow uses simulated money. In the merchant workspace, the same flow runs against PayPal's sandbox: here is the real sandbox capture, [read the ID's last four characters], in the seller's sandbox account."

**1:55–2:20 · Why did this happen** (Why did this payment happen? → policy lab → download proof bundle)
"Afterwards the buyer can ask why a payment happened. This replays the exact inputs saved at capture time. In the policy lab I lower the limit, and the same evaluator says it would have been blocked. Nothing real changes. The proof bundle exports the agreement, evidence and decision with a checksum."

**2:20–2:40 · When something is wrong** (Report a problem → seller refund)
"If the buyer reports a problem, automatic payments pause, the case keeps the evidence, and the seller can refund against the original capture. The buyer decides when to resume."

**2:40–2:55 · Close**
"The agent does the work. Independent checks prove it. The buyer's rules control the payment. That's ProofPay."

## Say, and do not say

Say that the guided flow is simulated and the merchant workspace is PayPal sandbox. Say the model's name only if the on-screen run shows it.

Do not claim: a first-of-its-kind product, escrow, that the model owns a PayPal account, production money, user numbers, savings, or a prize outcome. This uses PayPal's standard Orders and Payments sandbox APIs, not Agentic Commerce Services.

## If something goes wrong on camera

- Agent run fails or times out: keep it. Say "no delivery was submitted and nothing was captured, which is the point," then run it again or use "Use the authored correction instead" and say so.
- Payment is not captured: check that the worker has the PayPal credentials and that `npm run preflight` still passes, then rerun from a fresh demo.

## Upload

Title: _ProofPay: pay AI agents only for proven work (PayPal AI Hackathon)_. Public visibility. Put the repository link and a two-line summary in the description, and label any sped-up section in the description too.
