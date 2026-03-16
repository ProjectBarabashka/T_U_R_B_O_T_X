// ══════════════════════════════════════════════════════════════
//  TurboTX v14.1 ★ PAYMENT VERIFY ★  —  /api/verify.js
//
//  ИЗМЕНЕНИЯ v14.1:
//  🔐 CRITICAL: activationToken теперь подписанный HMAC токен,
//     а не сырой PREMIUM_SECRET (перехват в DevTools больше не
//     даёт бесплатный Premium)
//  🔐 Токен содержит txHash + method + exp, проверяется в broadcast.js
//  🐛 incVerify() вызов перенесён до tgNotify (счётчик растёт даже при ошибке TG)
//  🐛 USDT: toCorrectWallet теперь нормализует оба адреса через toLowerCase
//  🐛 base58ToHex: добавлена проверка длины результата
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 20 };

import { CORS, ft, getIp, sj, makeRl, signToken } from './_shared.js';
import { incVerify } from './router.js';

const checkIpLimit = makeRl(10, 3_600_000); // 10 верификаций / час с одного IP

const BTC_WALLET     = process.env.BTC_WALLET  || '';
const USDT_WALLET    = process.env.USDT_WALLET || '';
const PREMIUM_SECRET = process.env.PREMIUM_SECRET || '';

// ─── LIGHTNING VERIFICATION ───────────────────────────────────
async function verifyLightning(paymentHash) {
  if (!/^[a-f0-9]{64}$/i.test(paymentHash))
    return { ok:false, error:'Invalid Lightning payment hash format' };

  try {
    const base = process.env.PRODUCTION_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const r = await ft(`${base}/api/lightning?hash=${paymentHash.toLowerCase()}`, {}, 8000);
    if (!r.ok) return { ok:false, error:`Lightning check failed: ${r.status}` };

    const data = await sj(r);
    if (!data.ok) return { ok:false, error: data.error || 'Lightning check error' };

    if (!data.paid)
      return {
        ok:        false,
        method:    'lightning',
        paid:      false,
        expired:   data.expired || false,
        error:     data.expired ? 'Invoice expired' : 'Invoice not paid yet',
        expiresIn: data.expiresIn || null,
      };

    return {
      ok:         true,
      method:     'lightning',
      paid:       true,
      txHash:     paymentHash,
      paidAmount: `${data.amountSats?.toLocaleString() || '?'} sats`,
      amountSats: data.amountSats,
      confirmed:  true,
      amountOk:   true,
    };
  } catch(e) {
    return { ok:false, error:`Lightning verify error: ${e.message}` };
  }
}

// ─── BTC VERIFICATION ────────────────────────────────────────
async function verifyBtc(txHash, expectedUsd) {
  if (!BTC_WALLET) return { ok:false, error:'BTC wallet not configured' };
  if (!/^[a-fA-F0-9]{64}$/.test(txHash))
    return { ok:false, error:'Invalid BTC tx hash format' };

  let tx = null;
  for (const url of [
    `https://mempool.space/api/tx/${txHash}`,
    `https://blockstream.info/api/tx/${txHash}`,
  ]) {
    try {
      const r = await ft(url, {}, 8000);
      if (r.ok) { tx = await sj(r); break; }
    } catch {}
  }

  if (!tx?.txid) return { ok:false, error:'BTC transaction not found' };

  const out = (tx.vout||[]).find(o => o.scriptpubkey_address === BTC_WALLET);
  if (!out) return { ok:false, error:'Payment not sent to our BTC address' };

  const satsPaid  = out.value || 0;
  const btcPaid   = satsPaid / 1e8;
  const confirmed = tx.status?.confirmed || false;

  let amountOk = true;
  if (expectedUsd) {
    try {
      const pr = await ft('https://mempool.space/api/v1/prices', {}, 5000);
      if (pr.ok) {
        const { USD } = await sj(pr);
        amountOk = btcPaid * USD >= expectedUsd * 0.8;
      }
    } catch {}
  }

  return {
    ok:        amountOk,
    method:    'btc',
    txHash,
    paid:      btcPaid.toFixed(6) + ' BTC',
    satsPaid,
    confirmed,
    inMempool: !confirmed,
    amountOk,
    address:   BTC_WALLET,
  };
}

// ─── USDT TRC-20 VERIFICATION ─────────────────────────────────
async function verifyUsdt(txHash, expectedUsd) {
  if (!USDT_WALLET) return { ok:false, error:'USDT wallet not configured' };

  const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  let txData = null;

  try {
    const tronGridKey = process.env.TRONGRID_KEY || '';
    const headers = tronGridKey ? { 'TRON-PRO-API-KEY': tronGridKey } : {};
    const r = await ft(`https://api.trongrid.io/v1/transactions/${txHash}`, { headers }, 8000);
    if (r.ok) { const d = await sj(r); txData = d?.data?.[0] || null; }
  } catch {}

  if (!txData) {
    try {
      const r = await ft(`https://apilist.tronscanapi.com/api/transaction-info?hash=${txHash}`, {}, 8000);
      if (r.ok) { const d = await sj(r); if (d?.hash) txData = d; }
    } catch {}
  }

  if (!txData) return { ok:false, error:'USDT transaction not found in TRON network' };

  let toAddr = null, amount = null, contractAddr = null;

  if (txData.raw_data?.contract?.[0]?.parameter?.value) {
    const v = txData.raw_data.contract[0].parameter.value;
    toAddr      = v.to_address || v.owner_address;
    contractAddr = v.contract_address;
    amount      = v.call_value || 0;
  }

  if (txData.trc20TransferInfo?.[0]) {
    const t = txData.trc20TransferInfo[0];
    toAddr      = t.to_address || t.to;
    contractAddr = t.contract_address;
    amount      = parseFloat(t.amount_str || t.amount || 0);
  }

  // BUG FIX v14.1: нормализуем оба адреса через toLowerCase
  const isUsdt = contractAddr &&
    contractAddr.toLowerCase() === USDT_CONTRACT.toLowerCase();
  if (!isUsdt) return { ok:false, error:'Not a USDT TRC-20 transaction' };

  // BUG FIX v14.1: нормализуем адреса через base58ToHex + toLowerCase
  const normalize = addr => {
    if (!addr) return '';
    if (addr.startsWith('T')) {
      const hex = base58ToHex(addr);
      return hex.toLowerCase();
    }
    return addr.toLowerCase().replace(/^41/, '');
  };

  const toNorm     = normalize(toAddr);
  const walletNorm = normalize(USDT_WALLET);
  const toCorrectWallet = toAddr === USDT_WALLET ||
    (toNorm && walletNorm && toNorm === walletNorm);

  if (!toCorrectWallet) return { ok:false, error:'Payment not sent to our USDT wallet' };

  const usdtPaid = amount / 1e6;
  const amountOk = !expectedUsd || usdtPaid >= expectedUsd * 0.8;

  return {
    ok:        amountOk,
    method:    'usdt_trc20',
    txHash,
    paid:      usdtPaid.toFixed(2) + ' USDT',
    usdtPaid,
    confirmed: txData.confirmed !== false,
    amountOk,
    address:   USDT_WALLET,
  };
}

// BUG FIX v14.1: base58ToHex с проверкой длины
function base58ToHex(str) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const c of str) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) return str; // не base58
    n = n * BigInt(58) + BigInt(idx);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  // TRON адрес: 21 байт (42 hex) + 4 байта checksum = 25 байт (50 hex)
  if (hex.length >= 50) return hex.slice(0, hex.length - 8);
  return hex;
}

// ─── TELEGRAM ─────────────────────────────────────────────────
async function tgNotify(result, ip) {
  const token = process.env.TG_TOKEN;
  const chat  = process.env.TG_CHAT_ID;
  if (!token || !chat) return;

  const emoji = result.method === 'btc' ? '₿'
    : result.method === 'lightning' ? '⚡' : '💚';
  const methodName = result.method === 'btc' ? 'Bitcoin'
    : result.method === 'lightning' ? 'Lightning Network' : 'USDT TRC-20';

  const text = [
    `${emoji} *ОПЛАТА — TurboTX v14.1*`,
    `━━━━━━━━━━━━━━━━`,
    `${emoji} Сумма: \`${result.paid}\``,
    `💳 Метод: ${methodName}`,
    `🔗 TX: \`${result.txHash?.slice(0,14)}…\``,
    `✅ Статус: ${result.confirmed ? 'Подтверждена' : 'В мемпуле'}`,
    `🌐 IP: \`${ip}\``,
    `🕐 ${new Date().toLocaleString('ru', {timeZone:'Europe/Moscow'})} МСК`,
  ].join('\n');

  const url = result.method === 'btc'
    ? `https://mempool.space/tx/${result.txHash}`
    : result.method === 'lightning'
      ? `https://amboss.space/node`
      : `https://tronscan.org/#/transaction/${result.txHash}`;

  await ft(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat, text, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text:'🔍 Проверить', url }]] },
    }),
  }, 5000).catch(()=>{});
}

// ─── MAIN ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'POST only' });

  const ip = getIp(req);
  if (!checkIpLimit(ip))
    return res.status(429).json({ ok:false, error:'Too many verification attempts. Try later.' });

  const { txHash, expectedUsd, method = 'auto' } = req.body || {};
  if (!txHash || typeof txHash !== 'string' || txHash.length < 20)
    return res.status(400).json({ ok:false, error:'txHash required' });

  let result;
  if (method === 'lightning') {
    result = await verifyLightning(txHash.trim());
  } else if (method === 'btc' || (method === 'auto' && /^[a-fA-F0-9]{64}$/.test(txHash))) {
    result = await verifyBtc(txHash.trim(), expectedUsd);
  } else {
    result = await verifyUsdt(txHash.trim(), expectedUsd);
    if (!result.ok && /^[a-fA-F0-9]{64}$/.test(txHash)) {
      const btcResult = await verifyBtc(txHash.trim(), expectedUsd);
      if (btcResult.ok) result = btcResult;
    }
  }

  if (result.ok) {
    // CRITICAL FIX v14.1: генерируем HMAC токен — НЕ отдаём сырой PREMIUM_SECRET
    const activationToken = PREMIUM_SECRET
      ? signToken({ txHash: result.txHash, method: result.method, plan: 'premium' }, PREMIUM_SECRET)
      : null;

    // BUG FIX v14.1: incVerify() ДО tgNotify — счётчик растёт даже при ошибке TG
    try { incVerify(); } catch {}
    tgNotify(result, ip).catch(()=>{});

    result.activationToken = activationToken;
    result.activatedAt     = Date.now();
    delete result.secret; // на всякий случай — сырой секрет никогда не уходит клиенту
  }

  return res.status(200).json(result);
}
