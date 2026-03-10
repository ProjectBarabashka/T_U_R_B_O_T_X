// ══════════════════════════════════════════════════════════════
//  TurboTX v9 ★ LIGHTNING PAYMENT ★  —  /api/lightning.js
//  Vercel Serverless · Node.js 20
//
//  POST /api/lightning          — создать invoice
//  Body: { amountUsd, txid? }   — сумма в USD, опционально TXID
//  → { invoice, paymentHash, amountSats, expiresAt, qr }
//
//  GET /api/lightning?hash=<paymentHash>  — проверить оплату
//  → { paid, settled, amountSats }
//
//  Протокол: Lightning Address → LNURL-pay (стандарт LUD-06/LUD-16)
//  Совместим с: Wallet of Satoshi, Phoenix, Breez, Muun, LNbits, любым LN кошельком
//
//  Env:
//    LIGHTNING_ADDRESS — Lightning Address (user@domain.com)
//    PREMIUM_SECRET    — для авторизации внутренних вызовов
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 20 };

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-TurboTX-Token',
};

// ─── RATE LIMITER ─────────────────────────────────────────────
const _rl = new Map();
function checkRl(ip) {
  const now = Date.now(), h = 3_600_000;
  if (_rl.size > 1000) for (const [k,v] of _rl) if (v.r < now) _rl.delete(k);
  let e = _rl.get(ip);
  if (!e || e.r < now) { e = {c:0, r:now+h}; _rl.set(ip, e); }
  return ++e.c <= 20; // 20 invoice/час с одного IP
}

function getIp(req) {
  return req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

// ─── In-memory invoice store ──────────────────────────────────
// Хранит pending invoices с TTL (Vercel instance живёт часами)
// В production стоит заменить на Redis/KV, но для hobby плана хватит
const _invoices = new Map(); // paymentHash → { amountSats, amountUsd, txid, createdAt, expiresAt, paid }
const INVOICE_TTL = 60 * 60_000; // 1 час

function cleanInvoices() {
  const now = Date.now();
  for (const [k, v] of _invoices) if (v.expiresAt < now) _invoices.delete(k);
}

// ─── УТИЛИТЫ ──────────────────────────────────────────────────
async function ft(url, opts = {}, ms = 10000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { ...opts, signal: ac.signal }); clearTimeout(t); return r; }
  catch(e) { clearTimeout(t); throw e; }
}
async function sj(r) { try { return await r.json(); } catch { return {}; } }

// ─── BTC PRICE ────────────────────────────────────────────────
async function getBtcPrice() {
  try {
    const r = await ft('https://mempool.space/api/v1/prices', {}, 5000);
    if (r.ok) { const j = await sj(r); return j.USD || null; }
  } catch {}
  try {
    const r = await ft('https://api.coinbase.com/v2/prices/BTC-USD/spot', {}, 5000);
    if (r.ok) { const j = await sj(r); return parseFloat(j?.data?.amount) || null; }
  } catch {}
  return null;
}

// ─── USD → SATS ───────────────────────────────────────────────
function usdToSats(usd, btcPrice) {
  if (!btcPrice || btcPrice <= 0) return null;
  return Math.ceil((usd / btcPrice) * 1e8);
}

// ─── LNURL-PAY STEP 1: получаем параметры от Lightning Address ─
// Спека LUD-16: https://github.com/lnurl/luds/blob/luds/16.md
async function fetchLnurlPayParams(lightningAddress) {
  const [user, domain] = lightningAddress.split('@');
  if (!user || !domain) throw new Error('Invalid Lightning Address format');

  const url = `https://${domain}/.well-known/lnurlp/${user}`;
  const r = await ft(url, {}, 8000);
  if (!r.ok) throw new Error(`LNURL endpoint error: ${r.status}`);

  const data = await sj(r);
  if (data.tag !== 'payRequest') throw new Error('Not a valid LNURL-pay endpoint');
  if (!data.callback)           throw new Error('No callback URL in LNURL response');

  return data; // { tag, callback, minSendable, maxSendable, metadata, commentAllowed }
}

// ─── LNURL-PAY STEP 2: запрашиваем invoice на конкретную сумму ─
async function requestInvoice(callback, amountMsats, comment) {
  const url = new URL(callback);
  url.searchParams.set('amount', String(amountMsats));
  if (comment) url.searchParams.set('comment', comment.slice(0, 255));

  const r = await ft(url.toString(), {}, 10000);
  if (!r.ok) throw new Error(`Invoice request failed: ${r.status}`);

  const data = await sj(r);
  if (data.status === 'ERROR') throw new Error(data.reason || 'LNURL error');
  if (!data.pr) throw new Error('No invoice (pr) in response');

  return data; // { pr, routes, successAction }
}

// ─── ИЗВЛЕЧЬ PAYMENT HASH из invoice ─────────────────────────
// LN invoice: lnbc<amount>1<...> — payment hash в bytes 12-44 после hrp
// Используем простое декодирование bech32 без внешних зависимостей
function extractPaymentHash(invoice) {
  try {
    // Payment hash — первые 32 байта данных после hrp+separator
    // Простой способ: btoa/atob не подходит, используем bech32 ручками
    const inv = invoice.toLowerCase();
    
    // Алфавит bech32
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    
    // Найти разделитель '1' (последнее вхождение)
    const sep = inv.lastIndexOf('1');
    if (sep < 0) return null;
    
    const data = inv.slice(sep + 1, -6); // убираем checksum (6 символов)
    
    // Конвертируем из 5-bit groups в байты
    const decoded = [];
    for (const c of data) {
      const v = CHARSET.indexOf(c);
      if (v < 0) return null;
      decoded.push(v);
    }
    
    // Пропускаем timestamp (первые 7 пятибитных групп = 35 бит)
    // Далее идут tagged fields
    let pos = 7;
    while (pos < decoded.length - 3) {
      const tag    = decoded[pos];
      const len    = decoded[pos+1] * 32 + decoded[pos+2];
      pos += 3;
      
      if (tag === 1 && len === 52) {
        // payment hash — 52 группы по 5 бит = 260 бит → берём первые 256 (32 байта)
        const hashBits = decoded.slice(pos, pos + 52);
        let hex = '';
        let bits = 0, value = 0;
        for (const b of hashBits) {
          value = (value << 5) | b;
          bits += 5;
          while (bits >= 8) {
            bits -= 8;
            hex += ((value >> bits) & 0xff).toString(16).padStart(2, '0');
          }
        }
        return hex.slice(0, 64); // первые 32 байта = 64 hex символа
      }
      pos += len;
    }
    return null;
  } catch { return null; }
}

// ─── GENERATE SIMPLE QR DATA URL ──────────────────────────────
// Возвращаем просто lightning: URI — фронтенд рендерит QR сам (qrcode.js)
function lightningUri(invoice) {
  return `lightning:${invoice.toUpperCase()}`;
}

// ─── TELEGRAM УВЕДОМЛЕНИЕ ─────────────────────────────────────
async function tgNotify(amountSats, amountUsd, txid, ip) {
  const token = process.env.TG_TOKEN;
  const chat  = process.env.TG_CHAT_ID;
  if (!token || !chat) return;

  const btcAmount = (amountSats / 1e8).toFixed(8);
  const text = [
    '⚡ *ОПЛАТА Lightning — TurboTX v9*',
    '━━━━━━━━━━━━━━━━',
    `⚡ ${amountSats.toLocaleString()} sats (~$${amountUsd})`,
    `🔗 ${btcAmount} BTC`,
    txid ? `📋 TXID: \`${txid.slice(0,14)}…\`` : '',
    `🌐 IP: \`${ip}\``,
    `🕐 ${new Date().toLocaleString('ru', {timeZone:'Europe/Moscow'})} МСК`,
  ].filter(Boolean).join('\n');

  await ft(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id:chat, text, parse_mode:'Markdown' }),
  }, 5000).catch(() => {});
}

// ─── MAIN HANDLER ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));

  const ip = getIp(req);

  // ── GET /api/lightning?hash=<paymentHash> — проверить оплату ──
  if (req.method === 'GET') {
    const hash = req.query?.hash?.toLowerCase();
    if (!hash || !/^[a-f0-9]{64}$/.test(hash))
      return res.status(400).json({ ok:false, error:'Invalid payment hash' });

    cleanInvoices();
    const inv = _invoices.get(hash);
    if (!inv)
      return res.status(404).json({ ok:false, error:'Invoice not found or expired' });

    // Если уже помечен как оплаченный
    if (inv.paid)
      return res.status(200).json({
        ok: true, paid: true, settled: true,
        amountSats: inv.amountSats,
        amountUsd:  inv.amountUsd,
        activationToken: process.env.PREMIUM_SECRET || '',
        activatedAt: inv.paidAt,
      });

    // Проверяем через LNURL successAction callback
    // WoS и большинство провайдеров не имеют публичного API проверки
    // Используем heuristic: invoice истёк → не оплачен
    if (Date.now() > inv.expiresAt)
      return res.status(200).json({ ok:true, paid:false, settled:false, expired:true });

    return res.status(200).json({
      ok: true, paid: false, settled: false,
      amountSats: inv.amountSats,
      expiresIn: Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / 1000)),
    });
  }

  // ── POST /api/lightning — создать invoice ──────────────────
  if (req.method !== 'POST')
    return res.status(405).json({ ok:false, error:'GET or POST only' });

  if (!checkRl(ip))
    return res.status(429).json({ ok:false, error:'Too many requests' });

  const lightningAddress = process.env.LIGHTNING_ADDRESS;
  if (!lightningAddress)
    return res.status(503).json({ ok:false, error:'Lightning payments not configured' });

  const { amountUsd, txid, comment } = req.body || {};
  if (!amountUsd || typeof amountUsd !== 'number' || amountUsd < 1 || amountUsd > 500)
    return res.status(400).json({ ok:false, error:'amountUsd must be 1-500' });

  try {
    // 1. Получаем текущий курс BTC
    const btcPrice = await getBtcPrice();
    if (!btcPrice)
      return res.status(503).json({ ok:false, error:'Cannot fetch BTC price, try again' });

    const amountSats  = usdToSats(amountUsd, btcPrice);
    const amountMsats = amountSats * 1000;

    // 2. Получаем LNURL-pay параметры
    const lnurlParams = await fetchLnurlPayParams(lightningAddress);

    // Проверяем что сумма в пределах допустимого
    if (amountMsats < lnurlParams.minSendable)
      return res.status(400).json({
        ok: false,
        error: `Amount too small. Min: ${Math.ceil(lnurlParams.minSendable/1000)} sats`,
      });
    if (amountMsats > lnurlParams.maxSendable)
      return res.status(400).json({
        ok: false,
        error: `Amount too large. Max: ${Math.floor(lnurlParams.maxSendable/1000)} sats`,
      });

    // 3. Запрашиваем invoice
    const invoiceComment = comment ||
      (txid ? `TurboTX acceleration ${txid.slice(0,8)}` : 'TurboTX Premium');
    const invoiceData = await requestInvoice(
      lnurlParams.callback, amountMsats, invoiceComment
    );

    // 4. Извлекаем payment hash
    const paymentHash = extractPaymentHash(invoiceData.pr);
    if (!paymentHash)
      return res.status(500).json({ ok:false, error:'Could not parse invoice' });

    // 5. Сохраняем в памяти
    cleanInvoices();
    const expiresAt = Date.now() + INVOICE_TTL;
    _invoices.set(paymentHash, {
      amountSats, amountUsd, txid: txid || null,
      invoice: invoiceData.pr,
      createdAt: Date.now(), expiresAt, paid: false,
    });

    // 6. Возвращаем клиенту
    return res.status(200).json({
      ok: true,
      invoice:      invoiceData.pr,          // lnbc... строка для кошелька
      paymentHash,                           // для polling /api/lightning?hash=X
      amountSats,
      amountMsats,
      amountUsd,
      btcPrice,
      lightningUri: lightningUri(invoiceData.pr), // lightning:LNBC... для QR
      expiresAt,
      expiresInSeconds: Math.ceil(INVOICE_TTL / 1000),
      // successAction от провайдера (если есть)
      successAction: invoiceData.successAction || null,
      note: `Оплатите ${amountSats.toLocaleString()} sats (~$${amountUsd}) через Lightning Network`,
    });

  } catch(e) {
    console.error('[lightning] error:', e.message);
    return res.status(500).json({ ok:false, error: e.message });
  }
}

// ─── WEBHOOK — пометить invoice как оплаченный ────────────────
// Вызывается из verify.js когда Lightning оплата подтверждена внешне
// Или вызывается напрямую если у провайдера есть webhook
export function markInvoicePaid(paymentHash) {
  const inv = _invoices.get(paymentHash?.toLowerCase());
  if (!inv) return false;
  inv.paid   = true;
  inv.paidAt = Date.now();
  _invoices.set(paymentHash.toLowerCase(), inv);
  return true;
}
