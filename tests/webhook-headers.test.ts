import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyWebhook } from '../server/paypal.js';

test('incomplete webhook signatures are rejected before any provider request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('Unsigned events must not request a provider token or verification.');
  };
  const signed = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/test',
    'paypal-transmission-id': 'test',
    'paypal-transmission-sig': 'test',
    'paypal-transmission-time': '2026-10-29T00:00:00Z',
  };
  try {
    for (const missing of Object.keys(signed)) {
      const headers: Record<string, string> = { ...signed };
      delete headers[missing];
      await assert.rejects(verifyWebhook(headers, { id: 'forged' }), (error: any) => {
        assert.equal(error.status, 400);
        return true;
      });
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
