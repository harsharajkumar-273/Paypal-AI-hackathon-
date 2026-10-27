import { AppError, type Agreement } from './domain.js';
export class PayPalError extends AppError {
  constructor(
    public providerStatus: number,
    public providerName: string,
    public issues: string[] = [],
  ) {
    super(
      502,
      `PayPal could not confirm this operation (${providerName || providerStatus}). Retry safely or reconcile its status.`,
    );
  }
  get definitive() {
    return (
      this.providerStatus >= 400 &&
      this.providerStatus < 500 &&
      ![408, 409, 429].includes(this.providerStatus) &&
      !this.issues.some((issue) => /IN_PROGRESS|PENDING|DUPLICATE/.test(issue))
    );
  }
}
const base = 'https://api-m.sandbox.paypal.com';
export const paypalConfigured = () =>
  Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
async function token() {
  if (!paypalConfigured())
    throw new AppError(503, 'Add PayPal sandbox credentials to enable real sandbox payments.');
  const response = await fetch(base + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString(
          'base64',
        ),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new AppError(502, 'PayPal authentication failed. Check the sandbox credentials.');
  return ((await response.json()) as any).access_token;
}
export async function paypal(path: string, method = 'GET', body?: unknown, requestId?: string) {
  const access = await token();
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data: any = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw new PayPalError(
      response.status,
      data.name || String(response.status),
      data.details?.map((d: any) => String(d.issue)) || [],
    );
  return data;
}
export async function createOrder(a: Agreement) {
  return paypal(
    '/v2/checkout/orders',
    'POST',
    {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: a.id,
          custom_id: `${a.id}:v${a.version}`,
          description: a.title,
          amount: { currency_code: 'USD', value: (a.amount / 100).toFixed(2) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'ProofPay',
            user_action: 'PAY_NOW',
            return_url: `${process.env.APP_URL || 'http://localhost:5173'}/?paypal=approved`,
            cancel_url: `${process.env.APP_URL || 'http://localhost:5173'}/?paypal=cancelled`,
          },
        },
      },
    },
    `${a.id}-v${a.version}-create-${a.payment.operation || '1'}`,
  );
}
export const authorizeOrder = (orderId: string, id: string) =>
  paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, 'POST', {}, id);
export const capturePayment = (a: Agreement) =>
  paypal(
    `/v2/payments/authorizations/${encodeURIComponent(a.payment.authorizationId!)}/capture`,
    'POST',
    {
      amount: { currency_code: 'USD', value: (a.amount / 100).toFixed(2) },
      final_capture: true,
      invoice_id: `${a.id}-v${a.version}`,
    },
    `${a.id}-v${a.version}-capture`,
  );
export const voidPayment = (a: Agreement) =>
  paypal(
    `/v2/payments/authorizations/${encodeURIComponent(a.payment.authorizationId!)}/void`,
    'POST',
    {},
    `${a.id}-v${a.version}-void`,
  );
export async function verifyWebhook(headers: Record<string, any>, body: unknown) {
  if (!process.env.PAYPAL_WEBHOOK_ID)
    throw new AppError(503, 'PayPal webhook ID is not configured.');
  const data = await paypal('/v1/notifications/verify-webhook-signature', 'POST', {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: body,
  });
  if (data.verification_status !== 'SUCCESS')
    throw new AppError(400, 'Invalid PayPal webhook signature.');
}
