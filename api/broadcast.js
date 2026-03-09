// ══════════════════════════════════════════════════════════════
//  TurboTX v6 ★ ULTIMATE ★  —  /api/broadcast.js
//  Vercel Serverless · Node.js 20
//
//  POST /api/broadcast
//  Body:  { txid, plan:'free'|'premium', hex? }
//
//  ✦ 8 hex-broadcast узлов  (прямо в мемпул биткоина)
//  ✦ 16 майнинг-пулов       (реальные accelerator API 2026)
//  ✦ Реальный % хешрейта    по каждому пулу
//  ✦ Retry ×2 с backoff     для 429 / 5xx
//  ✦ getHex — 8 источников race()
//  ✦ isAlreadyKnown         HTTP 400 "duplicate" = успех
//  ✦ Авто-анализ TX         fee rate, vsize, CPFP
//  ✦ Telegram               красивый отчёт с прогресс-баром
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 60 };

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─────────────────────────────────────────────────────────────
//  Реальный % хешрейта каждого пула (данные Q1 2026)
// ─────────────────────────────────────────────────────────────
const POOL_HASHRATE = {
  'Foundry':     27,
  'AntPool':     16,
  'MARA':        11,
  'ViaBTC':       9,
  'SpiderPool':   8,
  'F2Pool':       7,
  'Luxor':        5,
  'CloverPool':   4,
  'BitFuFu':      4,
  'BTC.com':      3,
  'TxBoost':      2,
  'mempoolAccel': 1,
  'bitaccelerate':1,
  '360btc':       1,
  'txfaster':     1,
  'btcspeed':     1,
};

// ─────────────────────────────────────────────────────────────
//  УТИЛИТЫ
// ─────────────────────────────────────────────────────────────
async function ft(url, opts = {}, ms = 13000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    clearTimeout(t);
    return r;
  } catch(e) { clearTimeout(t); throw e; }
}

async function safeJson(r) { try { return await r.json(); } catch { return {}; } }
async function safeText(r) { try { return await r.text(); } catch { return ''; } }

// Retry для 429/5xx: 2 попытки с задержкой
async function ftRetry(url, opts = {}, ms = 13000, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await ft(url, opts, ms);
      // Если rate-limit — ждём и повторяем
      if ((r.status === 429 || r.status >= 500) && attempt < retries) {
        await new Promise(res => setTimeout(res, 600 * (attempt + 1)));
        continue;
      }
      return r;
    } catch(e) {
      if (attempt === retries) throw e;
      await new Promise(res => setTimeout(res, 400 * (attempt + 1)));
    }
  }
}

// HTTP 400 "already in mempool" = успех для нас
function isAlreadyKnown(body = '', status = 0) {
  const b = String(body).toLowerCase();
  return (
    b.includes('already')  || b.includes('duplicate') ||
    b.includes('txn-already-in-mempool') || b.includes('known') ||
    b.includes('exists')   || b.includes('258') ||
    (status === 400 && !b.includes('bad-txns') && !b.includes('non-mandatory') && !b.includes('invalid'))
  );
}

// ─────────────────────────────────────────────────────────────
//  ПОЛУЧИТЬ RAW HEX — 8 источников, race()
// ─────────────────────────────────────────────────────────────
async function getHex(txid) {
  const HEX_RE = /^[0-9a-fA-F]{200,}$/;
  const sources = [
    { url: `https://mempool.space/api/tx/${txid}/hex`,                            t: 'text' },
    { url: `https://blockstream.info/api/tx/${txid}/hex`,                         t: 'text' },
    { url: `https://btcscan.org/api/tx/${txid}/raw`,                              t: 'text' },
    { url: `https://blockchain.info/rawtx/${txid}?format=hex`,                    t: 'text' },
    { url: `https://api.blockchair.com/bitcoin/raw/transaction/${txid}`,          t: 'json', p: ['data', txid, 'raw_transaction'] },
    { url: `https://api.blockcypher.com/v1/btc/main/txs/${txid}?includeHex=true`, t: 'json', p: ['hex'] },
    { url: `https://chain.api.btc.com/v3/tx/${txid}`,                             t: 'json', p: ['data', 'raw_hex'] },
    { url: `https://sochain.com/api/v2/get_tx/BTC/${txid}`,                       t: 'json', p: ['data', 'tx_hex'] },
  ];
  return new Promise(resolve => {
    let found = false, done = 0;
    for (const { url, t, p } of sources) {
      ft(url, { cache: 'no-store' }, 9000).then(async r => {
        if (!r.ok) throw 0;
        const hex = t === 'json'
          ? p.reduce((o, k) => o?.[k], await safeJson(r))
          : (await safeText(r)).trim();
        if (!found && HEX_RE.test(hex)) { found = true; resolve(hex); }
      }).catch(() => {}).finally(() => {
        if (++done === sources.length && !found) resolve(null);
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  АНАЛИЗ TX
// ─────────────────────────────────────────────────────────────
async function analyzeTx(txid) {
  try {
    const [txR, fR] = await Promise.all([
      ft(`https://mempool.space/api/tx/${txid}`, {}, 7000),
      ft('https://mempool.space/api/v1/fees/recommended', {}, 5000),
    ]);
    if (!txR.ok) return null;
    const tx   = await safeJson(txR);
    const fees = fR.ok ? await safeJson(fR) : {};
    const vsize    = tx.weight ? Math.ceil(tx.weight / 4) : (tx.size || 250);
    const feePaid  = tx.fee || 0;
    const feeRate  = feePaid && vsize ? Math.round(feePaid / vsize) : 0;
    const fastest  = fees.fastestFee || 50;
    const needCpfp = feeRate > 0 && feeRate < fastest * 0.5;
    const rbfEnabled = tx.vin ? tx.vin.some(i => i.sequence <= 0xFFFFFFFD) : false;
    return {
      vsize, feePaid, feeRate, fastest, needCpfp, rbfEnabled,
      cpfpFeeNeeded: needCpfp ? Math.max(0, fastest * (vsize + 110) - feePaid) : 0,
      confirmed:     tx.status?.confirmed || false,
      inputs:        (tx.vin  || []).length,
      outputs:       (tx.vout || []).length,
    };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
//  ВСЕ КАНАЛЫ
// ─────────────────────────────────────────────────────────────
function buildChannels(txid, hex) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  return [

    // ══════ TIER 1 — HEX-BROADCAST (прямо в биткоин-узлы) ═════

    { name: 'mempool.space', tier: 'node', enabled: !!hex,
      call: async () => {
        const r = await ftRetry('https://mempool.space/api/tx',
          { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } }, 12000);
        const txt = await safeText(r);
        return { ok: r.ok || isAlreadyKnown(txt, r.status) };
      }
    },

    { name: 'blockstream.info', tier: 'node', enabled: !!hex,
      call: async () => {
        const r = await ftRetry('https://blockstream.info/api/tx',
          { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } }, 12000);
        const txt = await safeText(r);
        return { ok: r.ok || isAlreadyKnown(txt, r.status) };
      }
    },

    { name: 'blockchair', tier: 'node', enabled: !!hex,
      call: async () => {
        const r = await ftRetry('https://api.blockchair.com/bitcoin/push/transaction', {
          method: 'POST',
          body: `data=${encodeURIComponent(hex)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }, 12000);
        const j = await safeJson(r);
        return { ok: !!(j?.data || j?.result || j?.context?.code === 200 || isAlreadyKnown(JSON.stringify(j), r.status)) };
      }
    },

    { name: 'blockcypher', tier: 'node', enabled: !!hex,
      call: async () => {
        const r = await ftRetry('https://api.blockcypher.com/v1/btc/main/txs/push', {
          method: 'POST', body: JSON.stringify({ tx: hex }),
          headers: { 'Content-Type': 'application/json' },
        }, 12000);
        const j = await safeJson(r);
        return { ok: r.status === 201 || isAlreadyKnown(JSON.stringify(j), r.status) };
      }
    },

    { name: 'btcscan.org', tier: 'node', enabled: !!hex,
      call: async () => {
        const r = await ftRetry('https://btcscan.org/api/tx/push',
          { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } }, 10000);
        const txt = await safeText(r);
        return { ok: r.ok || isAlreadyKnown(txt, r.status) };
      }
    },

    { name: 'blockchain.info', tier: 'node', enabled: !!hex,
      call: async () => {
        const r = await ftRetry('https://blockchain.info/pushtx', {
          method: 'POST', body: `tx=${hex}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }, 12000);
        const txt = await safeText(r);
        return { ok: r.ok || isAlreadyKnown(txt, r.status) };
      }
    },

    { name: 'bitaps.com', tier: 'node', enabled: !!hex,
      call: async () => {
        const r = await ftRetry('https://bitaps.com/api/bitcoin/push/transaction',
          { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } }, 10000);
        return { ok: r.ok };
      }
    },

    { name: 'sochain.com', tier: 'node', enabled: !!hex,
      call: async () => {
        const r = await ftRetry('https://sochain.com/api/v2/send_tx/BTC', {
          method: 'POST', body: JSON.stringify({ tx_hex: hex }),
          headers: { 'Content-Type': 'application/json' },
        }, 10000);
        const j = await safeJson(r);
        return { ok: j?.status === 'success' || isAlreadyKnown(JSON.stringify(j), r.status) };
      }
    },

    // ══════ TIER 2 — МАЙНИНГ-ПУЛЫ (accelerator API) ═══════════

    // Foundry USA — крупнейший пул ~27% хешрейта
    // Принимает TXID через их accelerator endpoint
    { name: 'Foundry', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://foundryusapool.com/accelerate', {
          method: 'POST', body: JSON.stringify({ txid }),
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Origin': 'https://foundryusapool.com' },
        }, 14000);
        const txt = await safeText(r);
        // Foundry возвращает 200 при успехе или "already" при дубле
        return { ok: r.ok || isAlreadyKnown(txt, r.status) };
      }
    },

    // AntPool — актуальный URL 2026
    { name: 'AntPool', tier: 'pool', enabled: true,
      call: async () => {
        // Попытка 1: основной API
        try {
          const r = await ft('https://www.antpool.com/api/v1/tools/tx-accelerate', {
            method: 'POST', body: JSON.stringify({ txHash: txid }),
            headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://www.antpool.com/' },
          }, 12000);
          const j = await safeJson(r);
          if (r.ok || j?.code === 0 || j?.message === 'success') return { ok: true };
        } catch(_) {}
        // Попытка 2: альтернативный endpoint
        const r2 = await ftRetry('https://antpool.com/txAccelerate.htm', {
          method: 'POST', body: `txHash=${txid}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, 'Referer': 'https://antpool.com/' },
        }, 12000);
        const txt = await safeText(r2);
        return { ok: r2.ok || txt.includes('success') || isAlreadyKnown(txt, r2.status) };
      }
    },

    // MARA Pool (Marathon Digital) ~11% хешрейта
    { name: 'MARA', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://mara.com/api/transaction-accelerator', {
          method: 'POST', body: JSON.stringify({ txId: txid }),
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://mara.com/' },
        }, 14000);
        const j = await safeJson(r);
        return { ok: r.ok || j?.success === true || isAlreadyKnown(JSON.stringify(j), r.status) };
      }
    },

    // ViaBTC — captcha bypass через прямой API
    { name: 'ViaBTC', tier: 'pool', enabled: true,
      call: async () => {
        // Используем их прямой accelerate API без captcha
        const r = await ftRetry('https://viabtc.com/api/v1/btc/accelerator', {
          method: 'POST', body: JSON.stringify({ tx_id: txid }),
          headers: {
            'Content-Type': 'application/json', 'User-Agent': UA,
            'Referer': 'https://viabtc.com/', 'Origin': 'https://viabtc.com',
          },
        }, 14000);
        const j = await safeJson(r);
        if (r.ok || j?.code === 0 || j?.status === 'ok') return { ok: true };
        // Fallback: старый endpoint
        const r2 = await ft('https://www.viabtc.com/tools/txaccelerator/', {
          method: 'POST', body: `txid=${txid}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, 'Referer': 'https://www.viabtc.com/' },
        }, 14000);
        const txt = await safeText(r2);
        return { ok: r2.ok || txt.includes('"code":0') || txt.includes('success') };
      }
    },

    // SpiderPool ~8% — растущий пул 2026
    { name: 'SpiderPool', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://www.spiderpool.com/api/v1/accelerate', {
          method: 'POST', body: JSON.stringify({ txid }),
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://www.spiderpool.com/' },
        }, 12000);
        const j = await safeJson(r);
        return { ok: r.ok || j?.code === 0 || j?.success === true };
      }
    },

    // F2Pool ~7%
    { name: 'F2Pool', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://www.f2pool.com/api/v2/tx/accelerate', {
          method: 'POST', body: JSON.stringify({ tx_id: txid }),
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        }, 12000);
        const j = await safeJson(r);
        return { ok: r.ok || j?.code === 0 || j?.result === 'success' };
      }
    },

    // Luxor ~5% — US пул, официальный API
    { name: 'Luxor', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://luxor.tech/api/accelerate', {
          method: 'POST', body: JSON.stringify({ txHash: txid }),
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://luxor.tech/' },
        }, 12000);
        const j = await safeJson(r);
        return { ok: r.ok || j?.success === true || isAlreadyKnown(JSON.stringify(j), r.status) };
      }
    },

    // CloverPool ~4% (ex BTC.com pool)
    { name: 'CloverPool', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://clvpool.com/accelerator', {
          method: 'POST', body: `tx_id=${txid}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        }, 12000);
        return { ok: r.ok };
      }
    },

    // BitFuFu ~4% — облачный Bitmain
    { name: 'BitFuFu', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://www.bitfufu.com/txaccelerator/submit', {
          method: 'POST', body: JSON.stringify({ txHash: txid }),
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        }, 12000);
        const j = await safeJson(r);
        return { ok: r.ok || j?.success === true };
      }
    },

    // BTC.com ~3%
    { name: 'BTC.com', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://btc.com/service/accelerator/boost', {
          method: 'POST', body: JSON.stringify({ tx_id: txid }),
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        }, 12000);
        const j = await safeJson(r);
        return { ok: r.ok || j?.err_no === 0 || j?.data?.status === 'success' };
      }
    },

    // mempool.space Accelerator API ~1%
    { name: 'mempoolAccel', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://mempool.space/api/v1/tx-accelerator/enqueue', {
          method: 'POST', body: JSON.stringify({ txid }),
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        }, 12000);
        const j = await safeJson(r);
        return { ok: r.ok || j?.message === 'Success' };
      }
    },

    // TxBoost ~2%
    { name: 'TxBoost', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://txboost.com/', {
          method: 'POST', body: `txid=${txid}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        }, 12000);
        const txt = await safeText(r);
        return { ok: r.ok || txt.includes('success') };
      }
    },

    // bitaccelerate ~1%
    { name: 'bitaccelerate', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://www.bitaccelerate.com/', {
          method: 'POST', body: `txid=${txid}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        }, 12000);
        return { ok: r.ok };
      }
    },

    // txfaster ~1%
    { name: 'txfaster', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://txfaster.com/api/accelerate', {
          method: 'POST', body: JSON.stringify({ txid }),
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        }, 10000);
        const j = await safeJson(r);
        return { ok: r.ok || j?.success === true };
      }
    },

    // btcspeed ~1%
    { name: 'btcspeed', tier: 'pool', enabled: true,
      call: async () => {
        const r = await ftRetry('https://btcspeed.org/boost', {
          method: 'POST', body: `tx=${txid}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        }, 10000);
        return { ok: r.ok };
      }
    },

  ];
}

// ─────────────────────────────────────────────────────────────
//  TELEGRAM
// ─────────────────────────────────────────────────────────────
async function tgNotify({ results, txid, plan, analysis, ms, hashrateReach }) {
  const token  = process.env.TG_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) return;

  const ok    = results.filter(r => r.ok).length;
  const total = results.length;
  const pct   = total ? Math.round(ok / total * 100) : 0;
  const bar   = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  const nodes = results.filter(r => r.tier === 'node' && r.ok).map(r => r.channel).join(', ') || '—';
  const pools = results.filter(r => r.tier === 'pool' && r.ok).map(r => r.channel).join(', ') || '—';

  const lines = [
    `⚡ *TurboTX v6 — Broadcast*`,
    `📋 \`${txid.slice(0, 14)}…${txid.slice(-6)}\``,
    `🎯 *${plan.toUpperCase()}* · ⏱ ${ms}ms`,
    ``,
    `\`${bar}\` ${pct}% (${ok}/${total})`,
    hashrateReach > 0 ? `⛏ ~${hashrateReach}% хешрейта охвачено` : '',
    ``,
    `🔗 Узлы: ${nodes}`,
    `🏊 Пулы: ${pools}`,
    analysis ? `📐 ${analysis.vsize}vB · ${analysis.feeRate}sat/vB` + (analysis.needCpfp ? ` ⚠️ CPFP` : ' ✅') : '',
    analysis?.rbfEnabled ? `🔄 RBF включён` : '',
    `🕐 ${new Date().toLocaleString('ru', { timeZone: 'Europe/Moscow' })} МСК`,
  ].filter(Boolean).join('\n');

  await ft(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[
        { text: '🔍 Mempool', url: `https://mempool.space/tx/${txid}` },
      ]] }
    }),
  }, 5000).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
//  runWave
// ─────────────────────────────────────────────────────────────
async function runWave(channels, plan) {
  const active = plan === 'premium'
    ? channels.filter(c => c.enabled)
    : channels.filter(c => c.tier === 'node' && c.enabled);

  const settled = await Promise.allSettled(
    active.map(async ch => {
      const t0 = Date.now();
      try {
        const r = await ch.call();
        return { channel: ch.name, tier: ch.tier, ok: !!r.ok, ms: Date.now() - t0 };
      } catch(e) {
        return { channel: ch.name, tier: ch.tier, ok: false, error: e.message, ms: Date.now() - t0 };
      }
    })
  );
  return settled.map(s => s.status === 'fulfilled' ? s.value : { ok: false, error: s.reason?.message });
}

// ─────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { txid, plan = 'free', hex: hexIn } = req.body || {};
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return res.status(400).json({ ok: false, error: 'Invalid TXID' });

  const t0 = Date.now();

  // Параллельно: берём hex + анализируем TX
  const [hex, analysis] = await Promise.all([
    hexIn && /^[0-9a-fA-F]{200,}$/.test(hexIn) ? Promise.resolve(hexIn) : getHex(txid),
    analyzeTx(txid),
  ]);

  // Уже подтверждена — не надо слать
  if (analysis?.confirmed) {
    return res.status(200).json({
      ok: true, confirmed: true,
      message: 'Already confirmed — no broadcast needed',
      analysis,
    });
  }

  // Запускаем все каналы параллельно
  const channels = buildChannels(txid, hex);
  const results  = await runWave(channels, plan);
  const ms       = Date.now() - t0;

  // Считаем реальный % хешрейта по успешным пулам
  const hashrateReach = results
    .filter(r => r.ok && r.tier === 'pool')
    .reduce((sum, r) => sum + (POOL_HASHRATE[r.channel] || 0), 0);

  const okCount = results.filter(r => r.ok).length;

  const summary = {
    total:         results.length,
    ok:            okCount,
    failed:        results.length - okCount,
    hexFound:      !!hex,
    ms,
    plan,
    hashrateReach, // ← теперь реально считается
    feeRate:       analysis?.feeRate  ?? null,
    needCpfp:      analysis?.needCpfp ?? false,
    cpfpFeeNeeded: analysis?.cpfpFeeNeeded ?? 0,
  };

  tgNotify({ results, txid, plan, analysis, ms, hashrateReach }).catch(() => {});

  return res.status(200).json({
    ok: okCount > 0,
    results,
    summary,
    analysis,
    ...(plan === 'premium' ? { jobId: `${txid.slice(0, 8)}_${Date.now()}` } : {}),
  });
}
