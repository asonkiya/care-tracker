import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { db, getSetting } from './db.js';

const client = config.anthropicKey ? new Anthropic({ apiKey: config.anthropicKey }) : null;

export const fmtDate = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts * 1000));
const fmtTime = (ts) => new Intl.DateTimeFormat('en-GB', { timeZone: config.tz, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date(ts * 1000));
const keyOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const SYSTEM = `You maintain a structured health tracker for ONE client, built from their WhatsApp group with their care team (doctor, nutritionist, coach, etc.).
"Me" is the client. Everyone else is on the care team unless the messages clearly show otherwise.

You receive the tracker's current state and a batch of new messages (ids in square brackets). Call the "update_tracker" tool exactly once with every change the new messages imply. Rules:
- Supplements/medicines: only what the care team prescribes or the client confirms starting. Reuse the exact existing name when updating or stopping. Put dose and timing (e.g. "after breakfast", "bedtime") in their own fields.
- Rules: standing diet/lifestyle guidance ("no sugar after 6pm", "2.5L water daily", "30 min walk"). Retire a rule by id when the team replaces or cancels it.
- Logs: things the client reports doing or experiencing (meals, supplements taken, weight, sleep, symptoms, exercise, water, mood, readings). One log per distinct entry; date = the day it refers to (YYYY-MM-DD).
- Items: tasks for the client (book a test, send a photo), questions the client asked that still need an answer, questions the team asked the client, appointments/calls, lab tests ordered. Close an existing open item by id when it is answered/done, with a short resolution.
- Changes: one short human-readable line for each meaningful change to the plan (e.g. "Magnesium moved to bedtime").
- Ignore greetings, thanks, emojis and chit-chat. If nothing is relevant, call the tool with empty arrays.
- Always cite the source message id. Be concise; do not invent details that are not in the messages.`;

const arr = (props, required) => ({ type: 'array', items: { type: 'object', properties: props, required } });
const TOOL = {
  name: 'update_tracker',
  description: 'Apply the changes implied by the new messages.',
  input_schema: {
    type: 'object',
    properties: {
      supplements: arr({
        action: { type: 'string', enum: ['add', 'update', 'stop'] },
        name: { type: 'string' }, dose: { type: 'string' }, timing: { type: 'string' }, notes: { type: 'string' },
        source_msg_id: { type: 'string' },
      }, ['action', 'name', 'source_msg_id']),
      rules: arr({
        action: { type: 'string', enum: ['add', 'retire'] },
        id: { type: 'integer', description: 'existing rule id, for retire' },
        category: { type: 'string', enum: ['diet', 'hydration', 'exercise', 'sleep', 'lifestyle', 'other'] },
        text: { type: 'string' }, source_msg_id: { type: 'string' },
      }, ['action', 'source_msg_id']),
      logs: arr({
        date: { type: 'string', description: 'YYYY-MM-DD' },
        category: { type: 'string', enum: ['meal', 'supplement', 'weight', 'sleep', 'symptom', 'exercise', 'water', 'mood', 'reading', 'other'] },
        summary: { type: 'string' }, value: { type: 'string', description: 'number + unit if any, e.g. "72.4 kg"' },
        source_msg_id: { type: 'string' },
      }, ['date', 'category', 'summary', 'source_msg_id']),
      items: arr({
        action: { type: 'string', enum: ['open', 'close'] },
        id: { type: 'integer', description: 'existing item id, for close' },
        kind: { type: 'string', enum: ['task', 'question', 'appointment', 'test'] },
        title: { type: 'string' }, details: { type: 'string' },
        owner: { type: 'string', enum: ['me', 'team'], description: 'who needs to act next' },
        due: { type: 'string', description: 'YYYY-MM-DD or YYYY-MM-DD HH:MM if known' },
        resolution: { type: 'string' }, source_msg_id: { type: 'string' },
      }, ['action', 'source_msg_id']),
      changes: arr({ summary: { type: 'string' }, source_msg_id: { type: 'string' } }, ['summary', 'source_msg_id']),
    },
    required: ['supplements', 'rules', 'logs', 'items', 'changes'],
  },
};

function currentState() {
  const sup = db.prepare("SELECT name, dose, timing, notes FROM supplements WHERE status = 'active'").all();
  const rules = db.prepare("SELECT id, category, text FROM rules WHERE status = 'active'").all();
  const items = db.prepare("SELECT id, kind, title, owner, due FROM items WHERE status = 'open'").all();
  return JSON.stringify({ active_supplements: sup, active_rules: rules, open_items: items }, null, 1);
}

const line = (m) => `[${m.id}] ${fmtTime(m.ts)} ${fmtDate(m.ts)} — ${m.from_me ? 'Me' : (m.sender_name || 'Team member')}${m.reply_to ? ` (replying to ${m.reply_to})` : ''}: ${m.text || ''}${m.media_kind ? ` <${m.media_kind} attached>` : ''}`;

function buildContent(batch, context) {
  const blocks = [{
    type: 'text',
    text: `Today is ${fmtDate(Date.now() / 1000)} (${config.tz}).\n\nCURRENT STATE:\n${currentState()}\n\n` +
      (context.length ? `EARLIER MESSAGES (context only, already processed):\n${context.map(line).join('\n')}\n\n` : '') +
      `NEW MESSAGES:\n${batch.map(line).join('\n')}`,
  }];
  let media = 0;
  for (const m of batch) {
    if (!m.media_path || media >= 6) continue;
    const file = path.join(config.dataDir, 'media', m.media_path);
    if (!fs.existsSync(file) || fs.statSync(file).size > 4.5e6) continue;
    const data = fs.readFileSync(file).toString('base64');
    blocks.push({ type: 'text', text: `Attachment for message [${m.id}]:` });
    blocks.push(m.media_kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: m.mime?.split(';')[0] || 'image/jpeg', data } });
    media++;
  }
  return blocks;
}

export function applyUpdate(u, batch) {
  const tsOf = Object.fromEntries(batch.map((m) => [m.id, m.ts]));
  const now = Math.floor(Date.now() / 1000);
  const ts = (id) => tsOf[id] || now;

  db.transaction(() => {
    for (const s of u.supplements || []) {
      const key = keyOf(s.name);
      const existing = db.prepare('SELECT * FROM supplements WHERE key = ?').get(key);
      if (s.action === 'stop') {
        if (existing) db.prepare("UPDATE supplements SET status = 'stopped', updated_ts = ?, source_msg = ? WHERE id = ?").run(ts(s.source_msg_id), s.source_msg_id, existing.id);
      } else if (existing) {
        db.prepare(`UPDATE supplements SET name = ?, dose = COALESCE(?, dose), timing = COALESCE(?, timing), notes = COALESCE(?, notes),
                    status = 'active', updated_ts = ?, source_msg = ? WHERE id = ?`)
          .run(s.name, s.dose || null, s.timing || null, s.notes || null, ts(s.source_msg_id), s.source_msg_id, existing.id);
      } else {
        db.prepare('INSERT INTO supplements (key, name, dose, timing, notes, started_ts, updated_ts, source_msg) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(key, s.name, s.dose || null, s.timing || null, s.notes || null, ts(s.source_msg_id), ts(s.source_msg_id), s.source_msg_id);
      }
    }
    for (const r of u.rules || []) {
      if (r.action === 'retire' && r.id) db.prepare("UPDATE rules SET status = 'retired' WHERE id = ?").run(r.id);
      else if (r.action === 'add' && r.text) db.prepare('INSERT INTO rules (category, text, ts, source_msg) VALUES (?, ?, ?, ?)').run(r.category || 'other', r.text, ts(r.source_msg_id), r.source_msg_id);
    }
    for (const l of u.logs || []) {
      db.prepare('INSERT INTO logs (date, category, summary, value, ts, source_msg) VALUES (?, ?, ?, ?, ?, ?)')
        .run(l.date || fmtDate(ts(l.source_msg_id)), l.category, l.summary, l.value || null, ts(l.source_msg_id), l.source_msg_id);
    }
    for (const i of u.items || []) {
      if (i.action === 'close' && i.id) {
        db.prepare("UPDATE items SET status = 'done', resolution = ?, resolved_ts = ? WHERE id = ?").run(i.resolution || null, ts(i.source_msg_id), i.id);
      } else if (i.action === 'open' && i.title) {
        db.prepare('INSERT INTO items (kind, title, details, owner, due, ts, source_msg) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(i.kind || 'task', i.title, i.details || null, i.owner || 'me', i.due || null, ts(i.source_msg_id), i.source_msg_id);
      }
    }
    for (const c of u.changes || []) db.prepare('INSERT INTO changes (ts, summary, source_msg) VALUES (?, ?, ?)').run(ts(c.source_msg_id), c.summary, c.source_msg_id);
    const mark = db.prepare('UPDATE messages SET processed = 1 WHERE id = ?');
    for (const m of batch) mark.run(m.id);
  })();
}

export const state = { running: false, lastRun: null, lastError: null, pending: 0 };

async function processBatch(group) {
  const batch = db.prepare('SELECT * FROM messages WHERE chat_jid = ? AND processed = 0 ORDER BY ts LIMIT ?').all(group.jid, config.batchSize);
  if (!batch.length) return false;
  const context = db.prepare('SELECT * FROM messages WHERE chat_jid = ? AND processed = 1 AND ts <= ? ORDER BY ts DESC LIMIT 15')
    .all(group.jid, batch[0].ts).reverse();

  const res = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: buildContent(batch, context) }],
  });
  const call = res.content.find((b) => b.type === 'tool_use');
  applyUpdate(call?.input || {}, batch);
  return true;
}

export async function runExtraction() {
  const group = getSetting('group');
  if (!group || state.running) return;
  if (!client) { state.lastError = 'ANTHROPIC_API_KEY is not set'; return; }
  state.running = true;
  try {
    // History older than the backfill window is kept for search but not sent to the LLM.
    const cutoff = getSetting('backfill_cutoff', 0);
    db.prepare('UPDATE messages SET processed = 1 WHERE processed = 0 AND ts < ?').run(cutoff);
    while (await processBatch(group)) state.lastError = null;
    state.lastRun = Date.now();
  } catch (e) {
    state.lastError = e.message;
    console.error('extraction failed:', e.message);
    scheduleExtraction(5 * 60 * 1000);   // retry later; messages stay pending
  } finally {
    state.running = false;
    state.pending = db.prepare('SELECT COUNT(*) n FROM messages WHERE processed = 0').get().n;
  }
}

let timer = null;
export function scheduleExtraction(delay = config.debounceMs) {
  clearTimeout(timer);
  timer = setTimeout(runExtraction, delay);
}
