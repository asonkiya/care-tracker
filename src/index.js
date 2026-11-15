import { startServer } from './server.js';
import { wa, startWhatsApp } from './whatsapp.js';
import { scheduleExtraction } from './extract.js';

wa.onNewMessages = () => scheduleExtraction();
startServer();
if (process.env.NO_WHATSAPP !== '1') startWhatsApp().catch((e) => console.error('WhatsApp failed to start:', e));
scheduleExtraction(10_000);   // pick up anything left pending from before a restart
