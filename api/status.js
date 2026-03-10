// ══════════════════════════════════════════════════════════════
//  TurboTX v9 ★ TX STATUS ★  —  /api/status.js
//  Vercel Serverless · Node.js 20
//
//  GET /api/status?txid=<64hex>
//
//  ✦ Статус: confirmed / mempool / not_found
//  ✦ Fee rate, vsize, подтверждения
//  ✦ RBF включён?
//  ✦ ETA до подтверждения (по текущей загрузке)
//  ✦ Позиция в очереди мемпула (приблизительно)
//  ✦ confidence score 0-100% — насколько уверены в ETA
//  ✦ accelerationAdvice — точный совет: ускорить / подождать / CPFP / RBF
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

// ETA + confidence score 0-100
// Confidence падает если: сеть нестабильна, TX на грани fee tier, мемпул большой
function estimateEtaFull(feeRate, fees, mpVsizeMB) {
  if (!feeRate || !fees) return { eta: null, etaMinutes: null, confidence: 0 };

  const fastest  = fees.fastestFee    || 50;
  const halfHour = fees.halfHourFee   || 30;
  const hour     = fees.hourFee       || 20;
  const economy  = fees.economyFee    || fees.minimumFee || 5;

  let etaText, etaMinutes, confidence;

  if (feeRate >= fastest) {
    etaText = '~10 мин'; etaMinutes = 10;
    // Высокий confidence только если feeRate заметно выше fastest
    confidence = feeRate >= fastest * 1.2 ? 90 : 70;
  } else if (feeRate >= halfHour) {
    etaText = '~30 мин'; etaMinutes = 30;
    confidence = feeRate >= halfHour * 1.1 ? 75 : 55;
  } else if (feeRate >= hour) {
    etaText = '~1 час'; etaMinutes = 60;
    confidence = 50;
  } else if (feeRate >= economy) {
    etaText = '~несколько часов'; etaMinutes = 240;
    confidence = 30;
  } else {
    etaText = 'неопределённо (очень низкая комиссия)'; etaMinutes = null;
    confidence = 5;
  }

  // Снижаем confidence если мемпул большой (>50MB = затор)
  if (mpVsizeMB > 100) confidence = Math.max(10, confidence - 30);
  else if (mpVsizeMB > 50) confidence = Math.max(15, confidence - 15);

  return { eta: etaText, etaMinutes, confidence };
}

// Точный совет что делать с TX
function accelerationAdvice(feeRate, fees, rbfEnabled, vsize, feePaid) {
  if (!fees) return null;
  const fastest = fees.fastestFee || 50;
  const ratio   = feeRate / fastest;

  if (ratio >= 1.0) return { action: 'wait',   urgency: 'low',    text: 'Комиссия отличная — следующий блок' };
  if (ratio >= 0.8) return { action: 'wait',   urgency: 'low',    text: 'Комиссия хорошая — подтверждение скоро' };
  if (ratio >= 0.5) return { action: 'boost',  urgency: 'medium', text: 'Ускорение ускорит подтверждение на 1-3 часа' };

  // Низкая комиссия — нужны конкретные действия
  const cpfpFee  = Math.max(0, fastest * (vsize + 110) - feePaid);
  const cpfpUrgency = cpfpFee < 10000 ? 'medium' : 'high';

  if (rbfEnabled) {
    return {
      action:   'rbf',
      urgency:  'high',
      text:     `RBF доступен — замените TX с fee rate ${fastest} sat/vB`,
      rbfTargetFeeRate: fastest,
    };
  }
  return {
    action:   'cpfp_or_boost',
    urgency:  cpfpUrgency,
    text:     `Комиссия слишком низкая (${feeRate}/${fastest} sat/vB). CPFP или ускорение TurboTX`,
    cpfpFeeNeeded: cpfpFee,
  };
}

// Simple rate limiter
const _rlMap = new Map();
function checkRl(ip) {
  const now = Date.now(), min = 60_000;
  if (_rlMap.size > 2000) for (const [k,v] of _rlMap) if (v.r < now) _rlMap.delete(k);
  let e = _rlMap.get(ip);
  if (!e || e.r < now) { e = {c:0, r:now+min}; _rlMap.set(ip,e); }
  return ++e.c <= 30; // 30 requests per minute per IP
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!checkRl(ip)) return res.status(429).json({ ok:false, error:'Too many requests' });

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
    const mpVsizeMB  = mp.vsize ? +(mp.vsize / 1e6).toFixed(1) : 0;

    // Позиция в мемпуле (приблизительная)
    let mempoolPosition = null;
    if (!confirmed && mp.count && feeRate > 0) {
      const approxPosition = Math.round((1 - Math.min(feeRate / fastest, 1)) * mp.count);
      mempoolPosition = approxPosition > 0 ? approxPosition : 0;
    }

    const { eta, etaMinutes, confidence } = !confirmed
      ? estimateEtaFull(feeRate, fees, mpVsizeMB)
      : { eta: null, etaMinutes: null, confidence: 100 };

    const advice = !confirmed
      ? accelerationAdvice(feeRate, fees, rbfEnabled, vsize, feePaid)
      : null;

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
      eta,
      etaMinutes,
      confidence,           // 0-100%: насколько уверены в ETA
      accelerationAdvice:   advice,  // {action, urgency, text, ...}
      mempoolPosition,
      mempoolCount: mp.count || null,
      mempoolMB:    mpVsizeMB,
      timestamp: Date.now(),
    });

  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
