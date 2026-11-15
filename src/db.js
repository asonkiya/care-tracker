import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from './config.js';

export const db = new Database(path.join(config.dataDir, 'tracker.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_jid TEXT NOT NULL,
  sender TEXT,
  sender_name TEXT,
  from_me INTEGER DEFAULT 0,
  ts INTEGER NOT NULL,             -- unix seconds
  text TEXT,
  media_kind TEXT,                 -- image | pdf | audio | video | sticker | file
  media_path TEXT,
  mime TEXT,
  reply_to TEXT,
  processed INTEGER DEFAULT 0      -- 0 = pending, 1 = done
);
CREATE INDEX IF NOT EXISTS idx_msg_chat_ts ON messages(chat_jid, ts);
CREATE INDEX IF NOT EXISTS idx_msg_pending ON messages(processed, ts);

CREATE TABLE IF NOT EXISTS supplements (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,                 -- normalised name
  name TEXT, dose TEXT, timing TEXT, notes TEXT,
  status TEXT DEFAULT 'active',    -- active | stopped
  started_ts INTEGER, updated_ts INTEGER, source_msg TEXT
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  category TEXT, text TEXT,
  status TEXT DEFAULT 'active',    -- active | retired
  ts INTEGER, source_msg TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
  date TEXT, category TEXT, summary TEXT, value TEXT,
  ts INTEGER, source_msg TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  kind TEXT,                       -- task | question | appointment | test
  title TEXT, details TEXT,
  owner TEXT,                      -- me | team
  due TEXT,
  status TEXT DEFAULT 'open',      -- open | done
  resolution TEXT,
  ts INTEGER, resolved_ts INTEGER, source_msg TEXT
);

CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY, ts INTEGER, summary TEXT, source_msg TEXT
);

CREATE TABLE IF NOT EXISTS checks (
  date TEXT, supplement_id INTEGER, PRIMARY KEY (date, supplement_id)
);
`);

export const getSetting = (k, d = null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  return r ? JSON.parse(r.value) : d;
};
export const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(k, JSON.stringify(v));

const insertMsg = db.prepare(`INSERT OR IGNORE INTO messages
  (id, chat_jid, sender, sender_name, from_me, ts, text, media_kind, media_path, mime, reply_to, processed)
  VALUES (@id, @chat_jid, @sender, @sender_name, @from_me, @ts, @text, @media_kind, @media_path, @mime, @reply_to, @processed)`);
export const saveMessage = (m) => insertMsg.run({ media_kind: null, media_path: null, mime: null, reply_to: null, processed: 0, ...m }).changes > 0;

/** wipe everything the LLM produced so history can be re-extracted */
export function resetExtraction() {
  db.exec(`DELETE FROM supplements; DELETE FROM rules; DELETE FROM logs; DELETE FROM items;
           DELETE FROM changes; DELETE FROM checks; UPDATE messages SET processed = 0;`);
}
