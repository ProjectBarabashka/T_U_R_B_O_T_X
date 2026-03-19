// ══════════════════════════════════════════════════════════════
//  TurboTX v14.1 ★ LIGHTNING PAYMENT ★  —  /api/lightning.js
//
//  ИЗМЕНЕНИЯ v14.1:
//  🔐 CRITICAL: activationToken теперь HMAC токен, не сырой PREMIUM_SECRET
//  🐛 extractPaymentHash: исправлен парсер bech32 (lastIndexOf → первый '1' после HRP)
//  🐛 GET ?hash=X: возвращал activationToken напрямую из lightning, теперь через signToken
//  🐛 Polling endpoint не проверял expiry правильно при paid=false
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 20 };

import { CORS, ft, getIp, sj, makeRl, signToken } from './_shared.js';
import { incLightning } from './router.js';

const checkRl = makeRl(20, 3_600_000);

// Firebase Realtime Database — хранилище инвойсов между Vercel cold starts
// In-memory fallback для локальной разработки
const _invoices = new Map(); // fallback + кэш
const INVOICE_TTL = 60 * 60_000;

const FIREBASE_DB = process.env.FIREBASE_DB_URL || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || ''; // для write-правил если закрыты

async function fbGet(hash) {
  if (!FIREBASE_DB) return _invoices.get(hash) || null;
  try {
    const url = `${FIREBASE_DB}/lightning/${hash}.json`;
    const r = await ft(url, {}, 4000);
    if (!r.ok) return null;
    const data = await sj(r);
    if (data && data.hash) { _invoices.set(hash, data); return data; }
    return null;
  } catch { return _invoices.get(hash) || null; }
}

async function fbSet(hash, data) {
  _invoices.set(hash, data); // всегда обновляем in-memory кэш
  if (!FIREBASE_DB) return;
  try {
    const url = `${FIREBASE_DB}/lightning/${hash}.json`;
    await ft(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, hash }) }, 5000);
  } catch {}
}

function cleanInvoices() {
  const now = Date.now();
  const PAID_GRACE = 24 * 60 * 60_000;
  for (const [k, v] of _invoices) {
    if (v.paid ? now - v.paidAt > PAID_GRACE : v.expiresAt < now) _invoices.delete(k);
  }
}

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

function usdToSats(usd, btcPrice) {
  if (!btcPrice || btcPrice <= 0) return null;
  return Math.ceil((usd / btcPrice) * 1e8);
}

let _lnurlCache = null, _lnurlCachedAt = 0, _lnurlCachedAddr = '';
const LNURL_CACHE_MS = 5 * 60_000;

async function fetchLnurlPayParams(lightningAddress) {
  const now = Date.now();
  if (_lnurlCache && _lnurlCachedAddr === lightningAddress && now - _lnurlCachedAt < LNURL_CACHE_MS)
    return _lnurlCache;
  const [user, domain] = lightningAddress.split('@');
  if (!user || !domain) throw new Error('Invalid Lightning Address format');
  const url = `https://${domain}/.well-known/lnurlp/${user}`;
  const r = await ft(url, {}, 8000);
  if (!r.ok) throw new Error(`LNURL endpoint error: ${r.status}`);
  const data = await sj(r);
  if (data.tag !== 'payRequest') throw new Error('Not a valid LNURL-pay endpoint');
  if (!data.callback)            throw new Error('No callback URL in LNURL response');
  _lnurlCache = data; _lnurlCachedAt = now; _lnurlCachedAddr = lightningAddress;
  return data;
}

async function requestInvoice(callback, amountMsats, comment) {
  const url = new URL(callback);
  url.searchParams.set('amount', String(amountMsats));
  if (comment) url.searchParams.set('comment', comment.slice(0, 255));
  const r = await ft(url.toString(), {}, 10000);
  if (!r.ok) throw new Error(`Invoice request failed: ${r.status}`);
  const data = await sj(r);
  if (data.status === 'ERROR') throw new Error(data.reason || 'LNURL error');
  if (!data.pr) throw new Error('No invoice (pr) in response');
  return data;
}

// v14.2: надёжный парсер BOLT-11 — исправлен sep + поддержка новых инвойсов без tag=1
function extractPaymentHash(invoice) {
  try {
    const raw = invoice.toLowerCase().trim().replace(/^lightning:/, '');
    // BOLT-11: разделитель — последняя '1' (не первая!) — это стандарт bech32
    const sep = raw.lastIndexOf('1');
    if (sep < 4) return null;
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const dataStr = raw.slice(sep + 1, -6);
    const decoded = [];
    for (const c of dataStr) {
      const v = CHARSET.indexOf(c);
      if (v < 0) return null;
      decoded.push(v);
    }
    function toHex(bits5) {
      let hex = '', acc = 0, cnt = 0;
      for (const b of bits5) {
        acc = (acc << 5) | b; cnt += 5;
        while (cnt >= 8) { cnt -= 8; hex += ((acc >> cnt) & 0xff).toString(16).padStart(2, '0'); }
      }
      return hex;
    }
    let pos = 7; // пропускаем timestamp (35 бит)
    let paymentHash = null, paymentSecret = null;
    while (pos + 3 <= decoded.length) {
      const tag = decoded[pos];
      const len = decoded[pos+1] * 32 + decoded[pos+2];
      pos += 3;
      if (pos + len > decoded.length) break;
      const fieldBits = decoded.slice(pos, pos + len);
      if (tag === 1  && len === 52) paymentHash   = toHex(fieldBits).slice(0, 64);
      if (tag === 16 && len === 52) paymentSecret = toHex(fieldBits).slice(0, 64);
      pos += len;
    }
    const result = paymentHash || paymentSecret;
    return (result && result.length === 64) ? result : null;
  } catch { return null; }
}

function lightningUri(invoice) {
  return `lightning:${invoice.toUpperCase()}`;
}

async function tgNotify(amountSats, amountUsd, txid, ip, type = 'paid') {
  const token = process.env.TG_TOKEN;
  const chat  = process.env.TG_CHAT_ID;
  if (!token || !chat) return;
  const btcAmount = (amountSats / 1e8).toFixed(8);
  const isPaid    = type === 'paid', isCreated = type === 'created';
  const header = isPaid    ? '✅ *ОПЛАТА ПОЛУЧЕНА — TurboTX LN*'
    : isCreated ? '🔔 *Новый LN Invoice — TurboTX*'
    : '⚡ *LN Webhook — TurboTX*';
  const text = [
    header, '━━━━━━━━━━━━━━━━',
    `⚡ ${amountSats.toLocaleString()} sats (~$${amountUsd})`,
    `🔗 ${btcAmount} BTC`,
    txid ? `📋 TXID: \`${txid.slice(0,14)}…\`` : '',
    ip && ip !== 'webhook' ? `🌐 IP: \`${ip}\`` : (isPaid ? '🌐 IP: webhook' : ''),
    `🕐 ${new Date().toLocaleString('ru', {timeZone:'Europe/Moscow'})} МСК`,
  ].filter(Boolean).join('\n');
  await ft(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'Markdown' }),
  }, 5000).catch(()=>{});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));

  const body = req.method === 'POST' ? await readBody(req) : {};
  req.body = body;
  const ip = getIp(req);

  // Webhook от внешнего LN узла (отмечает invoice оплаченным)
  if (req.query?.webhook === '1' || req.body?.webhook === true)
    return handleWebhook(req, res);

  // Debug endpoint
  if (req.method === 'GET' && req.query?.debug === '1') {
    const lightningAddress = process.env.LIGHTNING_ADDRESS;
    const hasTg    = !!(process.env.TG_TOKEN && process.env.TG_CHAT_ID);
    const hasSecret = !!process.env.PREMIUM_SECRET;
    let lnurlOk = false, lnurlErr = '';
    if (lightningAddress) {
      try { const p = await fetchLnurlPayParams(lightningAddress); lnurlOk = !!p.callback; }
      catch(e) { lnurlErr = e.message; }
    }
    let priceOk = false;
    try { priceOk = !!(await getBtcPrice()); } catch {}
    return res.status(200).json({
      ok: true,
      config: {
        LIGHTNING_ADDRESS: lightningAddress ? lightningAddress.replace(/^.+@/, '***@') : 'NOT SET',
        PREMIUM_SECRET: hasSecret ? 'SET (HMAC mode)' : 'NOT SET',
        TG_TOKEN: hasTg ? 'SET' : 'NOT SET',
      },
      checks: { lnurlOk, lnurlErr: lnurlErr || null, priceOk },
    });
  }

  // GET ?hash=X — проверить статус оплаты
  if (req.method === 'GET') {
    const hash = req.query?.hash?.toLowerCase();
    if (!hash || !/^[a-f0-9]{64}$/.test(hash))
      return res.status(400).json({ ok:false, error:'Invalid payment hash' });

    cleanInvoices();
    const inv = await fbGet(hash);
    if (!inv)
      return res.status(404).json({ ok:false, error:'Invoice not found or expired' });

    if (inv.paid) {
      const secret = process.env.PREMIUM_SECRET;
      // BUG FIX v14.1 CRITICAL: возвращаем HMAC токен, не сырой secret
      const activationToken = secret
        ? signToken({ paymentHash: hash, method: 'lightning', plan: 'premium' }, secret)
        : null;
      return res.status(200).json({
        ok: true, paid: true, settled: true,
        amountSats:   inv.amountSats,
        amountUsd:    inv.amountUsd,
        ...(activationToken ? { activationToken } : {}),
        activatedAt:  inv.paidAt,
      });
    }

    // BUG FIX v14.1: корректная проверка expiry при paid=false
    const now = Date.now();
    if (now > inv.expiresAt)
      return res.status(200).json({ ok:true, paid:false, settled:false, expired:true });

    return res.status(200).json({
      ok:        true,
      paid:      false,
      settled:   false,
      amountSats: inv.amountSats,
      expiresIn:  Math.max(0, Math.ceil((inv.expiresAt - now) / 1000)),
    });
  }

  if (req.method !== 'POST')
    return res.status(405).json({ ok:false, error:'GET or POST only' });

  if (!checkRl(ip))
    return res.status(429).json({ ok:false, error:'Too many requests' });

  const lightningAddress = process.env.LIGHTNING_ADDRESS;
  if (!lightningAddress)
    return res.status(503).json({ ok:false, error:'Lightning payments not configured' });

  const { txid, comment } = req.body || {};
  const amountUsd = Number(req.body?.amountUsd);
  if (!amountUsd || isNaN(amountUsd) || amountUsd < 1 || amountUsd > 500)
    return res.status(400).json({ ok:false, error:'amountUsd must be 1-500' });

  try {
    const btcPrice = await getBtcPrice();
    if (!btcPrice)
      return res.status(503).json({ ok:false, error:'Cannot fetch BTC price, try again' });

    const amountSats   = usdToSats(amountUsd, btcPrice);
    const amountMsats  = amountSats * 1000;
    const lnurlParams  = await fetchLnurlPayParams(lightningAddress);

    if (amountMsats < lnurlParams.minSendable)
      return res.status(400).json({ ok:false, error:`Amount too small. Min: ${Math.ceil(lnurlParams.minSendable/1000)} sats` });
    if (amountMsats > lnurlParams.maxSendable)
      return res.status(400).json({ ok:false, error:`Amount too large. Max: ${Math.floor(lnurlParams.maxSendable/1000)} sats` });

    const invoiceComment = comment || (txid ? `TurboTX acceleration ${txid.slice(0,8)}` : 'TurboTX Premium');
    const invoiceData    = await requestInvoice(lnurlParams.callback, amountMsats, invoiceComment);

    const paymentHash = extractPaymentHash(invoiceData.pr);
    if (!paymentHash)
      return res.status(500).json({ ok:false, error:'Could not parse invoice' });

    cleanInvoices();
    const invoiceExpiry = invoiceData.expiry ? invoiceData.expiry * 1000 : INVOICE_TTL;
    const expiresAt     = Date.now() + invoiceExpiry;
    await fbSet(paymentHash, {
      amountSats, amountUsd, txid: txid || null,
      invoice: invoiceData.pr, createdAt: Date.now(), expiresAt, paid: false,
    });

    tgNotify(amountSats, amountUsd, txid, ip, 'created').catch(()=>{});
    try { incLightning(); } catch {}

    return res.status(200).json({
      ok:               true,
      invoice:          invoiceData.pr,
      paymentHash,
      amountSats,
      amountMsats,
      amountUsd,
      btcPrice,
      lightningUri:     lightningUri(invoiceData.pr),
      expiresAt,
      expiresInSeconds: Math.ceil(invoiceExpiry / 1000),
      successAction:    invoiceData.successAction || null,
      note: `Оплатите ${amountSats.toLocaleString()} sats (~$${amountUsd}) через Lightning Network`,
    });
  } catch(e) {
    console.error('[lightning] error:', e.message);
    return res.status(500).json({ ok:false, error:e.message });
  }
}

export async function markInvoicePaid(paymentHash) {
  const hash = paymentHash?.toLowerCase();
  const inv = await fbGet(hash);
  if (!inv) return false;
  if (inv.paid) return true;
  inv.paid   = true;
  inv.paidAt = Date.now();
  await fbSet(hash, inv);
  tgNotify(inv.amountSats, inv.amountUsd, inv.txid || null, 'webhook', 'paid').catch(()=>{});
  return true;
}

async function handleWebhook(req, res) {
  const secret = process.env.PREMIUM_SECRET;
  const { hash, secret: reqSecret } = req.method === 'GET' ? req.query : (req.body || {});
  if (!secret || reqSecret !== secret)
    return res.status(403).json({ ok:false, error:'Forbidden' });
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash))
    return res.status(400).json({ ok:false, error:'Invalid hash' });
  const marked = await markInvoicePaid(hash.toLowerCase());
  return res.status(200).json({ ok:true, marked });
}
