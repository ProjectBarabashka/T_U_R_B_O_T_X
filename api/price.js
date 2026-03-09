// ══════════════════════════════════════════════════════════════
//  TurboTX v5.3 ★ АКТУАЛЬНО 2026 ★  —  /api/price.js
//  GET /api/price
//  ✦ 8 уровней цены (более гранулярно)
//  ✦ Estimated confirmation time per tier
//  ✦ Mempool-size weighting (размер мемпула влияет на цену)
//  ✦ BTC/USD из 3 источников (race)
//  ✦ Cache 3 мин на CDN Vercel
// ══════════════════════════════════════════════════════════════
export const config = { maxDuration: 10 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// 8 уровней — от тихой ночи до армагеддона
const TIERS = [
  { maxFee: 5,        usd: 3,  label: 'idle',     emoji: '🟢', text: 'Сеть простаивает',      confMin: 10,  confMax: 15  },
  { maxFee: 12,       usd: 4,  label: 'low',       emoji: '🟢', text: 'Сеть свободна',          confMin: 10,  confMax: 20  },
  { maxFee: 25,       usd: 5,  label: 'moderate',  emoji: '🟡', text: 'Умеренная нагрузка',     confMin: 15,  confMax: 30  },
  { maxFee: 50,       usd: 7,  label: 'medium',    emoji: '🟡', text: 'Средняя нагрузка',       confMin: 20,  confMax: 40  },
  { maxFee: 80,       usd: 10, label: 'high',      emoji: '🟠', text: 'Высокая нагрузка',       confMin: 30,  confMax: 60  },
  { maxFee: 150,      usd: 13, label: 'extreme',   emoji: '🔴', text: 'Перегрузка сети',        confMin: 45,  confMax: 90  },
  { maxFee: 300,      usd: 16, label: 'critical',  emoji: '🔴', text: 'Критическая нагрузка',   confMin: 60,  confMax: 120 },
  { maxFee: Infinity, usd: 18, label: 'emergency', emoji: '🆘', text: 'Экстремальный спрос',    confMin: 90,  confMax: null },
];

async function ft(url, ms = 5000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); clearTimeout(t); return r; }
  catch(e) { clearTimeout(t); throw e; }
}

async function getFeeRate() {
  try { const r = await ft('https://mempool.space/api/v1/fees/recommended', 5000); if (r.ok) { const j = await r.json(); return { rate: j.fastestFee ?? j.halfHourFee ?? 20, fees: j }; } } catch {}
  try { const r = await ft('https://blockstream.info/api/fee-estimates', 5000); if (r.ok) { const j = await r.json(); const rate = j['1'] ?? j['3'] ?? 20; return { rate, fees: { fastestFee: rate, halfHourFee: j['3'], hourFee: j['6'] } }; } } catch {}
  return { rate: 20, fees: {} };
}

async function getMempoolStats() {
  try { const r = await ft('https://mempool.space/api/mempool', 5000); if (r.ok) { const j = await r.json(); return { count: j.count, vsize: j.vsize, totalFee: j.total_fee }; } } catch {}
  return null;
}

async function getBtcPrice() {
  const sources = [
    { url: 'https://mempool.space/api/v1/prices',                          path: ['USD'] },
    { url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',              path: ['data','amount'] },
    { url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',   path: ['price'] },
  ];
  return new Promise(resolve => {
    let found = false, done = 0;
    for (const { url, path } of sources) {
      ft(url, 5000).then(async r => {
        if (!r.ok) throw 0;
        const j = await r.json();
        const price = parseFloat(path.reduce((o,k) => o?.[k], j));
        if (!found && price > 1000) { found = true; resolve(price); }
      }).catch(() => {}).finally(() => { if (++done === sources.length && !found) resolve(null); });
    }
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const [feeData, btcPrice, mempoolStats] = await Promise.all([
    getFeeRate(),
    getBtcPrice(),
    getMempoolStats(),
  ]);

  const feeRate = feeData.rate;
  let tier = TIERS.find(t => feeRate <= t.maxFee) ?? TIERS.at(-1);

  // Mempool-size weighting: если мемпул > 150 МБ — поднимаем на 1 уровень
  if (mempoolStats?.vsize > 150e6) {
    const idx = TIERS.indexOf(tier);
    if (idx < TIERS.length - 1) tier = TIERS[idx + 1];
  }

  const usd = tier.usd;
  const btc = btcPrice ? parseFloat((usd / btcPrice).toFixed(6)) : null;

  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');

  return res.status(200).json({
    ok: true,
    usd, btc, btcPrice,
    feeRate,
    congestion: tier.label,
    emoji:      tier.emoji,
    text:       tier.text,
    confMin:    tier.confMin,
    confMax:    tier.confMax,
    confLabel:  tier.confMax ? `${tier.confMin}–${tier.confMax} мин` : `> ${tier.confMin} мин`,
    fees:       feeData.fees,
    mempool:    mempoolStats,
    tiers: TIERS.map(t => ({
      usd: t.usd, label: t.label, emoji: t.emoji, text: t.text,
      confMin: t.confMin, confMax: t.confMax,
      maxFee: t.maxFee === Infinity ? null : t.maxFee,
    })),
    timestamp: Date.now(),
  });
}
