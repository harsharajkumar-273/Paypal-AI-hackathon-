import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { verify } from '../server/verifier.js';
import { cafeHtml } from '../server/fixtures.js';
import { cafeCriteria } from '../server/domain.js';
test(
  'real Chromium distinguishes broken and corrected form and captures evidence',
  { timeout: 120000 },
  async () => {
    const app = express();
    app.get('/fixtures/broken', (_, res) => res.send(cafeHtml(false)));
    app.get('/fixtures/fixed', (_, res) => res.send(cafeHtml(true)));
    app.post('/fixtures/reserve', (_, res) => res.json({ ok: true }));
    const server = await new Promise<any>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const broken = await verify(origin + '/fixtures/broken', cafeCriteria, {
        fixture: true,
        fixtureOrigin: origin,
      });
      assert.equal(broken.find((r) => r.criterionId === 'booking')?.status, 'fail');
      assert.equal(
        broken.filter((r) => r.status === 'pass').length,
        4,
        JSON.stringify(broken.map(({ screenshot, ...r }) => r)),
      );
      assert.equal(broken.find((r) => r.criterionId === 'design')?.status, 'manual');
      const fixed = await verify(origin + '/fixtures/fixed', cafeCriteria, {
        fixture: true,
        fixtureOrigin: origin,
      });
      assert.equal(
        fixed.filter((r) => r.status === 'pass').length,
        5,
        JSON.stringify(fixed.map(({ screenshot, ...r }) => r)),
      );
      assert.ok(
        fixed
          .filter((r) => r.status === 'pass')
          .every((r) => r.screenshot && r.screenshot.length > 100),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
