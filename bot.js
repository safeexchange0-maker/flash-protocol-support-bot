// Telegram Support Bot (Formal technical tone)
// Requirements: node >=16, npm
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

// --- Configuration Loading ---
const cfgPath = path.resolve(__dirname, 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('Missing config.json. Please ensure it exists and is configured.');
  process.exit(1);
}
const CONFIG = JSON.parse(fs.readFileSync(cfgPath));
if (!CONFIG.BOT_TOKEN || CONFIG.BOT_TOKEN === 'YOUR_BOT_TOKEN') {
  console.error('Please set BOT_TOKEN in config.json');
  process.exit(1);
}

const BOT = new Telegraf(CONFIG.BOT_TOKEN);
const ADMIN_CHAT_ID = Number(CONFIG.ADMIN_CHAT_ID);

// --- 🛠️ Global Admin State ---
// يستخدم لتخزين التذكرة التي ينتظر البوت رداً عليها من الأدمن
// { adminId: ticketId_to_reply_to }
let ADMIN_STATE = {};

// --- Simple File-based DB Setup ---
const DB_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);
const TICKETS_FILE = path.join(DB_DIR, 'tickets.json');
const LOG_FILE = path.join(DB_DIR, 'bot_log.json');

function loadJSON(p, defaultValue) {
  try {
    if (!fs.existsSync(p)) return defaultValue;
    return JSON.parse(fs.readFileSync(p, 'utf8') || 'null') || defaultValue;
  } catch (e) {
    console.warn('loadJSON error', e);
    return defaultValue;
  }
}
function saveJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

let TICKETS = loadJSON(TICKETS_FILE, []);
let LOGS = loadJSON(LOG_FILE, []);

// --- Data & Helpers ---
const PURCHASE_KEYS = [
  "FP12-L1-15K-W01","FP12-L2-100K-W03","FP12-L3-250K-W05","FP12-L4-400K-W06",
  "FP12-L5-500K-W09","FP12-TEST-100-W15","FP12-R-200K-W17","FP12-INS-750K-W21",
  "FP12-L6-900K-W22","FP12-L7-1.2M-W23","FP12-DEV-5K-W24","FP12-REC-350K-W25",
  "FP12-SUB-M1-W11","FP12-SUB-M2-W12","FP12-SUB-Q1-W13","FP12-L3-26345K-W05",
  "FP12-L4-1M-W07","FP12-L2-164523K-W03","FP12-FD-5M-W19","FP12-L1-10035K-W01"
];

function botLog(entry) {
  try {
    LOGS.unshift({ time: new Date().toISOString(), entry });
    if (LOGS.length > 1000) LOGS.pop();
    saveJSON(LOG_FILE, LOGS);
  } catch (e) {}
}

function genTicketId() {
  const n = (TICKETS.length + 1).toString().padStart(5, '0');
  return `FP-SUP-${n}`;
}

function looksLikeTRC20(addr) {
  if (!addr || typeof addr !== 'string') return false;
  addr = addr.trim();
  return addr.startsWith('T') && addr.length >= 25 && addr.length <= 50;
}

function isKnownKey(code) {
  if(!code || typeof code !== 'string') return false;
  return PURCHASE_KEYS.includes(code.trim().toUpperCase());
}

function determinePriority(text) {
    if (/(عاجل|فوري|ضروري|مشكلة في المال|فشل التحويل)/i.test(text)) return 'عالية 🚨';
    if (/(استفسار|سؤال|معلومة|FAQ)/i.test(text)) return 'منخفضة ⬇️';
    return 'متوسطة 🟡';
}

function getUserInfo(ctx) {
    const from = ctx.from;
    return {
        id: from.id,
        username: from.username ? `@${from.username}` : '',
        full_name: `${from.first_name || ''} ${from.last_name || ''}`.trim()
    };
}

function isAdmin(id) {
    return ADMIN_CHAT_ID && Number(id) === ADMIN_CHAT_ID;
}

// --- 💡 Reply Logic: Centralized function for replying to a ticket ---
async function sendAdminReply(ctx, ticketId, replyText) {
    const tIdx = TICKETS.findIndex(x=>x.id===ticketId);
    if(tIdx === -1) return ctx.reply('التذكرة غير موجودة.');
    
    const ticket = TICKETS[tIdx];
    try {
        // 1. Send reply to user (Client)
        const replyMsg = `🔔 تحديث تذكرتك *${ticket.id}* (تم الرد):\n\n${replyText}`;
        await BOT.telegram.sendMessage(ticket.user_id, replyMsg, { 
            parse_mode: 'Markdown',
            ...TEXTS.CLIENT_CONFIRM_KB(ticket.id) // Send confirmation buttons
        });
        
        // 2. Update ticket status and notes (DB)
        TICKETS[tIdx].status = 'awaiting client confirmation';
        TICKETS[tIdx].admin_notes.push({ time: new Date().toISOString(), admin_id: ctx.from.id, reply: replyText });
        saveJSON(TICKETS_FILE, TICKETS);
        
        // 3. Send confirmation to Admin
        await ctx.reply(`✅ تم إرسال الرد بنجاح للعميل (التذكرة: ${ticketId}). تم تحويل الحالة إلى انتظار تأكيد العميل.`);
        return true;
    } catch (e) {
        console.error('Reply send error:', e);
        await ctx.reply('❌ فشل في إرسال الرد للعميل. ربما قام بحظر البوت.');
        return false;
    }
}


// --- UI Texts & Keyboards ---
const TEXTS = {
  START: `📡 Flash Protocol Support Hub\n\nأهلاً بك.\nتستطيع إرسال:\n• كود المفتاح (Key)\n• أو عنوان المحفظة (TRC20)\n• أو وصف للمشكلة الآن.\n\nاختر:`,

  OPTIONS_KB: Markup.keyboard([
    ['🔑 إرسال كود مفتاح', '🏦 إرسال محفظة TRC20'],
    ['📝 بلّغ عن مشكلة', '📕 الأسئلة الشائعة']
  ]).resize(),

  ACK_RECEIVED: (ticketId, priority) => `✅ تم استلام طلبك. رقم التذكرة: *${ticketId}*\nالأولوية: *${priority}*\n\nحالة التذكرة: _قيد المراجعة_.\nيمكنك متابعة حالتها عبر الأمر: \`/status ${ticketId}\``,

  KEY_VALID: (key) => `🔒 فحص المفتاح: *${key}*\n\n✅ النتيجة: المفتاح معروف وصالح حسب قاعدة البيانات المحلية.`,
  WALLET_VALID: (addr) => `🔗 فحص المحفظة: \`${addr}\`\n\n✅ النتيجة: عنوان TRC20 يبدو صحيحاً وصالحاً لربط العرض المبدئي.`,
  HELP: `⚙️ أوامر مفيدة:\n/start - بداية المحادثة\n/help - تعليمات\n/status <TICKET_ID> - عرض حالة تذكرتك\n`,
  SUPPORT_PROMPT: `📝 من فضلك اكتب وصف المشكلة هنا. اذكر أكبر قدر ممكن من التفاصيل (المفتاح إن وجد، محفظة، TXID، صور...).`,
  
  ADMIN_NOTICE: (ticket) => `🔔 تذكرة جديدة: *${ticket.id}* (الأولوية: ${ticket.priority})\nمن: ${ticket.user_name} (${ticket.user_id}) ${ticket.user_username}\nنوع: ${ticket.type}\nمحتوى:\n${ticket.content}`,
  
  ADMIN_KB: (ticketId) => Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ إغلاق التذكرة', `ticket_close:${ticketId}`),
      Markup.button.callback('↩️ الرد على التذكرة', `ticket_reply:${ticketId}`) 
    ],
    [
      Markup.button.callback('⚙️ عرض التفاصيل', `ticket_view:${ticketId}`),
      Markup.button.callback('🗑️ حذف التذكرة (للتجريب)', `ticket_delete:${ticketId}`)
    ]
  ]),
  
  CLIENT_CONFIRM_KB: (ticketId) => Markup.inlineKeyboard([
      Markup.button.callback('✅ نعم، تم حلها', `confirm_close_yes:${ticketId}`),
      Markup.button.callback('❌ لا، المشكلة مستمرة', `confirm_close_no:${ticketId}`)
  ])
};

// --- Ticket Creation Helper ---
async function createTicket(ctx, type, content, media = null) {
    const userInfo = getUserInfo(ctx);
    const priority = determinePriority(content);
    const ticket = {
        id: genTicketId(),
        time: new Date().toISOString(),
        user_id: userInfo.id,
        user_name: userInfo.full_name,
        user_username: userInfo.username,
        type: type,
        content: content,
        priority: priority,
        media: media,
        status: 'open',
        admin_notes: []
    };
    TICKETS.unshift(ticket); 
    saveJSON(TICKETS_FILE, TICKETS);
    
    // Notify admin
    if (ADMIN_CHAT_ID) {
        let adminMsg = TEXTS.ADMIN_NOTICE(ticket);
        
        if (media) {
            adminMsg += `\n\n_مرفق ملف/صورة: ${media.file_type} (${media.file_name || media.file_id})_`;
            
            // Send media to admin
            try {
                if (media.file_type === 'photo') {
                    await BOT.telegram.sendPhoto(ADMIN_CHAT_ID, media.file_id, { 
                        caption: adminMsg, 
                        parse_mode: 'Markdown',
                        ...TEXTS.ADMIN_KB(ticket.id)
                    });
                } else {
                    await BOT.telegram.sendDocument(ADMIN_CHAT_ID, media.file_id, { 
                        caption: adminMsg, 
                        parse_mode: 'Markdown',
                        ...TEXTS.ADMIN_KB(ticket.id)
                    });
                }
            } catch(e) { console.error('Admin media send error:', e); }
            
        } else {
             // Send text ticket to admin
            try { 
                await BOT.telegram.sendMessage(ADMIN_CHAT_ID, adminMsg, { 
                    parse_mode: 'Markdown', 
                    ...TEXTS.ADMIN_KB(ticket.id) 
                }); 
            } catch(e) { console.error('Admin text send error:', e); }
        }
    }
    
    await ctx.replyWithMarkdown(TEXTS.ACK_RECEIVED(ticket.id, priority));
    botLog(`Ticket ${ticket.id} created by ${userInfo.id}. Type: ${type}`);
    return ticket;
}


// --- Handlers ---

BOT.start(async (ctx) => {
  await ctx.reply(TEXTS.START, TEXTS.OPTIONS_KB);
  botLog(`Start from ${ctx.from.id}`);
});

BOT.help((ctx) => ctx.reply(TEXTS.HELP));


// --- 1. Generic Text Handler (Ticket Creation / Quick Checks / ADMIN REPLY) ---
BOT.on('text', async (ctx) => {
    try {
        const text = (ctx.message.text || '').trim();
        const adminId = ctx.from.id;

        // [ FIX: 1 - ADMIN REPLY STATE ] 
        if (isAdmin(adminId) && ADMIN_STATE[adminId]) {
            const ticketId = ADMIN_STATE[adminId];
            delete ADMIN_STATE[adminId]; 
            
            await sendAdminReply(ctx, ticketId, text);
            return;
        }

        // [ FIX: 2 - ADMIN GUARDRAIL ] 
        if (isAdmin(adminId)) {
             if (text.startsWith('/')) return;
             return; 
        }


        // --- Client Logic Starts Here ---

        // Check for quick keyboard commands
        if (text === '🔑 إرسال كود مفتاح') return ctx.reply('أرسل كود المفتاح هنا (مثال: FP12-L3-250K-W05)');
        if (text === '🏦 إرسال محفظة TRC20') return ctx.reply('أرسل عنوان المحفظة (TRC20) هنا (يبدأ بـ T)');
        if (text === '📝 بلّغ عن مشكلة') return ctx.reply(TEXTS.SUPPORT_PROMPT);
        
        // FAQ
        if (text === '📕 الأسئلة الشائعة') {
             if(CONFIG.FAQ_DATA && CONFIG.FAQ_DATA.main && CONFIG.FAQ_DATA.main.buttons) {
                 return ctx.reply(CONFIG.FAQ_DATA.main.text, Markup.inlineKeyboard(CONFIG.FAQ_DATA.main.buttons.map(b => [b])));
             }
             return ctx.reply('عذراً، بيانات الأسئلة الشائعة غير متاحة حالياً.');
        }
        
        // --- Key/Wallet Automatic Check and Ticket ---
        const maybeKey = text.toUpperCase();
        
        // 1. Check for known key (FIXED: Calls createTicket)
        if (isKnownKey(maybeKey)) {
            await ctx.replyWithMarkdown(TEXTS.KEY_VALID(maybeKey));
            return createTicket(ctx, 'key-check', `Key check: ${maybeKey}`);
        }
        
        // 2. Check for TRC20 Wallet (FIXED: Calls createTicket)
        if (looksLikeTRC20(text) && !maybeKey.includes('TXID')) {
            await ctx.replyWithMarkdown(TEXTS.WALLET_VALID(text));
            return createTicket(ctx, 'wallet-check', `Wallet check: ${text}`);
        }

        // 3. Otherwise treat as generic support message -> create ticket (This also works for TXID, etc.)
        return createTicket(ctx, 'support', text);

    } catch (e) {
        console.error('on text error', e);
    }
});

// --- 2. Media Handlers (Photos and Documents) ---
BOT.on(['photo', 'document'], async (ctx) => {
    try {
        // [GUARDRAIL] Ignore Admin's media messages to prevent new tickets
        if (isAdmin(ctx.from.id)) return;
        
        const type = ctx.message.photo ? 'photo' : 'document';
        const fileId = type === 'photo' ? ctx.message.photo.slice(-1)[0].file_id : ctx.message.document.file_id;
        const fileName = type === 'document' ? ctx.message.document.file_name : 'photo';
        const caption = ctx.message.caption || 'لا يوجد وصف مرفق';

        const mediaInfo = {
            file_id: fileId,
            file_type: type,
            file_name: fileName,
            caption: caption
        };

        // Media always creates a ticket
        return createTicket(ctx, `support-media-${type}`, caption, mediaInfo);
        
    } catch (e) {
        console.error('on media error', e);
        ctx.reply('عفواً، حدث خطأ أثناء معالجة الملف المرفق. يرجى محاولة إرسال الرسالة النصية أولاً.');
    }
});


// --- 3. Callback Query Handler (For Inline Keyboards: FAQ, Admin Actions, Client Confirmation) ---
BOT.on('callback_query', async (ctx) => {
    try {
        const data = ctx.callbackQuery.data;
        const parts = data.split(':');
        const action = parts[0];
        const ticketId = parts[1];
        
        await ctx.answerCbQuery(); 

        // --- FAQ Navigation ---
        if (action.startsWith('faq_')) {
            const faqKey = action;
            const faqData = CONFIG.FAQ_DATA[faqKey];
            if (faqData) {
                const buttons = faqData.buttons ? faqData.buttons.map(b => [b]) : [];
                await ctx.editMessageText(faqData.text, Markup.inlineKeyboard(buttons));
            }
            return;
        }

        // --- Admin Actions ---
        if (isAdmin(ctx.from.id)) {
            const ticketIndex = TICKETS.findIndex(t => t.id === ticketId);
            if (ticketIndex === -1) return ctx.reply('عفواً، التذكرة غير موجودة/محذوفة.');
            const ticket = TICKETS[ticketIndex];

            if (action === 'ticket_view') {
                let msg = `*${ticket.id}* | ${ticket.type} | الأولوية: ${ticket.priority}\n`;
                msg += `من: ${ticket.user_name} (${ticket.user_id}) ${ticket.user_username}\n`;
                msg += `الحالة: *${ticket.status.toUpperCase()}*\n\n`;
                msg += `المحتوى:\n${ticket.content}`;
                if (ticket.media) msg += `\n\n_مرفق: ${ticket.media.file_type}_`;
                
                await ctx.replyWithMarkdown(msg);
                return;
            }
            
            // REPLY STATE TRIGGER
            if (action === 'ticket_reply') {
                ADMIN_STATE[ctx.from.id] = ticketId; 
                return ctx.reply(`↩️ *وضع الرد على التذكرة ${ticketId}*:\nمن فضلك أرسل نص ردك الآن مباشرة.`, { parse_mode: 'Markdown' });
            }
            
            if (action === 'ticket_close') {
                TICKETS[ticketIndex].status = 'closed (Admin)';
                saveJSON(TICKETS_FILE, TICKETS);
                await ctx.editMessageText(`✅ تم إغلاق التذكرة *${ticketId}* إدارياً.`, { parse_mode: 'Markdown' });
                return;
            }
            
            if (action === 'ticket_delete') {
                TICKETS.splice(ticketIndex, 1);
                saveJSON(TICKETS_FILE, TICKETS);
                await ctx.editMessageText(`🗑️ تم حذف التذكرة *${ticketId}* للتجريب.`, { parse_mode: 'Markdown' });
                return;
            }
        }
        
        // --- Client Confirmation Actions ---
        if (action.startsWith('confirm_close_')) {
            const ticketIndex = TICKETS.findIndex(t => t.id === ticketId);
            if (ticketIndex === -1) return ctx.reply('عفواً، التذكرة غير موجودة/محذوفة.');

            if (action === 'confirm_close_yes') {
                TICKETS[ticketIndex].status = 'closed (Client Confirmed)';
                saveJSON(TICKETS_FILE, TICKETS);
                await ctx.editMessageText(`✅ شكراً لك! تم إغلاق تذكرتك *${ticketId}* بنجاح.`, { parse_mode: 'Markdown' });
                return;
            }
            
            if (action === 'confirm_close_no') {
                TICKETS[ticketIndex].status = 'open (Reopened by Client)';
                saveJSON(TICKETS_FILE, TICKETS);
                await ctx.editMessageText(`⚠️ تم إعادة فتح التذكرة *${ticketId}*. سيتم تحويل طلبك لمدير الدعم للمتابعة.`, { parse_mode: 'Markdown' });
                try { 
                    await BOT.telegram.sendMessage(ADMIN_CHAT_ID, `⚠️ التذكرة *${ticketId}* أعيد فتحها بواسطة العميل.`, { parse_mode: 'Markdown', ...TEXTS.ADMIN_KB(ticketId) }); 
                } catch(e){}
                return;
            }
        }
        
    } catch (e) {
        console.error('on callback query error', e);
    }
});

// --- 4. Admin/Client Command Handlers ---

// /tickets - admin only: list open tickets
BOT.command('tickets', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied.');
    const open = TICKETS.filter(t => t.status.includes('open') || t.status.includes('review') || t.status.includes('awaiting')).slice(0, 20);
    if (open.length === 0) return ctx.reply('لا توجد تذاكر مفتوحة حالياً.');
    
    let msg = '*التذاكر المفتوحة (آخر 20):*\n';
    open.forEach(t=> msg += `\n${t.id} (${t.priority}) | ${t.type} | ${t.user_name} | ${t.time.substring(5,16)}\n`);
    await ctx.replyWithMarkdown(msg);
});

// /status - client command: view status
BOT.command('status', async (ctx) => {
    const parts = ctx.message.text.split(' ').filter(Boolean);
    if (parts.length < 2) return ctx.reply('الاستخدام: /status <TICKET_ID>');
    const id = parts[1].trim().toUpperCase();

    const t = TICKETS.find(x => x.id === id && Number(x.user_id) === Number(ctx.from.id));
    if (!t) return ctx.reply('عذراً، لم يتم العثور على تذكرة بهذا الرقم أو أنها ليست تذكرتك.');

    let msg = `*حالة التذكرة: ${t.id}*\n`;
    msg += `الأولوية: ${t.priority}\n`;
    msg += `الحالة: *${t.status.toUpperCase()}*\n`;
    msg += `تم إنشاؤها في: ${t.time.substring(0, 10)}\n`;
    msg += `المحتوى: _${t.content.substring(0, 100)}..._\n\n`;

    if (t.status === 'closed' && t.admin_notes && t.admin_notes.length > 0) {
        msg += `آخر رد من الإدارة:\n_${t.admin_notes[t.admin_notes.length - 1].reply.substring(0, 150)}..._`;
    } else if (t.status.includes('open') || t.status.includes('review') || t.status.includes('awaiting')) {
        msg += 'التذكرة قيد المراجعة، سيتم الرد عليك قريباً.';
    }

    await ctx.replyWithMarkdown(msg);
});


// /reply <id> <text> admin: Reply via command (fallback/power user option)
BOT.command('reply', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied. Admin only command.');
    
    const parts = ctx.message.text.split(' ').filter(Boolean);
    if (parts.length < 3) return ctx.reply('الاستخدام: /reply <TICKET_ID> <رسالة الرد>');
    
    const id = parts[1].trim().toUpperCase();
    const replyText = parts.slice(2).join(' ');
    
    await sendAdminReply(ctx, id, replyText);
});


// /qr <id> <qr_key> - Admin quick reply command
BOT.command('qr', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied. Admin only command.');
    
    const parts = ctx.message.text.split(' ').filter(Boolean);
    if (parts.length < 3) return ctx.reply('الاستخدام: /qr <TICKET_ID> <QR_KEY>.\nالمفاتيح المتاحة: ' + Object.keys(CONFIG.QUICK_REPLIES).join(', '));
    
    const id = parts[1].trim().toUpperCase();
    const qrKey = parts[2].trim().toLowerCase();
    
    if (!CONFIG.QUICK_REPLIES[qrKey]) return ctx.reply(`مفتاح الرد السريع (*${qrKey}*) غير موجود في الإعدادات.`);
    
    const replyText = CONFIG.QUICK_REPLIES[qrKey];
    
    await sendAdminReply(ctx, id, replyText);
});

// --- Start Bot ---
BOT.launch().then(()=>{
  console.log('Flash Protocol Support Bot started (Node.js/Telegraf)');
  botLog('Bot launched successfully');
}).catch(e => {
    console.error('FATAL ERROR during bot launch:', e);
});

// graceful stop
process.once('SIGINT', () => BOT.stop('SIGINT'));
process.once('SIGTERM', () => BOT.stop('SIGTERM'));

