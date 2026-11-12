# Features in depth

Details for the parts of ProofPay beyond the main agent flow. The [README](../README.md) has the overview.

## Payment Decision Replay

Open **Decision replay** on a project, or choose **Why did this payment happen?** after the guided demo. Follow the agreement, delivery attempts, independent findings, payment policy, and receipt.

New captures save their original decision inputs, policy version, UTC budget usage, and decision time. The isolated policy lab can lower the spending limit, fail a required check, add an unapproved terms change, or simulate a buyer complaint. It runs the existing automatic-payment evaluator on copies and cannot capture funds or alter recorded evidence. Explicit buyer capture is displayed separately from automatic-policy eligibility.

**Download proof bundle** exports a private JSON attachment with the agreement, recorded decision, verification findings, included JPEG evidence, agent artifacts when present, event history, transaction references, and a SHA-256 content checksum. The checksum is not a digital signature. Older payments without a capture-time record are labeled honestly and do not receive fabricated historical inputs.

## Agreement changes and buyer-side review

Open **Terms review** to propose a new fixed price, work brief, deadline, or additional clauses. The business records its explanation and approves the exact proposal; the buyer receives a persistent in-app notice and payment on that job pauses. The comparison highlights non-price changes, shows every addition/removal, and keeps both complete recorded versions accessible.

The buyer-side AI reader examines the old and new documents for cost, data, permissions, service, cancellation, and legal wording. Each finding must identify a changed field and quote text actually present there. An unsupported citation or provider failure yields an unavailable review, never approval. The business’s reason remains a separately labeled claim. Without an AI key, the exact comparison and private question thread still work.

Acceptance records the proposal digest, version, time, and decision note. An existing order/authorization must first be voided; the accepted replacement starts with no payment or delivery evidence and needs a fresh authorization and verification. Future-effective terms cannot authorize payment early. Declining explicitly keeps the original terms; spending limits alone never accept a proposal.

The buyer’s per-change acknowledgement checklist is saved against the proposal digest and survives reloads. Questions can reference a specific change and have threaded replies. Only the buyer can mark a question addressed or no longer blocking, with a saved explanation; new replies reopen that question. Acceptance requires a complete checklist and no open buyer questions. Declining does not require accepting any new obligation.

Export a private JSON review/decision record with the full terms, comparison, model-review provenance, discussion, acknowledgements, decision, and digest consistency checks. The record is workspace-authenticated and is not a digital signature or proof that someone read the agreement.

For the demonstration, open an unpaid café job as Business and load **+$2 and a data-sharing clause**. Publish, switch to Buyer, inspect both changes, and ask which partners receive data before deciding. Notifications are inside the current agreement workspace; this is not subscription repricing, email broadcasting, or a multi-buyer business portal. See [architecture](ARCHITECTURE.md#agreement-change-review).

## Human delivery and scope changes

The same workflow supports a developer delivering a small website. The initial café project provides this secondary walkthrough: approve as both roles, authorize, verify the broken and corrected deliveries, accept the manual design criterion as Buyer, and approve capture.

Before capture, compare a new loyalty-program request in **Scope changes**. A scope request pauses automatic payment until the buyer decides how to proceed. To replace the agreement, void its authorization and draft a replacement with the new amount and checks. Both parties approve again and the buyer supplies a fresh authorization.
