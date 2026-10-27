import { chromium } from 'playwright';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { type Criterion, type Result, AppError } from './domain.js';
export function privateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number);
    return (
      x === 0 ||
      x === 10 ||
      x === 127 ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && (y === 168 || y === 0)) ||
      (x === 100 && y >= 64 && y <= 127) ||
      x >= 224 ||
      (x === 198 && (y === 18 || y === 19))
    );
  }
  if (net.isIPv6(a))
    return (
      !/^[23]/.test(a) || a.startsWith('2001:db8:') || a.startsWith('2002:') || a.includes('ffff:')
    );
  return true;
}
export async function safeUrl(raw: string, origins: string[]) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || !origins.includes(url.origin))
    throw new AppError(400, 'This website origin is not approved for verification.');
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
    throw new AppError(400, 'Private or reserved network destinations are not permitted.');
  return url;
}
export async function verify(
  url: string,
  criteria: Criterion[],
  opts: {
    fixture?: boolean;
    fixtureOrigin?: string;
    origins?: string[];
    formEndpoints?: string[];
    deadlineMs?: number;
  } = {},
) {
  const fixtureOrigin = opts.fixtureOrigin || `http://127.0.0.1:${process.env.PORT || 3001}`;
  const fixture = opts.fixture === true;
  if (fixture) {
    const u = new URL(url);
    if (
      u.origin !== fixtureOrigin ||
      (!['/fixtures/broken', '/fixtures/fixed'].includes(u.pathname) &&
        !/^\/fixtures\/agent\/[0-9a-f-]{36}$/.test(u.pathname))
    )
      throw new AppError(400, 'Unknown built-in fixture.');
  } else await safeUrl(url, opts.origins || []);
  // Pin validated DNS answers inside Chromium to prevent rebinding between validation and navigation.
  const resolutions: string[] = [];
  if (!fixture)
    for (const origin of opts.origins || []) {
      const u = await safeUrl(origin, opts.origins || []);
      const a = await lookup(u.hostname, { all: true });
      resolutions.push(`MAP ${u.hostname} ${a[0].address}`);
    }
  const browser = await chromium.launch({
    headless: true,
    args: [
      ...(resolutions.length ? [`--host-resolver-rules=${resolutions.join(',')}`] : []),
      '--disable-quic',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  await context.route('**/*', async (route) => {
    try {
      const request = route.request(),
        u = new URL(request.url());
      if (fixture) {
        if (
          u.origin !== fixtureOrigin ||
          (!['/fixtures/broken', '/fixtures/fixed', '/fixtures/reserve'].includes(u.pathname) &&
            !/^\/fixtures\/agent\/[0-9a-f-]{36}$/.test(u.pathname))
        )
          return route.abort();
      } else await safeUrl(u.href, opts.origins || []);
      if (!['GET', 'HEAD'].includes(request.method())) {
        if (
          !(fixture && u.pathname === '/fixtures/reserve') &&
          !(opts.formEndpoints || []).includes(u.href)
        )
          return route.abort();
      }
      await route.continue();
    } catch {
      await route.abort();
    }
  });
  await context.routeWebSocket('**/*', (ws) => ws.close());
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.setDefaultNavigationTimeout(12000);
  page.on('dialog', (d) => void d.dismiss());
  context.on('page', (p) => {
    if (p !== page) void p.close();
  });
  const deadline = setTimeout(() => void browser.close(), opts.deadlineMs || 65000);
  const results: Result[] = [];
  try {
    for (const c of criteria) {
      const start = performance.now();
      let status: Result['status'] = 'inconclusive',
        observed = '',
        screenshot: string | undefined;
      if (c.type === 'manual') {
        results.push({
          criterionId: c.id,
          status: 'manual',
          observed: 'Buyer review required. No automated judgment is made.',
          durationMs: 0,
        });
        continue;
      }
      try {
        await page.setViewportSize(
          c.type === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        );
        const response = await page.goto(url, { waitUntil: 'networkidle' });
        if (!response?.ok())
          throw new Error(`Website returned ${response?.status() || 'no response'}.`);
        const locator = page.locator(c.selector || 'body');
        if (c.type === 'text') {
          const text = await locator.innerText();
          status = text.includes(c.expected) ? 'pass' : 'fail';
          observed =
            status === 'pass'
              ? `Found “${c.expected}” in ${c.selector}.`
              : `Expected “${c.expected}”; observed “${text.slice(0, 250)}”.`;
        }
        if (c.type === 'link') {
          const href = await locator.getAttribute('href');
          status = href === c.expected ? 'pass' : 'fail';
          observed = `Link destination: ${href || '(missing)'}. Expected: ${c.expected}.`;
        }
        if (c.type === 'required') {
          const names = c.expected
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
          if (!names.length) throw new Error('No required field names specified.');
          const missing = [];
          for (const name of names) {
            const input = locator.locator('input, select, textarea').filter({ visible: true });
            const fields = await input.evaluateAll(
              (els, n) =>
                els
                  .filter((e) => (e as HTMLInputElement).name === n)
                  .map((e) => ({
                    required: (e as HTMLInputElement).required,
                    disabled: (e as HTMLInputElement).disabled,
                  })),
              name,
            );
            if (fields.length !== 1 || !fields[0].required || fields[0].disabled)
              missing.push(name);
          }
          status = missing.length ? 'fail' : 'pass';
          observed = missing.length
            ? `Missing required attributes on: ${missing.join(', ')}.`
            : `${names.join(' and ')} are enabled, visible, and required.`;
        }
        if (c.type === 'form') {
          const action = await locator.evaluate((e: HTMLFormElement) => ({
            url: e.action,
            method: e.method,
          }));
          if (
            !(fixture && action.url === fixtureOrigin + '/fixtures/reserve') &&
            !(opts.formEndpoints || []).includes(action.url)
          )
            throw new Error('This form endpoint has not been approved for test submissions.');
          await locator.locator('input[name="name"]').fill('ProofPay verification');
          await locator.locator('input[name="email"]').fill('verification@example.com');
          let successResponse = false;
          const listener = (r: any) => {
            if (r.url() === action.url && r.request().method() === 'POST' && r.ok())
              successResponse = true;
          };
          page.on('response', listener);
          await locator.locator('button[type="submit"],input[type="submit"]').first().click();
          await page
            .getByText(c.expected, { exact: true })
            .waitFor({ state: 'visible', timeout: 3500 })
            .catch(() => {});
          const successText = await page
            .getByText(c.expected, { exact: true })
            .isVisible()
            .catch(() => false);
          page.off('response', listener);
          status = successText && successResponse ? 'pass' : 'fail';
          observed =
            status === 'pass'
              ? `Approved test endpoint returned success and displayed “${c.expected}”.`
              : 'Reservation was not confirmed by both the approved endpoint and the page. Check the form submission handler.';
        }
        if (c.type === 'mobile') {
          const size = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
          }));
          status = size.scroll <= size.viewport ? 'pass' : 'fail';
          observed = `Content width ${size.scroll}px / viewport ${size.viewport}px. ${status === 'pass' ? 'No horizontal overflow.' : 'Horizontal overflow detected.'}`;
        }
        screenshot = (
          await page.screenshot({ type: 'jpeg', quality: 65, fullPage: false, timeout: 5000 })
        ).toString('base64');
      } catch (err) {
        status = 'inconclusive';
        observed = err instanceof Error ? err.message.slice(0, 500) : 'Check could not complete.';
      }
      results.push({
        criterionId: c.id,
        status,
        observed,
        screenshot,
        durationMs: Math.round(performance.now() - start),
      });
    }
    return results;
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
