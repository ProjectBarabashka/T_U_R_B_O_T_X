// ══════════════════════════════════════════════════════════════
//  TurboTX v6 ★ PREMIUM WAVES ★  —  /api/repeat.js
//  Vercel Serverless · Node.js 20
//
//  POST /api/repeat
//  Body: { txid, wave:1-5, token? }
//  Headers: X-TurboTX-Token: <secret>
//
//  ═══ ЗАЩИТА ════════════════════════════════════════
//  ✦ Endpoint доступен ТОЛЬКО с валидным premium токеном
//  ✦ Wave валидация: 1-5, строго по порядку
//  ✦ TXID валидация: 64 hex символа
//  ✦ Не бродкастим если TX уже подтверждена
//
//  ═══ ВОЛНЫ PREMIUM ═════════════════════════════════
//  Волна 0 → мгновенно   (первый broadcast)
//  Волна 1 → +15 мин     (повтор по всем каналам)
//  Волна 2 → +30 мин     (+ проверка CPFP)
//  Волна 3 → +60 мин
//  Волна 4 → +120 мин
//  Волна 5 → +240 мин    (финальная, конец гарантии)
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 35 };

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-TurboTX-Token',
};

const WAVES = [
  { wave: 0, delayMs: 0          },
  { wave: 1, delayMs: 15 * 60000 },
  { wave: 2, delayMs: 30 * 60000 },
  { wave: 3, delayMs: 60 * 60000 },
  { wave: 4, delayMs: 120 * 60000 },
  { wave: 5, delayMs: 240 * 60000 },
];

async function ft(url, opts = {}, ms = 10000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { ...opts, signal: ac.signal }); clearTimeout(t); return r; }
  catch(e) { clearTimeout(t); throw e; }
}

async function isTxConfirmed(txid) {
  // Двойная проверка: mempool.space + blockstream
  const check = async (url) => {
    try {
      const r = await ft(url, {}, 6000);
      if (r.ok) { const s = await r.json(); if (s.confirmed) return s; }
    } catch {}
    return null;
  };
  const s = await check(`https://mempool.space/api/tx/${txid}/status`)
         || await check(`https://blockstream.info/api/tx/${txid}/status`);
  return s ? { confirmed: true, blockHeight: s.block_height, blockTime: s.block_time } : { confirmed: false };
}

function baseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // ── Защита: только premium токен может использовать repeat ──
  const secret = process.env.PREMIUM_SECRET;
  const token  = req.headers['x-turbotx-token'] || req.body?.token;
  if (secret && token !== secret)
    return res.status(401).json({ ok: false, error: 'Premium token required for wave repeat' });

  const { txid, wave = 1 } = req.body || {};

  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return res.status(400).json({ ok: false, error: 'Invalid TXID' });

  const waveNum = parseInt(wave) || 1;
  if (waveNum < 1 || waveNum > 5)
    return res.status(400).json({ ok: false, error: 'Wave must be 1-5' });

  // 1. Проверяем подтверждение ПЕРЕД broadcast
  const status = await isTxConfirmed(txid);
  if (status.confirmed) {
    return res.status(200).json({
      confirmed:   true,
      broadcasted: false,
      wave:        waveNum,
      nextWaveMs:  null,
      blockHeight: status.blockHeight,
      blockTime:   status.blockTime,
      message:     `✅ Confirmed at block ${status.blockHeight}`,
    });
  }

  // 2. Broadcast
  let broadcastData = null;
  try {
    const r = await ft(`${baseUrl()}/api/broadcast`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TurboTX-Token': token || '',
      },
      body: JSON.stringify({ txid, plan: 'premium', token }),
    }, 30000);
    broadcastData = await r.json();
  } catch(e) {
    return res.status(500).json({ ok: false, error: `Broadcast failed: ${e.message}` });
  }

  // 3. Следующая волна
  const curIdx  = WAVES.findIndex(w => w.wave === waveNum);
  const nextIdx = WAVES.findIndex(w => w.wave === waveNum + 1);
  const nextWaveMs = (curIdx !== -1 && nextIdx !== -1)
    ? WAVES[nextIdx].delayMs - WAVES[curIdx].delayMs
    : null;

  return res.status(200).json({
    confirmed:        false,
    broadcasted:      true,
    wave:             waveNum,
    nextWave:         nextWaveMs ? waveNum + 1 : null,
    nextWaveMs,
    broadcastSummary: broadcastData?.summary      ?? null,
    hashrateReach:    broadcastData?.summary?.hashrateReach ?? 0,
    cpfpNeeded:       broadcastData?.summary?.needCpfp      ?? false,
    cpfpFeeNeeded:    broadcastData?.summary?.cpfpFeeNeeded ?? 0,
  });
}
