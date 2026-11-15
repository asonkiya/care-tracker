import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { db, resetExtraction } from './db.js';
import { wa, listGroups, selectGroup, unlink, trackedGroup, requestPairing } from './whatsapp.js';
import { state, runExtraction, fmtDate } from './extract.js';

const app = express();
app.use(express.json());

// ---- auth: single password, signed cookie ----
const token = crypto.createHmac('sha256', config.sessionSecret).update('ok:' + config.password).digest('hex');
const cookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')));
const authed = (req) => !config.password || cookie(req).ct === token || req.headers.authorization === `Bearer ${token}`;

app.get('/healthz', (_req, res) => res.send('ok'));

app.post('/api/login', (req, res) => {
  const ok = config.password && crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(req.body?.password || '')).digest(),
    crypto.createHash('sha256').update(config.password).digest());
  if (!ok) return res.status(401).json({ error: 'Wrong password' });
  res.setHeader('Set-Cookie', `ct=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}${req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
  res.json({ ok: true, token });   // the iOS app sends this as a Bearer token
});

app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'login' })));
app.use('/media', (req, res, next) => (authed(req) ? next() : res.status(401).end()));
app.use('/media', express.static(path.join(config.dataDir, 'media')));

const today = () => fmtDate(Date.now() / 1000);

app.get('/api/status', (_req, res) => {
  res.json({
    whatsapp: wa.status, qr: wa.qr, pairingCode: wa.pairingCode, me: wa.me?.name || wa.me?.id || null,
    group: trackedGroup(),
    extraction: { ...state, pending: db.prepare('SELECT COUNT(*) n FROM messages WHERE processed = 0').get().n },
    messages: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
    hasKey: !!config.anthropicKey,
  });
});

app.post('/api/pair', async (req, res) => {
  try { res.json({ code: await requestPairing(req.body?.phone) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/groups', async (_req, res) => res.json(await listGroups()));
app.post('/api/group', async (req, res) => {
  const { jid, name } = req.body || {};
  if (!jid) return res.status(400).json({ error: 'jid required' });
  const backfilled = await selectGroup(jid, name);
  res.json({ ok: true, backfilled });
});

app.get('/api/overview', (_req, res) => {
  const d = today();
  const supplements = db.prepare("SELECT * FROM supplements WHERE status = 'active' ORDER BY timing, name").all();
  const checked = new Set(db.prepare('SELECT supplement_id FROM checks WHERE date = ?').all(d).map((r) => r.supplement_id));
  res.json({
    today: d,
    supplements: supplements.map((s) => ({ ...s, checked: checked.has(s.id) })),
    stopped: db.prepare("SELECT * FROM supplements WHERE status = 'stopped' ORDER BY updated_ts DESC LIMIT 20").all(),
    rules: db.prepare("SELECT * FROM rules WHERE status = 'active' ORDER BY category, ts").all(),
    items: db.prepare("SELECT * FROM items WHERE status = 'open' ORDER BY (due IS NULL), due, ts").all(),
    done: db.prepare("SELECT * FROM items WHERE status = 'done' ORDER BY resolved_ts DESC LIMIT 20").all(),
    changes: db.prepare('SELECT * FROM changes ORDER BY ts DESC LIMIT 50').all(),
    todayLogs: db.prepare('SELECT * FROM logs WHERE date = ? ORDER BY ts').all(d),
    lastLogDate: db.prepare('SELECT MAX(date) d FROM logs').get().d,
  });
});

app.get('/api/logs', (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 120);
  const since = fmtDate(Date.now() / 1000 - days * 86400);
  res.json(db.prepare('SELECT * FROM logs WHERE date >= ? ORDER BY date DESC, ts').all(since));
});

app.get('/api/messages', (req, res) => {
  const q = String(req.query.q || '').trim();
  const before = Number(req.query.before) || 9e9;
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  if (ids.length) return res.json(db.prepare(`SELECT * FROM messages WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY ts`).all(...ids));
  const rows = q
    ? db.prepare('SELECT * FROM messages WHERE text LIKE ? AND ts < ? ORDER BY ts DESC LIMIT 60').all(`%${q}%`, before)
    : db.prepare('SELECT * FROM messages WHERE ts < ? ORDER BY ts DESC LIMIT 60').all(before);
  res.json(rows);
});

app.post('/api/check/:id', (req, res) => {
  const d = today(), id = Number(req.params.id);
  const exists = db.prepare('SELECT 1 FROM checks WHERE date = ? AND supplement_id = ?').get(d, id);
  if (exists) db.prepare('DELETE FROM checks WHERE date = ? AND supplement_id = ?').run(d, id);
  else db.prepare('INSERT INTO checks (date, supplement_id) VALUES (?, ?)').run(d, id);
  res.json({ checked: !exists });
});

app.post('/api/items/:id/toggle', (req, res) => {
  const it = db.prepare('SELECT status FROM items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).end();
  const next = it.status === 'open' ? 'done' : 'open';
  db.prepare('UPDATE items SET status = ?, resolved_ts = ? WHERE id = ?').run(next, next === 'done' ? Math.floor(Date.now() / 1000) : null, req.params.id);
  res.json({ status: next });
});

app.post('/api/process-now', (_req, res) => { runExtraction(); res.json({ ok: true }); });
app.post('/api/reprocess', (_req, res) => { resetExtraction(); runExtraction(); res.json({ ok: true }); });
app.post('/api/unlink', async (_req, res) => { await unlink(); res.json({ ok: true }); });

app.use(express.static(path.resolve('public')));
app.get('/{*splat}', (_req, res) => res.sendFile(path.resolve('public/index.html')));

export function startServer() {
  if (!config.password) console.warn('⚠️  DASHBOARD_PASSWORD is not set — the dashboard is open to anyone with the URL.');
  app.listen(config.port, () => console.log(`Dashboard on :${config.port}`));
}
