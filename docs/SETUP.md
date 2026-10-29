# Configuration and provider runs

Start with the [local setup](../README.md#run-locally). Set secrets in the local `.env` file or your hosting provider’s secret configuration. Restart after changing them. `.env` and local databases are excluded from Git and Docker build context.

## Environments

| Mode                     | Entry                                        | Agent                                      | Payment                   |
| ------------------------ | -------------------------------------------- | ------------------------------------------ | ------------------------- |
| No-key walkthrough       | Default isolated workspace                   | Authored fixtures; repair control disabled | Simulated                 |
| Model-backed walkthrough | Isolated workspace plus OpenAI key           | Model-generated repair                     | Simulated                 |
| Merchant sandbox         | Separate role invitations plus provider keys | Model-generated repair                     | Actual PayPal sandbox API |

An OpenAI key alone does not turn a walkthrough payment into a provider transaction. Payment mode belongs to the workspace.

## Server configuration

| Variable                                   | Purpose                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `PORT`                                     | API port; local default `3001`; change it if occupied, then restart (the Vite proxy follows it)         |
| `APP_URL`                                  | Exact frontend origin, `http://localhost:5173` in development; final HTTPS origin when hosted           |
| `DATABASE_URL`                             | External PostgreSQL connection string; blank for local embedded storage                                 |
| `DATABASE_SSL`                             | Set `true` when your database connection requires SSL                                                   |
| `RUN_WORKER`                               | `true` for one-process local execution; `false` on the hosted web service with a separate worker        |
| `FIXTURE_ORIGIN`                           | Public web-service origin used by a separate worker to reach built-in café fixtures and agent artifacts |
| `OPENAI_API_KEY`                           | Enables the repair agent, structured criteria, scope comparison, and evidence summaries                 |
| `OPENAI_MODEL`                             | Model identifier; application default `gpt-4.1-mini`                                                    |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Server-side credentials for a PayPal sandbox REST app                                                   |
| `PAYPAL_WEBHOOK_ID`                        | Webhook ID registered in that same sandbox app                                                          |
| `DEVELOPER_INVITE`, `BUYER_INVITE`         | Distinct role secrets, each at least 32 characters                                                      |
| `ALLOWED_ORIGINS`                          | Comma-separated operator-approved HTTPS origins for external website checks                             |
| `ALLOWED_FORM_ENDPOINTS`                   | Exact endpoint URLs approved for synthetic form submissions                                             |

Generate each invitation separately with `openssl rand -hex 32`. Share it privately with its intended participant. Enter it in **Connections & access**. Real sessions have fixed roles; use separate browser profiles for buyer and seller. The shared merchant workspace begins empty.

## OpenAI run

1. Set the API key and selected model on the process executing the agent. With a separate worker, configure the key/model on both web and worker.
2. In the isolated walkthrough or merchant workspace, commission the bounded agent task as Buyer.
3. Approve the same version with both roles, authorize payment, and explicitly enable standing rules covering the price and monthly budget.
4. As Business, open **Agent work** and start the agent. Inspect its baseline, generated patch, independent results, artifact digest, and evidence.
5. Record actual duration and outcome in [VALIDATION.md](VALIDATION.md). A failed model call or unsuccessful repair is an observed failure, not a completed demonstration.

## PayPal sandbox run

Use a sandbox business seller and a different sandbox personal buyer. Configure the REST app belonging to the intended seller. The server targets `api-m.sandbox.paypal.com`.

1. Set client credentials and distinct role invitations. Enter the merchant workspace; the default isolated walkthrough always simulates payment.
2. Set `APP_URL` to the frontend origin used in the browser. On a hosted build, use the final HTTPS URL.
3. Register the public HTTPS `/api/paypal/webhook` endpoint in the same sandbox app. Subscribe to relevant payment authorization, capture, and capture-refund events, and set its webhook ID on the web service.
4. Commission an agent task, approve both roles, and create an authorization as Buyer.
5. Select **Continue on PayPal**, approve with the sandbox buyer account, return, and choose **I approved · confirm authorization**. Check the provider authorization ID.
6. Enable standing rules and run the agent as Business. After successful independent checks, inspect the capture receipt and confirm the transaction in the seller’s sandbox account.
7. Retry/reconcile as appropriate and confirm there is only one capture. Test a verified duplicate webhook and an invalid-signature rejection.
8. Open a support case as Buyer. Review and issue a refund as Seller. Confirm its provider status and seller-account record, then verify automation stays paused until the buyer resumes it.

Keep transaction evidence and redacted run details in the validation record. Keep account logins, access tokens, invitation secrets, and private buyer information out of screenshots and source control.

## Human website verification

For a human-delivered project, set an operator-approved HTTPS delivery origin and dedicated test-form endpoint. Private/reserved destinations are blocked. Form checks currently fill `input[name="name"]` and `input[name="email"]`, submit, and require a successful POST to the approved action URL plus the agreed visible success message.

The app serves `/fixtures/broken` and `/fixtures/fixed` for the walkthrough. Merchant website submissions must retain the same approved URL before and after the correction; host a dedicated test site and update its handler at that URL. The commissioned agent task uses its built-in artifact adapter instead of arbitrary external source code.

## Hosted deployment

The [Render Blueprint](../render.yaml) defines Docker web/worker services and a PostgreSQL database. Review provider costs before provisioning.

1. Publish the source repository with its root `LICENSE`. Confirm it is publicly readable while signed out and that GitHub recognizes the MIT license.
2. Create a Blueprint deployment from the repository and configure prompted values.
3. Set web `APP_URL` and worker `FIXTURE_ORIGIN` to the same public HTTPS web origin. Do not use a private service hostname for browser fixtures.
4. Share the database between web and worker. Set `RUN_WORKER=false` on web. Configure OpenAI and website allowlists consistently on both processes; PayPal credentials, webhook ID, and role invitations belong on web.
5. Check `/api/health`, a queued browser run, authenticated screenshot retrieval, separate-role access, and worker restart recovery.
6. Repeat the complete provider flow on the deployed build before recording it.

Run the credential-free deployment check against the final origin:

```sh
npm run smoke -- https://your-proofpay-host
```

This creates a fresh private demo, checks the broken and corrected fixtures through the running worker, verifies that screenshots require authentication, and checks automatic simulated capture. It exits nonzero on a missing worker, timeout, incorrect findings, or missing receipt. It does not validate live AI, PayPal transactions, signed webhooks, or participant usability.

For a production-style single-process local run:

```sh
npm run build
APP_URL=http://localhost:3001 npm start
```

Judge access can use the isolated walkthrough plus the public video of the configured provider run. Arrange controlled merchant access separately if needed; never publish buyer/seller invitation secrets in the README. Complete repository setup instructions are also an evaluation route under the supplied hackathon requirements.

See the [product limits](../README.md#limits) and [pending acceptance checks](VALIDATION.md#launch-acceptance) before submission.
