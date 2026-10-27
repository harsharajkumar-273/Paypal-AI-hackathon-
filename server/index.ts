import 'dotenv/config';
import { initDb } from './db.js';
import { createApp } from './app.js';
import { startWorker } from './worker.js';
await initDb();
const port = Number(process.env.PORT || 3001);
createApp().listen(port, () => {
  console.log(
    `ProofPay API ready on port ${port}. Payments: sandbox only. Unauthenticated visitors get isolated demo workspaces.`,
  );
  if (process.env.RUN_WORKER !== 'false') startWorker();
});
