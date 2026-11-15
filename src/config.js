import path from 'node:path';
import fs from 'node:fs';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  dataDir: env.DATA_DIR || path.resolve('data'),
  password: env.DASHBOARD_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || env.DASHBOARD_PASSWORD || 'dev-secret',
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  model: env.MODEL || 'claude-sonnet-5-5',
  tz: env.TZ_NAME || 'Asia/Kolkata',
  // auto-select a group whose name contains this text (case-insensitive)
  groupName: env.TRACK_GROUP_NAME || '',
  // how long to wait after the last message before processing a batch
  debounceMs: Number(env.DEBOUNCE_SECONDS || 90) * 1000,
  batchSize: Number(env.BATCH_SIZE || 40),
  // only run the LLM over history newer than this on first link
  backfillDays: Number(env.BACKFILL_DAYS || 45),
};

for (const d of ['', 'auth', 'media']) fs.mkdirSync(path.join(config.dataDir, d), { recursive: true });
