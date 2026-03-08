// ══════════════════════════════════════════════════════════════
//  TurboTX v5 ★ ULTIMATE ★  —  /api/price.js
//  Vercel Serverless · Node.js 20
//
//  GET /api/price
//
//  ✦ Реальная загрузка мемпула → sat/vB
//  ✦ Цена BTC из 3 источников (race)
//  ✦ Динамическая цена $3–$18 по 5 тирам
//  ✦ Cache-Control 3 мин (CDN Vercel)
//  ✦ Полная инфа для UI: emoji, text, tiers, congestion
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 10 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TIERS = [
  { maxFee:  10, usd:  3, label:'low',      emoji:'🟢', text:'Сеть свободна',        textEn:'Network is clear'     },
  { maxFee:  30, usd:  4, label:'medium',   emoji:'🟡', text:'Умеренная нагрузка',   textEn:'Moderate load'        },
  { maxFee:  60, usd:  7, label:'high',     emoji:'🟠', text:'Высокая нагрузка',     textEn:'High load'            },
  { maxFee: 150, usd: 12, label:'extreme',  emoji:'🔴', text:'Перегрузка сети',      textEn:'Network congested'    },
  { maxFee: Infinity, usd:18, label:'critical', emoji:'🔴', text:'Критическая перегрузка', textEn:'Critical congestion' },
];

async function ft(url, ms = 5000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); clearTimeout(t); return r; }
  catch(e) { clearTimeout(t); throw e; }
}

// Sat/vB из mempool.space → blockstream fallback
async function getFeeRate() {
  try {
    const r = await ft('https://mempool.space/api/v1/fees/recommended', 5000);
    if (r.ok) { const j = await r.json(); return j.fastestFee ?? j.halfHourFee ?? 20; }
  } catch {}
  try {
    const r = await ft('https://blockstream.info/api/fee-estimates', 5000);
    if (r.ok) { const j = await r.json(); return j['1'] ?? j['3'] ?? 20; }
  } catch {}
  return 20;
}

// Также берём размер мемпула для доп. метрик
async function getMempoolStats() {
  try {
    const r = await ft('https://mempool.space/api/mempool', 5000);
    if (r.ok) {
      const j = await r.json();
      return { count: j.count, vsize: j.vsize, totalFee: j.total_fee };
    }
  } catch {}
  return null;
}

// BTC/USD из 3 источников — race
async function getBtcPrice() {
  const sources = [
    { url: 'https://mempool.space/api/v1/prices',                    path: ['USD'] },
    { url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',        path: ['data','amount'] },
    { url: 'https://api.coindesk.com/v1/bpi/currentprice/USD.json',  path: ['bpi','USD','rate_float'] },
  ];
  return new Promise(resolve => {
    let found = false, done = 0;
    for (const { url, path } of sources) {
      ft(url, 5000).then(async r => {
        if (!r.ok) throw 0;
        const j = await r.json();
        const price = parseFloat(path.reduce((o,k) => o?.[k], j));
        if (!found && price > 1000) { found = true; resolve(price); }
      }).catch(()=>{}).finally(() => {
        if (++done === sources.length && !found) resolve(null);
      });
    }
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));

  const [feeRate, btcPrice, mempoolStats] = await Promise.all([
    getFeeRate(),
    getBtcPrice(),
    getMempoolStats(),
  ]);

  const tier = TIERS.find(t => feeRate <= t.maxFee) ?? TIERS.at(-1);
  const usd  = tier.usd;
  const btc  = btcPrice ? parseFloat((usd / btcPrice).toFixed(6)) : null;

  // Cache 3 мин на CDN Vercel
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');

  return res.status(200).json({
    ok: true,
    usd, btc, btcPrice,
    feeRate,
    congestion: tier.label,
    emoji:      tier.emoji,
    text:       tier.text,
    textEn:     tier.textEn,
    mempool:    mempoolStats,
    tiers:      TIERS.map(t => ({
      usd: t.usd, label: t.label,
      emoji: t.emoji, text: t.text, textEn: t.textEn,
      maxFee: t.maxFee === Infinity ? null : t.maxFee,
    })),
    timestamp: Date.now(),
  });
}
