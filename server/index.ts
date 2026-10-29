import 'dotenv/config';
import { initDb } from './db.js';
import { createApp } from './app.js';
import { startWorker } from './worker.js';
await initDb();
const port = Number(process.env.PORT || 3001);
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
createApp().listen(port, host, () => {
  console.log(
    `ProofPay API ready on port ${port}. Payments: sandbox only. Unauthenticated visitors get isolated demo workspaces.`,
  );
  if (process.env.RUN_WORKER !== 'false') startWorker();
});
