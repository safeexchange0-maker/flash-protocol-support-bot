// src/db.js
const fs = require('fs');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const TICKETS_FILE = path.join(DB_DIR, 'tickets.json');
const LOG_FILE = path.join(DB_DIR, 'bot_log.json');

function loadJSON(p, defaultValue) {
  try {
    if (!fs.existsSync(p)) return defaultValue;
    const content = fs.readFileSync(p, 'utf8') || 'null';
    return JSON.parse(content) || defaultValue;
  } catch (e) {
    console.warn(`[DB] loadJSON error for ${path.basename(p)}:`, e.message);
    return defaultValue;
  }
}

function saveJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

let TICKETS = loadJSON(TICKETS_FILE, []);
let LOGS = loadJSON(LOG_FILE, []);

const DB = {
    getTickets: () => TICKETS,
    getTicket: (id) => TICKETS.find(t => t.id === id),
    addTicket: (ticket) => {
        TICKETS.unshift(ticket);
        saveJSON(TICKETS_FILE, TICKETS);
    },
    updateTicket: (ticket) => {
        const index = TICKETS.findIndex(t => t.id === ticket.id);
        if (index !== -1) {
            TICKETS[index] = ticket;
            saveJSON(TICKETS_FILE, TICKETS);
        }
    },
    botLog: (entry) => {
        try {
            LOGS.unshift({ time: new Date().toISOString(), entry });
            if (LOGS.length > 1000) LOGS.pop();
            saveJSON(LOG_FILE, LOGS);
        } catch (e) {
            console.error('[DB] botLog error:', e.message);
        }
    }
};

module.exports = DB;
