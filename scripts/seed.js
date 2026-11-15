// Fills the database with a fake care group so the dashboard can be tried without WhatsApp or an API key.
// Usage: DATA_DIR=./demo-data node scripts/seed.js
import { db, saveMessage, setSetting, resetExtraction } from '../src/db.js';
import { applyUpdate } from '../src/extract.js';

const jid = 'demo@g.us';
setSetting('group', { jid, name: 'Demo – Care Team' });
setSetting('backfill_cutoff', 0);
db.exec('DELETE FROM messages'); resetExtraction();

const now = Math.floor(Date.now() / 1000), H = 3600, D = 86400;
const msgs = [
  ['m1', 'Dr. Mehta', 0, now - 3 * D, 'Starting you on Vitamin D3 60,000 IU once a week (Sundays, after lunch) and Magnesium glycinate 400mg daily.'],
  ['m2', 'Riya (Nutritionist)', 0, now - 3 * D + H, 'Diet for this week: no added sugar, 2.5L water daily, protein in every meal. Please send meal photos every day.'],
  ['m3', 'Me', 1, now - 2 * D, 'Breakfast: 3 egg omelette + toast. Took magnesium. Weight 78.2 kg'],
  ['m4', 'Me', 1, now - 2 * D + H, 'Should I take magnesium with food or empty stomach?'],
  ['m5', 'Dr. Mehta', 0, now - D, 'Take magnesium at bedtime instead, helps with sleep. Also please book a fasting lipid profile + HbA1c this week.'],
  ['m6', 'Me', 1, now - 3 * H, 'Slept 7h. Lunch: dal, rice, salad. Walked 30 min'],
];
for (const [id, name, me, ts, text] of msgs) saveMessage({ id, chat_jid: jid, sender: me ? 'me' : name, sender_name: name, from_me: me, ts, text });
const batch = db.prepare('SELECT * FROM messages ORDER BY ts').all();

// What the LLM would return for those messages:
applyUpdate({
  supplements: [
    { action: 'add', name: 'Vitamin D3', dose: '60,000 IU', timing: 'weekly, Sunday after lunch', source_msg_id: 'm1' },
    { action: 'add', name: 'Magnesium glycinate', dose: '400 mg', timing: 'daily', source_msg_id: 'm1' },
    { action: 'update', name: 'Magnesium glycinate', timing: 'bedtime', notes: 'helps with sleep', source_msg_id: 'm5' },
  ],
  rules: [
    { action: 'add', category: 'diet', text: 'No added sugar', source_msg_id: 'm2' },
    { action: 'add', category: 'hydration', text: '2.5 L water daily', source_msg_id: 'm2' },
    { action: 'add', category: 'diet', text: 'Protein in every meal', source_msg_id: 'm2' },
  ],
  logs: [
    { date: null, category: 'meal', summary: 'Breakfast: 3-egg omelette + toast', source_msg_id: 'm3' },
    { date: null, category: 'supplement', summary: 'Took magnesium', source_msg_id: 'm3' },
    { date: null, category: 'weight', summary: 'Morning weight', value: '78.2 kg', source_msg_id: 'm3' },
    { date: null, category: 'sleep', summary: 'Slept 7 hours', value: '7 h', source_msg_id: 'm6' },
    { date: null, category: 'meal', summary: 'Lunch: dal, rice, salad', source_msg_id: 'm6' },
    { date: null, category: 'exercise', summary: 'Walk', value: '30 min', source_msg_id: 'm6' },
  ],
  items: [
    { action: 'open', kind: 'task', title: 'Send meal photos daily', owner: 'me', source_msg_id: 'm2' },
    { action: 'open', kind: 'question', title: 'Magnesium with food or empty stomach?', owner: 'team', source_msg_id: 'm4' },
    { action: 'close', id: 2, resolution: 'Take it at bedtime', source_msg_id: 'm5' },
    { action: 'open', kind: 'test', title: 'Book fasting lipid profile + HbA1c', details: 'This week', owner: 'me', source_msg_id: 'm5' },
  ],
  changes: [
    { summary: 'Started Vitamin D3 60,000 IU weekly and Magnesium 400 mg daily', source_msg_id: 'm1' },
    { summary: 'Magnesium moved to bedtime', source_msg_id: 'm5' },
  ],
}, batch);
console.log('Seeded demo data.');
