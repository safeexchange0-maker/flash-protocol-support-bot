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
// ADMIN_CHAT_ID changed to ADMIN_CHAT_IDS array for multiple admins
const ADMIN_CHAT_IDS = (Array.isArray(CONFIG.ADMIN_CHAT_IDS) ? CONFIG.ADMIN_CHAT_IDS : [CONFIG.ADMIN_CHAT_IDS]).map(id => Number(id));

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
// PURCHASE_KEYS moved to config.json for flexibility
const PURCHASE_KEYS = CONFIG.PURCHASE_KEYS || [];

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

// Check if user is an Admin (now supports multiple IDs)
function isAdmin(id) {
    // Ensuring that the ID is a number for strict comparison against ADMIN_CHAT_IDS
    return ADMIN_CHAT_IDS.includes(Number(id));
}

// --- UI Texts & Keyboards ---
const TEXTS = {
  START: `📡 Flash Protocol Support Hub\n\nأهلاً بك.\nتستطيع إرسال:\n• كود المفتاح (Key)\n• أو عنوان المحفظة (TRC20)\n• أو وصف للمشكلة الآن.\n\nاختر:`,

  OPTIONS_KB: Markup.keyboard([
    ['🔑 إرسال كود مفتاح', '🏦 إرسال محفظة TRC20'],
    ['📝 بلّغ عن مشكلة', '📕 الأسئلة الشائعة']
  ]).resize(),

  ACK_RECEIVED: (ticketId, priority) => `✅ تم استلام طلبك. رقم التذكرة: *${ticketId}*\nالأولوية: *${priority}*\n\nحالة التذكرة: _قيد المراجعة_.\nيمكنك متابعة حالتها عبر الأمر: \`/status ${ticketId}\`\n\n*ملاحظة: يمكنك الرد على هذه الرسالة لإضافة تفاصيل جديدة إلى نفس التذكرة قبل أن يتم الرد عليها من الإدارة.*`,

  KEY_VALID: (key) => `🔒 فحص المفتاح: *${key}*\n\n✅ النتيجة: المفتاح معروف وصالح حسب قاعدة البيانات المحلية.`,
  KEY_UNKNOWN: (key) => `🔒 فحص المفتاح: *${key}*\n\n⚠️ النتيجة: لم يتم العثور على هذا الكود في النظام المحلي. سيتم حفظ التذكرة لمراجعة الفريق.`,
  WALLET_VALID: (addr) => `🔗 فحص المحفظة: \`${addr}\`\n\n✅ النتيجة: عنوان TRC20 يبدو صحيحاً وصالحاً لربط العرض المبدئي.`,
  WALLET_INVALID: (addr) => `🔗 فحص المحفظة: \`${addr}\`\n\n⚠️ النتيجة: تنسيق العنوان غير صحيح. تأكد أن العنوان يبدأ بحرف T وطوله صحيح.`,
  HELP: `⚙️ أوامر مفيدة:\n/start - بداية المحادثة\n/help - تعليمات\n/status <TICKET_ID> - عرض حالة تذكرتك\n`,
  SUPPORT_PROMPT: `📝 من فضلك اكتب وصف المشكلة هنا. اذكر أكبر قدر ممكن من التفاصيل (المفتاح إن وجد، محفظة، TXID، صور...).`,
  
  ADMIN_NOTICE: (ticket) => `🔔 تذكرة جديدة: *${ticket.id}* (الأولوية: ${ticket.priority})\nمن: ${ticket.user_name} (${ticket.user_id}) ${ticket.user_username}\nنوع: ${ticket.type}\nحالة: *${ticket.status.toUpperCase()}*\nمحتوى:\n${ticket.content}`,
  
  // Updated Admin Keyboard with QR buttons
  ADMIN_KB: (ticketId) => {
      const qrButtons = Object.keys(CONFIG.QUICK_REPLIES).map(key => 
          Markup.button.callback(`[${key.toUpperCase()}]`, `qr_exec:${ticketId}:${key}`)
      );
      return Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ إغلاق التذكرة', `ticket_close:${ticketId}`),
            Markup.button.callback('↩️ الرد على التذكرة', `ticket_reply:${ticketId}`) 
          ],
          qrButtons.slice(0, 3), // Add up to 3 QR buttons
          [
            Markup.button.callback('⚙️ عرض التفاصيل', `ticket_view:${ticketId}`),
            Markup.button.callback('🗑️ حذف (تجريب)', `ticket_delete:${ticketId}`)
          ]
      ]);
  },

  ADMIN_DASHBOARD_KB: Markup.inlineKeyboard([
      [Markup.button.callback('🔍 بحث في التذاكر', 'admin_search')],
      [Markup.button.callback('👤 سجل نشاط العملاء', 'admin_userhistory')],
      [Markup.button.callback('📋 التذاكر المفتوحة', 'admin_tickets')],
      [Markup.button.callback('📝 إضافة ملاحظة داخلية', 'admin_note')],
      [Markup.button.callback('✏️ تغيير حالة التذكرة', 'admin_setstatus')]
  ]),

  ADMIN_REPLY_CONFIRM: (ticketId) => Markup.inlineKeyboard([
      [Markup.button.callback('✅ إرسال الرد للعميل', `send_reply:${ticketId}`)],
      [Markup.button.callback('❌ إلغاء الرد', `cancel_reply:${ticketId}`)]
  ]),
  
  CLIENT_CONFIRM_KB: (ticketId) => Markup.inlineKeyboard([
      Markup.button.callback('✅ نعم، تم حلها', `confirm_close_yes:${ticketId}`),
      Markup.button.callback('❌ لا، المشكلة مستمرة', `confirm_close_no:${ticketId}`)
  ])
};

// --- Ticket Creation Helper ---
async function createTicket(ctx, type, content, media = null, replyToTicketId = null) {
    const userInfo = getUserInfo(ctx);
    const priority = determinePriority(content);
    
    // Check if client is replying to an open ticket
    if (replyToTicketId) {
        // Find ticket that is open and belongs to the user
        const existingTicket = TICKETS.find(t => t.id === replyToTicketId && t.user_id === userInfo.id && !t.status.includes('closed'));
        if (existingTicket) {
            // Append message to existing ticket content and notify admin
            existingTicket.content += `\n\n--- إضافة العميل (${new Date().toLocaleTimeString()}):\n${content}`;
            existingTicket.status = 'open (updated by client)';
            existingTicket.history.push({time: new Date().toISOString(), action: 'client_update', by: 'client'}); 
            
            saveJSON(TICKETS_FILE, TICKETS);
            await ctx.reply(`✅ تم إضافة رسالتك إلى التذكرة *${existingTicket.id}*. سيتم إشعار فريق الدعم بالتحديث.`, { parse_mode: 'Markdown', ...TEXTS.OPTIONS_KB });
            
            // Notify all admins about the update
            const adminMsg = `⚠️ تحديث على التذكرة *${existingTicket.id}* (مفتوحة):\n\nمن: ${existingTicket.user_name}\n${content}`;
            for (const adminId of ADMIN_CHAT_IDS) {
                 try {
                     await BOT.telegram.sendMessage(adminId, adminMsg, { parse_mode: 'Markdown' });
                 } catch(e) { console.error(`Admin update send error to ${adminId}:`, e); }
            }
            return existingTicket;
        }
    }
    
    // Create new ticket
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
        admin_notes: [],
        history: [{time: new Date().toISOString(), action: 'created', by: 'client'}]
    };
    TICKETS.unshift(ticket); 
    saveJSON(TICKETS_FILE, TICKETS);
    
    // Notify all admins
    if (ADMIN_CHAT_IDS.length > 0) {
        let adminMsg = TEXTS.ADMIN_NOTICE(ticket);
        
        for (const adminId of ADMIN_CHAT_IDS) {
            if (media) {
                adminMsg += `\n\n_مرفق ملف/صورة: ${media.file_type}_`;
                
                try {
                    // Note: We use the first admin message to get the reply_to_message functionality working on quoting
                    const sentMsg = await BOT.telegram.sendPhoto(adminId, media.file_id, { 
                        caption: adminMsg, 
                        parse_mode: 'Markdown',
                        ...TEXTS.ADMIN_KB(ticket.id)
                    });
                    // Store the message ID for quoting accuracy (optional but good practice)
                    ticket.admin_message_id = sentMsg.message_id; 

                } catch(e) { 
                    console.error(`Admin media send error to ${adminId}:`, e); 
                    // Fallback to document if photo fails, or text if all fails
                    try {
                        const sentMsg = await BOT.telegram.sendDocument(adminId, media.file_id, { 
                            caption: adminMsg, 
                            parse_mode: 'Markdown',
                            ...TEXTS.ADMIN_KB(ticket.id)
                        });
                        ticket.admin_message_id = sentMsg.message_id; 
                    } catch(e2) {
                        await BOT.telegram.sendMessage(adminId, adminMsg + '\n\n(فشل إرسال المرفق)', { parse_mode: 'Markdown', ...TEXTS.ADMIN_KB(ticket.id) });
                    }
                }
            } else {
                 // Send text ticket to admin
                try { 
                    const sentMsg = await BOT.telegram.sendMessage(adminId, adminMsg, { 
                        parse_mode: 'Markdown', 
                        ...TEXTS.ADMIN_KB(ticket.id) 
                    }); 
                    // Store the message ID for quoting accuracy (optional but good practice)
                    ticket.admin_message_id = sentMsg.message_id; 
                } catch(e) { console.error(`Admin text send error to ${adminId}:`, e); }
            }
        }
    }
    
    await ctx.replyWithMarkdown(TEXTS.ACK_RECEIVED(ticket.id, priority), TEXTS.OPTIONS_KB);
    saveJSON(TICKETS_FILE, TICKETS); // Save again with admin_message_id if stored
    botLog(`Ticket ${ticket.id} created by ${userInfo.id}. Type: ${type}`);
    return ticket;
}

// --- Handlers ---

BOT.start(async (ctx) => {
  await ctx.reply(TEXTS.START, TEXTS.OPTIONS_KB);
  botLog(`Start from ${ctx.from.id}`);
});

BOT.help((ctx) => ctx.reply(TEXTS.HELP));

// --- 1. Client Status Command (/status) ---
BOT.command('status', async (ctx) => {
    const parts = ctx.message.text.split(' ').filter(Boolean);
    if (parts.length < 2) return ctx.reply('الاستخدام: /status <TICKET_ID>');
    const id = parts[1].trim().toUpperCase();

    // Allow Admin to view any ticket status, client only their own
    const t = isAdmin(ctx.from.id) 
        ? TICKETS.find(x => x.id === id)
        : TICKETS.find(x => x.id === id && Number(x.user_id) === Number(ctx.from.id));
        
    if (!t) return ctx.reply('عذراً، لم يتم العثور على تذكرة بهذا الرقم.'); // Removed "or it is not your ticket"

    let msg = `*حالة التذكرة: ${t.id}*\n`;
    // If admin, show client details
    if (isAdmin(ctx.from.id)) {
        msg += `العميل: ${t.user_name} (${t.user_id})\n`;
    }
    msg += `الأولوية: ${t.priority}\n`;
    msg += `الحالة: *${t.status.toUpperCase()}*\n`;
    msg += `تم إنشاؤها في: ${t.time.substring(0, 10)}\n`;
    msg += `المحتوى: _${t.content.substring(0, 100)}..._\n\n`;

    // Display basic history/notes
    if (t.history && t.history.length > 0) {
        msg += `*سجل التفاعلات:*\n`;
        t.history.slice(-3).forEach(h => {
             msg += `• [${h.time.substring(5, 16)}] ${h.action} by ${h.by}\n`;
        });
        if (t.history.length > 3) msg += '...';
    } else if (t.status.includes('open') || t.status.includes('review') || t.status.includes('awaiting')) {
        msg += 'التذكرة قيد المراجعة، سيتم الرد عليك قريباً.';
    }

    // If admin, show internal notes
    if (isAdmin(ctx.from.id) && t.admin_notes && t.admin_notes.length > 0) {
         msg += '\n*ملاحظات إدارية (للفريق فقط):*\n';
         t.admin_notes.forEach(n => msg += `• ${n.note || n.reply.substring(0, 30) + '... (Reply)'} (by ${n.admin_id})\n`);
    }

    await ctx.replyWithMarkdown(msg);
});

// --- 2. Generic Text Handler (Ticket Creation / Quick Checks / Admin Reply) ---
BOT.on('text', async (ctx) => {
    try {
        const text = (ctx.message.text || '').trim();
        const replyToMessage = ctx.message.reply_to_message;
        
        // --- ADMIN ONLY: Handle Ad-Hoc Reply by Quoting ---
        if (isAdmin(ctx.from.id) && replyToMessage) {
            const noticeRegex = /🔔 تذكرة جديدة:\s*\*([A-Z0-9-]+)\*/;
            const match = replyToMessage.text ? replyToMessage.text.match(noticeRegex) : null;
            
            // Check if the admin is replying to an official ticket notification
            if (match) {
                const ticketId = match[1];
                
                // If the message is an explicit command, let the command handler take over (e.g., /reply)
                if (text.startsWith('/')) {
                    // Let the command handler process the message
                    return; 
                }
                
                // Otherwise, treat any plain text reply as an intended response
                await ctx.reply(`هل تريد إرسال الرد التالي للعميل (${ticketId}):\n\n*${text}*`, { 
                    parse_mode: 'Markdown', 
                    ...TEXTS.ADMIN_REPLY_CONFIRM(ticketId) 
                });
                
                // Store the reply temporarily in the ticket object for confirmation
                const t = TICKETS.find(x => x.id === ticketId);
                if (t) {
                    // Using a dedicated field for temporary admin reply text
                    t.temp_reply_text = text;
                    saveJSON(TICKETS_FILE, TICKETS);
                }
                return; // Stop processing further to avoid creating a new ticket
            }
            
            // If admin replies to a non-ticket message or a non-ticket message from the bot, IGNORE.
            // This prevents an admin's casual reply in the admin chat from being treated as a command or a ticket.
            return; 
        }

        // --- ADMIN ONLY: Ignore non-command messages outside of replies ---
        if (isAdmin(ctx.from.id)) {
            // This ensures that an admin typing "hello" without /command is ignored
            if (!text.startsWith('/')) return;
            // Let the command handlers process the command
            return; 
        }

        // --- CLIENT Logic starts here ---

        // Check for quick keyboard commands
        if (['🔑 إرسال كود مفتاح', '🏦 إرسال محفظة TRC20', '📝 بلّغ عن مشكلة'].includes(text)) {
            return ctx.reply(text === '📝 بلّغ عن مشكلة' ? TEXTS.SUPPORT_PROMPT : `أرسل ${text.split(' ')[1]} هنا.`);
        }
        
        // FAQ
        if (text === '📕 الأسئلة الشائعة') {
             const faqData = CONFIG.FAQ_DATA && CONFIG.FAQ_DATA.main;
             if(faqData && faqData.buttons) {
                 return ctx.reply(faqData.text, Markup.inlineKeyboard(faqData.buttons.map(b => [b])));
             }
             return ctx.reply('عذراً، بيانات الأسئلة الشائعة غير متاحة حالياً.');
        }
        
        // --- Handle Client Reply to an open ticket (if replying to BOT ACK message) ---
        if (replyToMessage && replyToMessage.from.id === ctx.botInfo.id) {
             const ackRegex = /رقم التذكرة:\s*\*([A-Z0-9-]+)\*/;
             const match = replyToMessage.text ? replyToMessage.text.match(ackRegex) : null;
             if (match) {
                 const ticketId = match[1];
                 const updatedTicket = await createTicket(ctx, 'client_update', text, null, ticketId);
                 if (updatedTicket) return; // Ticket updated, stop further processing
             }
        }
        
        // --- Key/Wallet Automatic Check and Ticket ---
        const maybeKey = text.toUpperCase();
        if (isKnownKey(maybeKey)) {
            await ctx.replyWithMarkdown(TEXTS.KEY_VALID(maybeKey));
            return createTicket(ctx, 'key-check', `Key check: ${maybeKey}`);
        }
        
        if (looksLikeTRC20(text)) {
             if (maybeKey.includes('TXID')) { 
                 // Will fall through to support ticket below
             } else {
                await ctx.replyWithMarkdown(TEXTS.WALLET_VALID(text));
                return createTicket(ctx, 'wallet-check', `Wallet check: ${text}`);
             }
        }

        // --- Otherwise treat as generic support message -> create ticket ---
        return createTicket(ctx, 'support', text);

    } catch (e) {
        console.error('on text error', e);
    }
});

// --- 3. Media Handlers (Photos and Documents) ---
BOT.on(['photo', 'document'], async (ctx) => {
    // Only process media from non-admins
    if (isAdmin(ctx.from.id)) return;
    
    try {
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

        return createTicket(ctx, `support-media-${type}`, caption, mediaInfo);
        
    } catch (e) {
        console.error('on media error', e);
        ctx.reply('عفواً، حدث خطأ أثناء معالجة الملف المرفق. يرجى محاولة إرسال الرسالة النصية أولاً.');
    }
});


// --- 4. Callback Query Handler (For Inline Keyboards: FAQ, Admin Actions, Client Confirmation) ---
BOT.on('callback_query', async (ctx) => {
    try {
        const data = ctx.callbackQuery.data;
        const parts = data.split(':');
        const action = parts[0];
        const ticketId = parts[1];
        
        await ctx.answerCbQuery(); // Dismiss loading icon

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

        // --- Admin Actions (Including new confirmation buttons) ---
        if (isAdmin(ctx.from.id)) {
            const ticketIndex = TICKETS.findIndex(t => t.id === ticketId);
            const ticket = ticketIndex !== -1 ? TICKETS[ticketIndex] : null;

            // Dashboard Actions (if called from admin_dashboard)
            if (action.startsWith('admin_')) {
                // ... (Logic for admin dashboard actions remains the same)
                if (action === 'admin_tickets') return await listOpenTickets(ctx);
                if (action === 'admin_search') return ctx.reply('للبحث، استخدم الأمر: /search <نص_البحث_هنا>');
                if (action === 'admin_userhistory') return ctx.reply('لسجل العميل، استخدم الأمر: /userhistory <USER_ID>');
                if (action === 'admin_note') return ctx.reply('لإضافة ملاحظة، استخدم الأمر: /note <TICKET_ID> <نص_الملاحظة>');
                if (action === 'admin_setstatus') return ctx.reply('لتغيير الحالة، استخدم الأمر: /setstatus <TICKET_ID> <الحالة_الجديدة>');
                return;
            }

            // --- New Reply Confirmation Actions ---
            if (action === 'send_reply') {
                if (!ticket || !ticket.temp_reply_text) return ctx.reply('خطأ: لا يمكن العثور على نص الرد المؤقت.');
                
                const replyText = ticket.temp_reply_text;
                delete ticket.temp_reply_text; // Clear temporary field
                saveJSON(TICKETS_FILE, TICKETS);
                
                await replyCommandLogic(ctx, ticketId, replyText);
                
                // Update the confirmation message
                try {
                     await ctx.editMessageText(`✅ تم إرسال الرد المؤكد (التذكرة: ${ticketId})`, { parse_mode: 'Markdown' });
                } catch(e) { /* ignore edit error */ }
                return;
            }

            if (action === 'cancel_reply') {
                if (ticket) {
                    delete ticket.temp_reply_text; // Clear temporary field
                    saveJSON(TICKETS_FILE, TICKETS);
                }
                try {
                    await ctx.editMessageText(`❌ تم إلغاء الرد على التذكرة: ${ticketId}.`, { parse_mode: 'Markdown' });
                } catch(e) { /* ignore edit error */ }
                return;
            }
            // --- End New Reply Confirmation Actions ---

            // Existing ticket actions (close, view, delete, qr_exec)
            if (!ticket) return;

            if (action === 'ticket_view') {
                let msg = `*${ticket.id}* | ${ticket.type} | الأولوية: ${ticket.priority}\n`;
                msg += `من: ${ticket.user_name} (${ticket.user_id}) ${ticket.user_username}\n`;
                msg += `الحالة: *${ticket.status.toUpperCase()}*\n`;
                msg += `المحتوى:\n${ticket.content}\n\n`;
                if (ticket.media) msg += `_مرفق ملف/صورة: ${ticket.media.file_type}_\n`;
                if (ticket.admin_notes && ticket.admin_notes.length > 0) {
                     msg += `*ملاحظات الإدارة:*\n`;
                     ticket.admin_notes.forEach(n => msg += `• [${n.time.substring(5, 16)}] by ${n.admin_id}: ${n.note ? n.note.substring(0, 50) + '...' : n.reply.substring(0, 50) + '... (Reply)'}\n`);
                }
                
                await ctx.replyWithMarkdown(msg);
                return;
            }
            
            if (action === 'ticket_reply') {
                return ctx.reply(`أرسل ردك الآن باستخدام الأمر، *مع الإقتباس* من رسالة التذكرة:\n\n/reply [نص الرسالة]`);
            }
            
            if (action === 'ticket_close') {
                ticket.status = 'closed (Admin)';
                ticket.history.push({time: new Date().toISOString(), action: 'closed', by: `admin:${ctx.from.id}`});
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

            // Quick Reply Execution (QR)
            if (action === 'qr_exec') {
                 const qrKey = parts[2];
                 if (!CONFIG.QUICK_REPLIES[qrKey]) return ctx.reply(`خطأ: مفتاح الرد السريع غير موجود.`);
                 
                 const replyText = CONFIG.QUICK_REPLIES[qrKey];
                 await replyCommandLogic(ctx, ticketId, replyText);
                 
                 try {
                     await ctx.editMessageText(`✅ تم تنفيذ الرد السريع [${qrKey.toUpperCase()}] على التذكرة *${ticketId}*.`, { parse_mode: 'Markdown' });
                 } catch(e) { /* ignore edit error */ }
                 return;
            }
        }
        
        // --- Client Confirmation Actions ---
        if (action.startsWith('confirm_close_')) {
            const ticketIndex = TICKETS.findIndex(t => t.id === ticketId);
            if (ticketIndex === -1) return ctx.reply('عفواً، التذكرة غير موجودة/محذوفة.');

            if (action === 'confirm_close_yes') {
                TICKETS[ticketIndex].status = 'closed (Client Confirmed)';
                TICKETS[ticketIndex].history.push({time: new Date().toISOString(), action: 'confirmed solved', by: 'client'});
                saveJSON(TICKETS_FILE, TICKETS);
                await ctx.editMessageText(`✅ شكراً لك! تم إغلاق تذكرتك *${ticketId}* بنجاح.`, { parse_mode: 'Markdown' });
                return;
            }
            
            if (action === 'confirm_close_no') {
                TICKETS[ticketIndex].status = 'open (Reopened by Client)';
                TICKETS[ticketIndex].history.push({time: new Date().toISOString(), action: 'reopened', by: 'client'});
                saveJSON(TICKETS_FILE, TICKETS);
                await ctx.editMessageText(`⚠️ تم إعادة فتح التذكرة *${ticketId}*. سيتم تحويل طلبك لمدير الدعم للمتابعة.`, { parse_mode: 'Markdown' });
                // Notify admin again
                for (const adminId of ADMIN_CHAT_IDS) {
                    try { await BOT.telegram.sendMessage(adminId, `⚠️ التذكرة *${ticketId}* أعيد فتحها بواسطة العميل.`, { parse_mode: 'Markdown' }); } catch(e){}
                }
                return;
            }
        }
        
    } catch (e) {
        console.error('on callback query error', e);
    }
});

// Reusable logic for /reply and QR execution
async function replyCommandLogic(ctx, id, replyText) {
    const tIdx = TICKETS.findIndex(x=>x.id===id);
    
    if(tIdx === -1) return ctx.reply('التذكرة غير موجودة.');
    
    const ticket = TICKETS[tIdx];
    try {
        // Send reply to user
        const replyMsg = `🔔 تحديث تذكرتك *${ticket.id}* (تم الرد):\n\n${replyText}`;
        await BOT.telegram.sendMessage(ticket.user_id, replyMsg, { 
            parse_mode: 'Markdown',
            ...TEXTS.CLIENT_CONFIRM_KB(ticket.id) // Send confirmation buttons
        });
        
        // Update ticket status and notes
        ticket.status = 'awaiting client confirmation';
        ticket.admin_notes.push({ time: new Date().toISOString(), admin_id: ctx.from.id, reply: replyText }); // Storing reply as a note
        ticket.history.push({time: new Date().toISOString(), action: 'replied', by: `admin:${ctx.from.id}`});
        saveJSON(TICKETS_FILE, TICKETS);
        
        await ctx.reply(`✅ تم إرسال الرد بنجاح للعميل (التذكرة: ${id}). تم تحويل الحالة إلى انتظار تأكيد العميل.`);
    } catch (e) {
        console.error('Reply command error:', e);
        await ctx.reply('❌ فشل في إرسال الرد للعميل. ربما قام بحظر البوت.');
    }
}

// /reply <text> (with quote) - admin: reply and send client confirmation
BOT.command('reply', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied. Admin only command.');
    
    const text = ctx.message.text.trim();
    const parts = text.split(' ').filter(Boolean);
    
    let id = null; // Ticket ID
    let replyText = null; // Response text

    // 1. Try to find ID from quoted message (The standard ticket notice message)
    if (ctx.message.reply_to_message) {
         const noticeRegex = /🔔 تذكرة جديدة:\s*\*([A-Z0-9-]+)\*/;
         const match = ctx.message.reply_to_message.text ? ctx.message.reply_to_message.text.match(noticeRegex) : null;
         
         if (match) {
             id = match[1]; // Found ID from the quoted message
             replyText = parts.slice(1).join(' '); // Reply text is all parts after /reply
         }
    }

    // 2. If not quoting, assume format: /reply <ID> <text>
    if (!id && parts.length >= 3) {
        const potentialId = parts[1].trim().toUpperCase();
        if (potentialId.startsWith('FP-SUP-')) {
            id = potentialId;
            replyText = parts.slice(2).join(' '); 
        }
    }
    
    // Final check for parameters
    if (!id || !replyText) {
        return ctx.reply('الاستخدام غير صحيح. يجب أن تستخدم:\n1. /reply <رسالة الرد> مع الإقتباس من رسالة التذكرة.\nأو\n2. /reply <TICKET_ID> <رسالة الرد> (مباشرة).');
    }
    
    id = id.trim().toUpperCase();
    
    return replyCommandLogic(ctx, id, replyText);
});


// /qr <id> <qr_key> - Admin quick reply command (Simplified for backup)
BOT.command('qr', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied. Admin only command.');
    
    const parts = ctx.message.text.split(' ').filter(Boolean);
    if (parts.length < 3) return ctx.reply('الاستخدام: /qr <TICKET_ID> <QR_KEY>.\nالمفاتيح المتاحة: ' + Object.keys(CONFIG.QUICK_REPLIES).join(', '));
    
    const id = parts[1].trim().toUpperCase();
    const qrKey = parts[2].trim().toLowerCase();
    
    if (!CONFIG.QUICK_REPLIES[qrKey]) return ctx.reply(`مفتاح الرد السريع (*${qrKey}*) غير موجود في الإعدادات.`);
    
    const replyText = CONFIG.QUICK_REPLIES[qrKey];
    
    // Directly call the handler logic
    return replyCommandLogic(ctx, id, replyText);
});


// Helper for listing open tickets (used by /tickets and dashboard)
async function listOpenTickets(ctx) {
    const open = TICKETS.filter(t => t.status.includes('open') || t.status.includes('review') || t.status.includes('awaiting')).slice(0, 20);
    if (open.length === 0) return ctx.reply('لا توجد تذاكر مفتوحة حالياً.');
    
    let msg = '*التذاكر المفتوحة (آخر 20):*\n';
    open.forEach(t=> msg += `\n${t.id} (${t.priority}) | ${t.type} | ${t.user_name} | ${t.status}\n`);
    await ctx.replyWithMarkdown(msg);
}

// /tickets - admin only: list open tickets
BOT.command('tickets', listOpenTickets);


// /admin or /dashboard - Admin only: Show dashboard keyboard
BOT.command(['admin', 'dashboard'], async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied.');
    await ctx.reply('*لوحة تحكم الأدمن (Dashboard)*\nاختر الإجراء المطلوب:', { 
        parse_mode: 'Markdown', 
        ...TEXTS.ADMIN_DASHBOARD_KB 
    });
});


// /search <query> - admin: search in ticket content
BOT.command('search', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied.');
    
    const query = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!query) return ctx.reply('الاستخدام: /search <نص_للبحث_عنه_في_محتوى_التذكرة>');

    const results = TICKETS.filter(t => t.content.toLowerCase().includes(query.toLowerCase())).slice(0, 10);
    
    if (results.length === 0) return ctx.reply(`لم يتم العثور على تذاكر تحتوي على: "${query}"`);

    let msg = `*نتائج البحث لـ "${query}" (أول 10):*\n`;
    results.forEach(t=> msg += `\n${t.id} (${t.priority}) | ${t.status} | ${t.user_name}\n`);
    await ctx.replyWithMarkdown(msg);
});

// /userhistory <USER_ID or @username> - admin: view all tickets for a user
BOT.command('userhistory', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied.');
    
    const target = ctx.message.text.split(' ')[1];
    if (!target) return ctx.reply('الاستخدام: /userhistory <USER_ID> أو <@username>');

    let targetId;
    if (target.startsWith('@')) {
        const userTicket = TICKETS.find(t => t.user_username.toLowerCase() === target.toLowerCase());
        if (!userTicket) return ctx.reply(`لم يتم العثور على سجل مستخدم بالـ Username: ${target}`);
        targetId = userTicket.user_id;
    } else if (!isNaN(Number(target))) {
        targetId = Number(target);
    } else {
        return ctx.reply('معرف المستخدم غير صحيح. يجب أن يكون ID رقمي أو Username يبدأ بـ @');
    }

    const userTickets = TICKETS.filter(t => t.user_id === targetId).slice(0, 20);
    if (userTickets.length === 0) return ctx.reply(`لم يتم العثور على تذاكر للمستخدم ID: ${targetId}`);

    let msg = `*سجل تذاكر المستخدم ${target} (أول 20):*\n`;
    userTickets.forEach(t=> msg += `\n${t.id} (${t.priority}) | ${t.status} | ${t.time.substring(0, 10)}\n`);
    await ctx.replyWithMarkdown(msg);
});

// /setstatus <ID> <status> - admin: manually change ticket status
BOT.command('setstatus', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied.');
    
    const parts = ctx.message.text.split(' ').filter(Boolean);
    if (parts.length < 3) return ctx.reply('الاستخدام: /setstatus <TICKET_ID> <حالة_جديدة>');
    
    const id = parts[1].trim().toUpperCase();
    const newStatus = parts.slice(2).join(' ');
    const tIdx = TICKETS.findIndex(x=>x.id===id);
    
    if(tIdx === -1) return ctx.reply('التذكرة غير موجودة.');
    
    TICKETS[tIdx].status = newStatus;
    TICKETS[tIdx].history.push({time: new Date().toISOString(), action: `status changed to: ${newStatus}`, by: `admin:${ctx.from.id}`});
    saveJSON(TICKETS_FILE, TICKETS);
    
    await ctx.reply(`✅ تم تحديث حالة التذكرة *${id}* إلى: *${newStatus}*.`, { parse_mode: 'Markdown' });
});

// /note <ID> <text> - admin: add internal note
BOT.command('note', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Access denied.');
    
    const parts = ctx.message.text.split(' ').filter(Boolean);
    if (parts.length < 3) return ctx.reply('الاستخدام: /note <TICKET_ID> <نص الملاحظة>');
    
    const id = parts[1].trim().toUpperCase();
    const noteText = parts.slice(2).join(' ');
    const tIdx = TICKETS.findIndex(x=>x.id===id);
    
    if(tIdx === -1) return ctx.reply('التذكرة غير موجودة.');
    
    if (!TICKETS[tIdx].admin_notes) TICKETS[tIdx].admin_notes = [];
    TICKETS[tIdx].admin_notes.push({ time: new Date().toISOString(), admin_id: ctx.from.id, note: noteText });
    TICKETS[tIdx].history.push({time: new Date().toISOString(), action: 'internal note added', by: `admin:${ctx.from.id}`});
    saveJSON(TICKETS_FILE, TICKETS);
    
    await ctx.reply(`✅ تم إضافة الملاحظة الداخلية بنجاح إلى التذكرة *${id}*.`, { parse_mode: 'Markdown' });
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
