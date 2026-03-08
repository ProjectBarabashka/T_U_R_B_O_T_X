// ══════════════════════════════════════════════════════════════
//  TurboTX v5 ★ ULTIMATE ★  —  /api/repeat.js
//  Vercel Serverless · Node.js 20
//
//  POST /api/repeat
//  Body:  { txid, wave: 1-5 }
//
//  Логика волн Premium:
//  Волна 1 → +15 мин  → broadcast всех каналов
//  Волна 2 → +30 мин  → broadcast + проверка CPFP
//  Волна 3 → +60 мин  → broadcast
//  Волна 4 → +120 мин → broadcast
//  Волна 5 → +240 мин → финальная волна
//
//  ✦ Проверяет подтверждение ПЕРЕД broadcast
//  ✦ Внутренний вызов /api/broadcast (нет сетевого hop)
//  ✦ Возвращает nextWaveMs для клиентского таймера
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 30 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Расписание волн в мс от момента оплаты
const WAVES = [
  { wave: 0, delayMs: 0         }, // мгновенно (первый broadcast)
  { wave: 1, delayMs: 15*60000  }, // +15 мин
  { wave: 2, delayMs: 30*60000  }, // +30 мин
  { wave: 3, delayMs: 60*60000  }, // +60 мин
  { wave: 4, delayMs: 120*60000 }, // +120 мин
  { wave: 5, delayMs: 240*60000 }, // +240 мин (конец гарантии)
];

async function ft(url, opts = {}, ms = 10000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    clearTimeout(t); return r;
  } catch(e) { clearTimeout(t); throw e; }
}

// Проверить подтверждение через 2 источника
async function isTxConfirmed(txid) {
  try {
    const r = await ft(`https://mempool.space/api/tx/${txid}/status`, {}, 6000);
    if (r.ok) {
      const s = await r.json();
      if (s.confirmed) return { confirmed: true, blockHeight: s.block_height, blockTime: s.block_time };
    }
  } catch {}
  try {
    // Fallback: blockstream
    const r = await ft(`https://blockstream.info/api/tx/${txid}/status`, {}, 6000);
    if (r.ok) {
      const s = await r.json();
      if (s.confirmed) return { confirmed: true, blockHeight: s.block_height };
    }
  } catch {}
  return { confirmed: false };
}

// Базовый URL сервера для внутренних вызовов
function baseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));

  const { txid, wave = 1 } = req.body || {};
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return res.status(400).json({ ok:false, error:'Invalid TXID' });

  const waveNum = parseInt(wave) || 1;

  // 1. Проверяем — может уже подтверждена?
  const status = await isTxConfirmed(txid);
  if (status.confirmed) {
    return res.status(200).json({
      confirmed: true, broadcasted: false,
      wave: waveNum, nextWaveMs: null,
      blockHeight: status.blockHeight,
      message: `✅ Confirmed at block ${status.blockHeight}`,
    });
  }

  // 2. Не подтверждена — запускаем повторный broadcast
  let broadcastData = null;
  try {
    const r = await ft(`${baseUrl()}/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid, plan: 'premium' }),
    }, 25000);
    broadcastData = await r.json();
  } catch(e) {
    return res.status(500).json({ ok:false, error: e.message });
  }

  // 3. Считаем следующую волну
  const nextWaveIdx = WAVES.findIndex(w => w.wave === waveNum + 1);
  const curWaveIdx  = WAVES.findIndex(w => w.wave === waveNum);
  const nextWaveMs  = (nextWaveIdx !== -1 && curWaveIdx !== -1)
    ? WAVES[nextWaveIdx].delayMs - WAVES[curWaveIdx].delayMs
    : null;

  return res.status(200).json({
    confirmed:      false,
    broadcasted:    true,
    wave:           waveNum,
    nextWave:       nextWaveMs ? waveNum + 1 : null,
    nextWaveMs,
    broadcastSummary: broadcastData?.summary ?? null,
    cpfpNeeded:     broadcastData?.summary?.needCpfp ?? false,
    cpfpFeeNeeded:  broadcastData?.summary?.cpfpFeeNeeded ?? 0,
  });
}
