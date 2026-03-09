// ══════════════════════════════════════════════════════════════
//  TurboTX v6 ★ STATUS ★  —  /api/status.js
//  Vercel Serverless · Node.js 20
//
//  GET /api/status?txid=<64hex>
//
//  ✦ Статус: confirmed / mempool / not_found
//  ✦ Fee rate, vsize, подтверждения
//  ✦ RBF включён?
//  ✦ ETA до подтверждения (по текущей загрузке)
//  ✦ Позиция в очереди мемпула (приблизительно)
//  ✦ Источник: mempool.space + blockstream fallback
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 12 };

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

async function ft(url, ms = 7000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); clearTimeout(t); return r; }
  catch(e) { clearTimeout(t); throw e; }
}

async function safeJson(r) { try { return await r.json(); } catch { return {}; } }

// Примерный ETA до подтверждения в минутах
function estimateEta(feeRate, fees) {
  if (!feeRate || !fees) return null;
  if (feeRate >= (fees.fastestFee || 999)) return '~10 мин';
  if (feeRate >= (fees.halfHourFee || 999)) return '~30 мин';
  if (feeRate >= (fees.hourFee || 999)) return '~1 час';
  if (feeRate >= (fees.economyFee || fees.minimumFee || 1)) return '~несколько часов';
  return 'неопределённо (очень низкая комиссия)';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const txid = req.query?.txid || req.body?.txid;
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return res.status(400).json({ ok: false, error: 'Invalid TXID' });

  try {
    const [txR, txStatusR, tipR, feesR, mpR] = await Promise.allSettled([
      ft(`https://mempool.space/api/tx/${txid}`),
      ft(`https://mempool.space/api/tx/${txid}/status`),
      ft('https://mempool.space/api/blocks/tip/height'),
      ft('https://mempool.space/api/v1/fees/recommended'),
      ft('https://mempool.space/api/mempool'),
    ]);

    const get = s => (s.status === 'fulfilled' && s.value?.ok) ? s.value : null;

    const txResp     = get(txR);
    const statusResp = get(txStatusR);
    const tipResp    = get(tipR);
    const feesResp   = get(feesR);
    const mpResp     = get(mpR);

    let tx = txResp ? await safeJson(txResp) : null;

    // Fallback: blockstream
    if (!tx) {
      try {
        const fb = await ft(`https://blockstream.info/api/tx/${txid}`, 7000);
        if (fb.ok) tx = await safeJson(fb);
      } catch {}
    }

    if (!tx || !tx.txid) {
      return res.status(200).json({
        ok: true, status: 'not_found', txid,
        message: 'Transaction not found in mempool or blockchain',
      });
    }

    const txStatus = statusResp ? await safeJson(statusResp) : null;
    const tip      = tipResp ? parseInt(await tipResp.text()) : 0;
    const fees     = feesResp ? await safeJson(feesResp) : {};
    const mp       = mpResp  ? await safeJson(mpResp)  : {};

    const vsize      = tx.weight ? Math.ceil(tx.weight / 4) : (tx.size || 250);
    const feePaid    = tx.fee || 0;
    const feeRate    = feePaid && vsize ? Math.round(feePaid / vsize) : 0;
    const fastest    = fees.fastestFee || 50;
    const confirmed  = txStatus?.confirmed || tx.status?.confirmed || false;
    const blockH     = txStatus?.block_height || tx.status?.block_height || null;
    const blockT     = txStatus?.block_time   || tx.status?.block_time   || null;
    const confs      = confirmed && tip && blockH ? Math.max(1, tip - blockH + 1) : 0;
    const rbfEnabled = Array.isArray(tx.vin) && tx.vin.some(i => i.sequence <= 0xFFFFFFFD);
    const needsBoost = !confirmed && feeRate > 0 && feeRate < fastest * 0.5;

    // Позиция в мемпуле (приблизительная)
    let mempoolPosition = null;
    if (!confirmed && mp.count && feeRate > 0) {
      // Грубая оценка: % TX с более высокой fee rate
      const approxPosition = Math.round((1 - Math.min(feeRate / fastest, 1)) * mp.count);
      mempoolPosition = approxPosition > 0 ? approxPosition : 0;
    }

    const eta = !confirmed ? estimateEta(feeRate, fees) : null;

    return res.status(200).json({
      ok:           true,
      txid,
      status:       confirmed ? 'confirmed' : 'mempool',
      confirmed,
      confirmations: confs,
      blockHeight:  blockH,
      blockTime:    blockT,
      vsize,
      feePaid,
      feeRate,
      feeRateNeeded: fastest,
      needsBoost,
      rbfEnabled,
      inputs:   (tx.vin  || []).length,
      outputs:  (tx.vout || []).length,
      eta,                    // "~30 мин" / null если подтверждена
      mempoolPosition,        // приблизительная позиция в очереди
      mempoolCount: mp.count || null,
      timestamp: Date.now(),
    });

  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
