// ══════════════════════════════════════════════════════════════
//  TurboTX v5 ★ ULTIMATE ★  —  /api/notify.js
//  Vercel Serverless · Node.js 20
//
//  POST /api/notify
//  Body: { type:'payment'|'broadcast'|'confirmed', ...data }
//
//  ✦ Уведомления: оплата, broadcast, подтверждение
//  ✦ Telegram inline-кнопки (mempool ссылка)
//  ✦ Токен никогда не светится в браузере
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 8 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function tgSend(token, chatId, text, extra = {}) {
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id:chatId, text, parse_mode:'Markdown', ...extra }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));
  if (req.method !== 'POST') return res.status(405).end();

  const token  = process.env.TG_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) return res.status(200).json({ ok:false, reason:'TG not configured' });

  const { type, paidStr, method, txShort, txid, plan, wave, okCount, total } = req.body || {};
  const now = new Date().toLocaleString('ru-RU', { timeZone:'Europe/Moscow' });

  let text = '';
  let extra = {};

  if (type === 'payment') {
    text = [
      '💰 *НОВАЯ ОПЛАТА — TurboTX v5*',
      '━━━━━━━━━━━━━━━━━━',
      `💵 Сумма: \`${paidStr || '?'}\``,
      `💳 Способ: ${method || '?'}`,
      txShort ? `🔗 TXID: \`${txShort}\`` : '',
      `📋 Тариф: *${(plan||'free').toUpperCase()}*`,
      `🕐 ${now} МСК`,
    ].filter(Boolean).join('\n');

    if (txid) {
      extra.reply_markup = {
        inline_keyboard: [[
          { text: '🔍 Mempool', url: `https://mempool.space/tx/${txid}` },
          { text: '⚡ Запустить', callback_data: `broadcast_${txid}` },
        ]]
      };
    }

  } else if (type === 'broadcast') {
    const bar = total ? '█'.repeat(Math.round((okCount||0)/total*10)) + '░'.repeat(10-Math.round((okCount||0)/total*10)) : '░░░░░░░░░░';
    text = [
      '⚡ *BROADCAST — TurboTX v5*',
      '━━━━━━━━━━━━━━━━━━',
      txid ? `📋 \`${txid.slice(0,14)}…${txid.slice(-6)}\`` : '',
      `🎯 ${(plan||'free').toUpperCase()} · Волна ${wave||1}`,
      `\`${bar}\` ${okCount||0}/${total||0}`,
      `🕐 ${now} МСК`,
    ].filter(Boolean).join('\n');

    if (txid) {
      extra.reply_markup = {
        inline_keyboard: [[
          { text: '🔍 Посмотреть', url: `https://mempool.space/tx/${txid}` },
        ]]
      };
    }

  } else if (type === 'confirmed') {
    text = [
      '✅ *ТРАНЗАКЦИЯ ПОДТВЕРЖДЕНА!*',
      '━━━━━━━━━━━━━━━━━━',
      txid ? `📋 \`${txid.slice(0,14)}…${txid.slice(-6)}\`` : '',
      `🎯 TurboTX справился 💪`,
      `🕐 ${now} МСК`,
    ].filter(Boolean).join('\n');

    if (txid) {
      extra.reply_markup = {
        inline_keyboard: [[
          { text: '🔍 Блок Explorer', url: `https://mempool.space/tx/${txid}` },
        ]]
      };
    }

  } else {
    return res.status(400).json({ ok:false, error:'Unknown type' });
  }

  const ok = await tgSend(token, chatId, text, extra);
  return res.status(200).json({ ok });
}
