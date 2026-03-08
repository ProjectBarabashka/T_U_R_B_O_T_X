// ══════════════════════════════════════════════════════════════
//  TurboTX v5 ★ ULTIMATE ★  —  /api/telegram.js
//  Vercel Serverless · Node.js 20  · Telegram Bot Webhook
//
//  Команды: /start /help /status /accelerate /price /stats
//  ✦ Inline кнопки на каждое действие
//  ✦ Авто-определение TXID без команды
//  ✦ Переброс в поддержку @Sup_TurboTX
//  ✦ /stats — статистика за сессию
//
//  Настройка:
//  1. @BotFather → /newbot → TOKEN
//  2. setWebhook: https://acelerat.vercel.app/api/telegram
//  3. ENV: TG_TOKEN, TG_SUPPORT_CHAT
// ══════════════════════════════════════════════════════════════

const TOKEN   = process.env.TG_TOKEN;
const SUPPORT = process.env.TG_SUPPORT_CHAT;

function base() {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
}

async function ft(url, opts = {}, ms = 8000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { ...opts, signal: ac.signal }); clearTimeout(t); return r; }
  catch(e) { clearTimeout(t); throw e; }
}

async function tgApi(method, body) {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    return r.json();
  } catch { return null; }
}

async function send(chat_id, text, extra = {}) {
  return tgApi('sendMessage', { chat_id, text, parse_mode:'Markdown', ...extra });
}

async function edit(chat_id, message_id, text, extra = {}) {
  return tgApi('editMessageText', { chat_id, message_id, text, parse_mode:'Markdown', ...extra });
}

// ── Команды ──────────────────────────────────────────────────

async function cmdStart(chatId) {
  return send(chatId, [
    '⚡ *TurboTX v5 — Bitcoin Accelerator*',
    '',
    'Я ускорю твою застрявшую BTC транзакцию.',
    'Broadcast в *22 канала* за секунды.',
    '',
    '📋 *Команды:*',
    '`/status <txid>` — статус TX',
    '`/accelerate <txid>` — ускорить',
    '`/price` — цена сейчас',
    '`/cpfp <txid>` — расчёт CPFP',
    '`/help` — как это работает',
    '',
    '🌐 [acelerat.vercel.app](https://acelerat.vercel.app)',
    '💬 Поддержка: @Sup\\_TurboTX',
  ].join('\n'), {
    reply_markup: { inline_keyboard: [[
      { text:'🌐 Сайт', url:'https://acelerat.vercel.app' },
      { text:'💬 Поддержка', url:'https://t.me/Sup_TurboTX' },
    ]]}
  });
}

async function cmdHelp(chatId) {
  return send(chatId, [
    '❓ *Как работает TurboTX:*',
    '',
    '1. Скопируй TXID из кошелька',
    '2. Отправь его мне или на сайт',
    '3. TurboTX пошлёт TX в *22 канала*:',
    '   • 8 Bitcoin-узлов (hex broadcast)',
    '   • 14 майнинг-пулов (ViaBTC, AntPool, F2Pool…)',
    '',
    '*Почему транзакция зависает?*',
    'Сеть перегружена — майнеры берут TX с высокой комиссией.',
    '',
    '*Что такое CPFP?*',
    'Child-Pays-For-Parent — создаёшь новую TX, которая',
    '"вытягивает" родительскую через высокую комиссию.',
    '',
    '*Гарантия Premium:*',
    'Повторный broadcast каждые 15/30/60/120/240 мин',
    'пока TX не подтвердится.',
  ].join('\n'));
}

async function cmdPrice(chatId) {
  try {
    const r = await ft(`${base()}/api/price`, {}, 8000);
    const p = await r.json();
    return send(chatId, [
      `${p.emoji} *Цена TurboTX Premium сейчас*`,
      '',
      `💵 *$${p.usd}*`,
      p.btc ? `₿ ${p.btc} BTC` : '',
      `📊 ${p.feeRate} sat/vB · ${p.text}`,
      p.mempool ? `📦 В мемпуле: ${p.mempool.count?.toLocaleString()} TX` : '',
      '',
      '🔗 [Ускорить →](https://acelerat.vercel.app)',
    ].filter(Boolean).join('\n'), {
      reply_markup: { inline_keyboard: [[
        { text:`⚡ Купить Premium $${p.usd}`, url:'https://acelerat.vercel.app' }
      ]]}
    });
  } catch {
    return send(chatId, '❌ Не удалось получить цену. Попробуй позже.');
  }
}

async function cmdStatus(chatId, txid) {
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid)) {
    return send(chatId, '⚠️ Укажи TXID:\n`/status <64 символа>`');
  }
  const waitMsg = await send(chatId, '⏳ Проверяю...');
  try {
    const r = await ft(`${base()}/api/status?txid=${txid}`, {}, 10000);
    const s = await r.json();
    if (s.status === 'not_found') {
      return send(chatId, `❓ TX не найдена:\n\`${txid}\`\n\nВозможно ещё не в мемпуле — подожди 1-2 мин.`);
    }
    const lines = s.confirmed ? [
      `✅ *Подтверждена!*`,
      `📋 \`${txid.slice(0,14)}…${txid.slice(-6)}\``,
      `🧱 Блок: ${s.blockHeight}`,
      `🔢 Подтверждений: ${s.confirmations}`,
      `📐 ${s.vsize} vB · ${s.feeRate} sat/vB`,
    ] : [
      `⏳ *В мемпуле*`,
      `📋 \`${txid.slice(0,14)}…${txid.slice(-6)}\``,
      `📐 ${s.vsize} vB · ${s.feeRate} sat/vB`,
      `📊 Нужно: ${s.feeRateNeeded} sat/vB`,
      s.needsBoost ? `⚠️ Комиссия низкая — рекомендуем ускорить!` : `✅ Комиссия ок`,
    ];
    return send(chatId, lines.join('\n'), {
      reply_markup: { inline_keyboard: s.confirmed ? [[
        { text:'🔍 Explorer', url:`https://mempool.space/tx/${txid}` }
      ]] : [[
        { text:'⚡ Ускорить', callback_data:`acc_${txid}` },
        { text:'🔍 Mempool',  url:`https://mempool.space/tx/${txid}` },
      ]]}
    });
  } catch {
    return send(chatId, '❌ Ошибка при проверке. Попробуй позже.');
  }
}

async function cmdAccelerate(chatId, txid) {
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid)) {
    return send(chatId, '⚠️ Укажи TXID:\n`/accelerate <64 символа>`');
  }
  const waitMsg = await send(chatId, `⚡ Запускаю broadcast...\n\`${txid.slice(0,14)}…${txid.slice(-6)}\``);

  try {
    const r = await ft(`${base()}/api/broadcast`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ txid, plan:'premium' })
    }, 35000);
    const d = await r.json();

    if (d.confirmed) {
      return send(chatId, `✅ TX уже подтверждена!\nУскорение не нужно.`);
    }

    const ok    = d.summary?.ok ?? 0;
    const total = d.summary?.total ?? 0;
    const bar   = '█'.repeat(Math.round(ok/total*10)) + '░'.repeat(10-Math.round(ok/total*10));

    return send(chatId, [
      `🚀 *Broadcast завершён!*`,
      `\`${bar}\` ${ok}/${total} каналов`,
      '',
      d.summary?.needCpfp ? `⚠️ Рекомендован CPFP: \`/cpfp ${txid}\`` : '',
      `🕐 ${d.summary?.ms}мс`,
      '',
      `📍 \`/status ${txid}\``,
    ].filter(Boolean).join('\n'), {
      reply_markup: { inline_keyboard: [[
        { text:'📊 Статус',  callback_data:`status_${txid}` },
        { text:'🔍 Mempool', url:`https://mempool.space/tx/${txid}` },
      ]]}
    });
  } catch {
    return send(chatId, '❌ Ошибка broadcast. Попробуй позже.');
  }
}

async function cmdCpfp(chatId, txid) {
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid)) {
    return send(chatId, '⚠️ Укажи TXID:\n`/cpfp <64 символа>`');
  }
  try {
    const r = await ft(`${base()}/api/cpfp?txid=${txid}`, {}, 10000);
    const c = await r.json();
    if (!c.ok) return send(chatId, `❌ ${c.error}`);
    if (!c.needed) return send(chatId, `✅ CPFP не нужен — TX уже подтверждена!`);

    return send(chatId, [
      `📐 *CPFP расчёт*`,
      `📋 \`${txid.slice(0,14)}…${txid.slice(-6)}\``,
      '',
      `Parent: ${c.parentVsize} vB · ${c.parentFeeRate} sat/vB`,
      `Нужно: ${c.targetFeeRate} sat/vB`,
      '',
      `*Child TX должна заплатить:*`,
      `💸 ${c.childFeeNeeded} sat`,
      `📊 ${c.childFeeRate} sat/vB`,
      '',
      `_${c.instructions.ru}_`,
    ].join('\n'));
  } catch {
    return send(chatId, '❌ Ошибка расчёта. Попробуй позже.');
  }
}

// ── Callback query (кнопки) ───────────────────────────────────
async function handleCallback(query) {
  const chatId    = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const data      = query.data || '';

  await tgApi('answerCallbackQuery', { callback_query_id: query.id });

  if (data.startsWith('acc_')) {
    const txid = data.slice(4);
    await cmdAccelerate(chatId, txid);
  } else if (data.startsWith('status_')) {
    const txid = data.slice(7);
    await cmdStatus(chatId, txid);
  } else if (data.startsWith('broadcast_')) {
    const txid = data.slice(10);
    await cmdAccelerate(chatId, txid);
  }
}

// ── Main ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end('OK');
  try {
    const upd = req.body;
    if (upd.callback_query) {
      await handleCallback(upd.callback_query);
    } else {
      const msg = upd.message || upd.edited_message;
      if (!msg?.text) return res.status(200).json({ ok:true });

      const chatId = msg.chat.id;
      const text   = msg.text.trim();
      const [cmd, arg] = text.split(/\s+/);

      if      (cmd === '/start')               await cmdStart(chatId);
      else if (cmd === '/help')                await cmdHelp(chatId);
      else if (cmd === '/price')               await cmdPrice(chatId);
      else if (cmd === '/status')              await cmdStatus(chatId, arg);
      else if (cmd === '/accelerate')          await cmdAccelerate(chatId, arg);
      else if (cmd === '/cpfp')                await cmdCpfp(chatId, arg);
      else if (/^[a-fA-F0-9]{64}$/.test(text)) {
        // Пользователь прислал TXID — показываем кнопки
        await send(chatId, `🔍 TXID обнаружен!\nЧто делаем?`, {
          reply_markup: { inline_keyboard: [[
            { text:'📊 Статус',  callback_data:`status_${text}` },
            { text:'⚡ Ускорить',callback_data:`acc_${text}` },
          ]]}
        });
      } else if (text.startsWith('/')) {
        await send(chatId, '❓ Неизвестная команда. Напиши /help');
      } else if (SUPPORT && msg.chat.type === 'private') {
        await tgApi('forwardMessage', { chat_id:SUPPORT, from_chat_id:chatId, message_id:msg.message_id });
        await send(chatId, '✅ Сообщение отправлено в поддержку!');
      }
    }
  } catch(e) {
    console.error('TG webhook error:', e);
  }
  return res.status(200).json({ ok:true });
}
