import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers, DisconnectReason, useMultiFileAuthState, downloadMediaMessage,
  normalizeMessageContent, getContentType, isJidGroup,
} from 'baileys';
import { config } from './config.js';
import { saveMessage, getSetting, setSetting } from './db.js';

const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' });
const authDir = path.join(config.dataDir, 'auth');

export const wa = {
  sock: null,
  status: 'starting',   // starting | qr | open | closed
  qr: null,             // data URL of the current login QR
  me: null,
  onNewMessages: () => {},
};

// History-sync messages arrive once, right after linking, often before a group is chosen.
// Keep them in memory (groups only) so the chosen group can be backfilled.
const historyBuffer = new Map();   // chat_jid -> WAMessage[]
const HISTORY_CAP = 20000;
let historyCount = 0;

export const trackedGroup = () => getSetting('group');   // { jid, name }

function extractText(msg) {
  const content = normalizeMessageContent(msg.message);
  if (!content) return null;
  const type = getContentType(content);
  const body = content[type];
  if (!type || ['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'messageContextInfo'].includes(type)) return null;

  const out = { type, text: '', media_kind: null, mime: null, reply_to: body?.contextInfo?.stanzaId || null };
  switch (type) {
    case 'conversation': out.text = content.conversation; break;
    case 'extendedTextMessage': out.text = body.text; break;
    case 'imageMessage': out.text = body.caption || ''; out.media_kind = 'image'; out.mime = body.mimetype; break;
    case 'videoMessage': out.text = body.caption || ''; out.media_kind = 'video'; break;
    case 'audioMessage': out.text = '[voice note]'; out.media_kind = 'audio'; break;
    case 'stickerMessage': return null;
    case 'documentMessage':
    case 'documentWithCaptionMessage': {
      const doc = body.message?.documentMessage || body;
      out.text = [doc.fileName, doc.caption].filter(Boolean).join(' — ');
      out.mime = doc.mimetype;
      out.media_kind = doc.mimetype === 'application/pdf' ? 'pdf' : doc.mimetype?.startsWith('image/') ? 'image' : 'file';
      break;
    }
    case 'pollCreationMessage':
    case 'pollCreationMessageV3':
      out.text = `[poll] ${body.name}: ${(body.options || []).map((o) => o.optionName).join(' / ')}`; break;
    default:
      out.text = body?.text || body?.caption || `[${type}]`;
  }
  return out;
}

async function storeMessage(msg) {
  const chat = msg.key.remoteJid;
  const parsed = extractText(msg);
  if (!parsed || (!parsed.text && !parsed.media_kind)) return false;

  const row = {
    id: msg.key.id,
    chat_jid: chat,
    sender: msg.key.fromMe ? 'me' : (msg.key.participant || msg.participant || chat),
    sender_name: msg.key.fromMe ? 'Me' : (msg.pushName || null),
    from_me: msg.key.fromMe ? 1 : 0,
    ts: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
    text: parsed.text,
    media_kind: parsed.media_kind,
    mime: parsed.mime,
    reply_to: parsed.reply_to,
  };

  // Download images and PDFs (diet charts, lab reports, label photos) so the LLM can read them.
  if (['image', 'pdf'].includes(parsed.media_kind)) {
    try {
      const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: wa.sock?.updateMediaMessage });
      const ext = parsed.media_kind === 'pdf' ? 'pdf' : (parsed.mime?.split('/')[1] || 'jpg').split(';')[0];
      const file = `${row.id}.${ext}`;
      fs.writeFileSync(path.join(config.dataDir, 'media', file), buf);
      row.media_path = file;
    } catch (e) {
      logger.warn({ err: e.message, id: row.id }, 'media download failed');
    }
  }
  return saveMessage(row);
}

/** Called when the user picks the group in the setup screen. */
export async function selectGroup(jid, name) {
  setSetting('group', { jid, name });
  setSetting('backfill_cutoff', Math.floor(Date.now() / 1000) - config.backfillDays * 86400);
  const buffered = historyBuffer.get(jid) || [];
  for (const m of buffered) await storeMessage(m);
  historyBuffer.clear();
  historyCount = 0;
  wa.onNewMessages();
  return buffered.length;
}

export async function listGroups() {
  if (!wa.sock || wa.status !== 'open') return [];
  const groups = await wa.sock.groupFetchAllParticipating();
  return Object.values(groups)
    .map((g) => ({ jid: g.id, name: g.subject, size: g.participants?.length || 0, buffered: historyBuffer.get(g.id)?.length || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function maybeAutoSelect() {
  if (trackedGroup() || !config.groupName) return;
  const match = (await listGroups()).find((g) => g.name.toLowerCase().includes(config.groupName.toLowerCase()));
  if (match) {
    const n = await selectGroup(match.jid, match.name);
    logger.warn(`auto-selected group "${match.name}" (${n} history messages)`);
  }
}

export async function unlink() {
  try { await wa.sock?.logout(); } catch {}
  fs.rmSync(authDir, { recursive: true, force: true });
  fs.mkdirSync(authDir, { recursive: true });
  setTimeout(startWhatsApp, 1000);
}

export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.macOS('Chrome'),    // WhatsApp rejects the 'Desktop' identity at pairing (close 428, no QR)
    syncFullHistory: true,
    markOnlineOnConnect: false,           // don't show him as "online" or send read receipts
    getMessage: async () => undefined,
  });
  wa.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { wa.status = 'qr'; wa.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 }); }
    if (connection === 'open') {
      wa.status = 'open'; wa.qr = null; wa.me = sock.user;
      console.log(`WhatsApp connected as ${sock.user?.name || sock.user?.id}`);
      setTimeout(() => maybeAutoSelect().catch(() => {}), 5000);
    }
    if (connection === 'close') {
      wa.status = 'closed';
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('WhatsApp session logged out — clearing credentials, a new QR will be shown.');
        fs.rmSync(authDir, { recursive: true, force: true });
        fs.mkdirSync(authDir, { recursive: true });
      } else {
        console.log(`WhatsApp connection closed (${code}), reconnecting…`);
      }
      setTimeout(startWhatsApp, code === DisconnectReason.loggedOut ? 1000 : 3000);
    }
  });

  sock.ev.on('messaging-history.set', async ({ messages }) => {
    const group = trackedGroup();
    let stored = 0;
    for (const m of messages) {
      const jid = m.key?.remoteJid;
      if (!jid || !isJidGroup(jid)) continue;
      if (group) {
        if (jid === group.jid && await storeMessage(m)) stored++;
      } else if (historyCount < HISTORY_CAP) {
        if (!historyBuffer.has(jid)) historyBuffer.set(jid, []);
        historyBuffer.get(jid).push(m); historyCount++;
      }
    }
    if (stored) wa.onNewMessages();
    if (!group) maybeAutoSelect().catch(() => {});
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const group = trackedGroup();
    if (!group) return;
    let stored = 0;
    for (const m of messages) if (m.key?.remoteJid === group.jid && await storeMessage(m)) stored++;
    if (stored) wa.onNewMessages();
  });
}
