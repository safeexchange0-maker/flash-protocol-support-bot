// src/helpers.js
const DB = require('./db');
const CONFIG = require('../config.json');

// Keys hardcoded from config.json (or could be moved to config.json)
const PURCHASE_KEYS = [
  "FP12-L1-15K-W01","FP12-L2-100K-W03","FP12-L3-250K-W05","FP12-L4-400K-W06",
  "FP12-L5-500K-W09","FP12-TEST-100-W15","FP12-R-200K-W17","FP12-INS-750K-W21",
  "FP12-L6-900K-W22","FP12-L7-1.2M-W23","FP12-DEV-5K-W24","FP12-REC-350K-W25",
  "FP12-SUB-M1-W11","FP12-SUB-M2-W12","FP12-SUB-Q1-W13","FP12-SUB-Y1-W14",
  "FP12-L4-1M-W07","FP12-FD-2M-W26","FP12-FD-5M-W19","FP12-FD-10M-W20"
];

const Helpers = {
    genTicketId: () => {
        const n = (DB.getTickets().length + 1).toString().padStart(5, '0');
        return `FP-SUP-${n}`;
    },
    looksLikeTRC20: (addr) => {
        if (!addr || typeof addr !== 'string') return false;
        addr = addr.trim();
        return addr.startsWith('T') && addr.length >= 25 && addr.length <= 50;
    },
    isKnownKey: (code) => {
        if(!code || typeof code !== 'string') return false;
        return PURCHASE_KEYS.includes(code.trim().toUpperCase());
    },
    determinePriority: (text) => {
        if (/(عاجل|فوري|ضروري|مشكلة في المال|فشل التحويل)/i.test(text)) return 'عالية 🚨';
        if (/(استفسار|سؤال|معلومة|FAQ)/i.test(text)) return 'منخفضة ⬇️';
        return 'متوسطة 🟡';
    },
    getUserInfo: (ctx) => {
        const from = ctx.from;
        return {
            id: from.id,
            username: from.username ? `@${from.username}` : '',
            full_name: `${from.first_name || ''} ${from.last_name || ''}`.trim()
        };
    },
    isAdmin: (id) => {
        return CONFIG.ADMIN_CHAT_ID && Number(id) === Number(CONFIG.ADMIN_CHAT_ID);
    }
};

module.exports = Helpers;