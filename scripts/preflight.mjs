// Checks that this machine is ready to record the live provider run.
// Makes one small real request to each configured provider. Prints no secrets.
// Creates no order, capture, refund, or webhook registration.
import 'dotenv/config';

const results = [];
const record = (name, status, detail) => results.push({ name, status, detail });
const env = (key) => (process.env[key] || '').trim();

async function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ok = major > 22 || (major === 22 && minor >= 18);
  record('Node.js', ok ? 'pass' : 'fail', `${process.versions.node} (needs 22.18 or newer)`);
}

async function checkBrowser() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const version = browser.version();
    await browser.close();
    record('Chromium', 'pass', `launched ${version}`);
  } catch (error) {
    record(
      'Chromium',
      'fail',
      `could not launch. Run "npm run browser:install". ${firstLine(error)}`,
    );
  }
}

async function checkOpenAI() {
  if (!env('OPENAI_API_KEY'))
    return record('OpenAI', 'skip', 'OPENAI_API_KEY is empty; the repair agent stays disabled');
  const model = env('OPENAI_MODEL') || 'gpt-4.1-mini';
  try {
    // Same endpoint and strict structured-output format the repair agent uses.
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        instructions: 'Reply with ready set to true.',
        input: 'preflight',
        text: {
          format: {
            type: 'json_schema',
            name: 'preflight',
            strict: true,
            schema: {
              type: 'object',
              properties: { ready: { type: 'boolean' } },
              required: ['ready'],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return record(
        'OpenAI',
        'fail',
        `HTTP ${response.status} for model "${model}": ${body?.error?.message || 'no message'}`,
      );
    }
    const data = await response.json();
    const text = data.output
      ?.flatMap((item) => item.content || [])
      .find((content) => content.type === 'output_text')?.text;
    JSON.parse(text);
    record('OpenAI', 'pass', `model "${model}" returned structured output`);
  } catch (error) {
    record('OpenAI', 'fail', firstLine(error));
  }
}

async function checkPayPal() {
  const id = env('PAYPAL_CLIENT_ID');
  const secret = env('PAYPAL_CLIENT_SECRET');
  if (!id && !secret)
    return record('PayPal sandbox', 'skip', 'credentials are empty; payments stay simulated');
  if (!id || !secret)
    return record('PayPal sandbox', 'fail', 'set both PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
  const base = 'https://api-m.sandbox.paypal.com';
  let token;
  try {
    const response = await fetch(base + '/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      return record(
        'PayPal sandbox',
        'fail',
        `sign-in returned HTTP ${response.status}. Use the sandbox app's credentials, not live ones.`,
      );
    token = (await response.json()).access_token;
    record('PayPal sandbox', 'pass', 'sandbox REST app signed in');
  } catch (error) {
    return record('PayPal sandbox', 'fail', firstLine(error));
  }

  const webhookId = env('PAYPAL_WEBHOOK_ID');
  if (!webhookId)
    return record(
      'PayPal webhook',
      'skip',
      'PAYPAL_WEBHOOK_ID is empty; captures and refunds still confirm through the API',
    );
  try {
    const response = await fetch(`${base}/v1/notifications/webhooks/${webhookId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      return record(
        'PayPal webhook',
        'fail',
        `webhook ID not found in this sandbox app (HTTP ${response.status})`,
      );
    const hook = await response.json();
    const expected = env('APP_URL').replace(/\/$/, '') + '/api/paypal/webhook';
    if (hook.url !== expected)
      return record(
        'PayPal webhook',
        'fail',
        `registered for ${hook.url}, but APP_URL expects ${expected}`,
      );
    record('PayPal webhook', 'pass', `registered for ${hook.url}`);
  } catch (error) {
    record('PayPal webhook', 'fail', firstLine(error));
  }
}

function checkInvites() {
  const developer = env('DEVELOPER_INVITE');
  const buyer = env('BUYER_INVITE');
  if (!developer && !buyer)
    return record(
      'Role invitations',
      'skip',
      'empty; only the isolated walkthrough (simulated payments) is reachable',
    );
  if (developer.length < 32 || buyer.length < 32)
    return record('Role invitations', 'fail', 'each invitation needs at least 32 characters');
  if (developer === buyer)
    return record('Role invitations', 'fail', 'buyer and developer invitations must differ');
  record('Role invitations', 'pass', 'two distinct invitations set');
}

function firstLine(error) {
  return String(error?.message || error).split('\n')[0];
}

await checkNode();
await checkBrowser();
await checkOpenAI();
await checkPayPal();
checkInvites();

const label = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' };
for (const { name, status, detail } of results)
  console.log(`${label[status]}  ${name.padEnd(17)} ${detail}`);

const status = (name) => results.find((result) => result.name === name)?.status;
const failed = results.some((result) => result.status === 'fail');
const base = status('Node.js') === 'pass' && status('Chromium') === 'pass';
const ai = status('OpenAI') === 'pass';
const sandbox = status('PayPal sandbox') === 'pass' && status('Role invitations') === 'pass';

console.log('');
if (failed) console.log('Fix the FAIL lines above, then run this again.');
else if (base && ai && sandbox)
  console.log(
    'Ready for the full live run: model-written repair with a real PayPal sandbox capture.\n' +
      'Enter the merchant workspace with the role invitations (Connections & access).',
  );
else if (base && ai)
  console.log(
    'Ready for a model-written repair with SIMULATED payment.\n' +
      'Add PayPal sandbox credentials and role invitations for a real sandbox capture.',
  );
else if (base)
  console.log(
    'Ready for the no-key guided demo only (authored fixtures, simulated payment).\n' +
      'Add OPENAI_API_KEY for the repair agent.',
  );
process.exit(failed ? 1 : 0);
