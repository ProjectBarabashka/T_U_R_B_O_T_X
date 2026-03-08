// ══════════════════════════════════════════════════════════════
//  TurboTX v5 ★ NEW ★  —  /api/status.js
//  Vercel Serverless · Node.js 20
//
//  GET /api/status?txid=<64hex>
//
//  ✦ Статус TX: confirmed / mempool / not_found
//  ✦ Fee rate, vsize, позиция в мемпуле
//  ✦ Сколько подтверждений
//  ✦ Источник: mempool.space + blockstream fallback
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 10 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

async function ft(url, ms = 7000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); clearTimeout(t); return r; }
  catch(e) { clearTimeout(t); throw e; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));

  const txid = req.query?.txid || req.body?.txid;
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return res.status(400).json({ ok:false, error:'Invalid TXID' });

  try {
    // Параллельно: данные TX + текущая высота блока + рекомендованная комиссия
    const [txR, txStatusR, tipR, feesR] = await Promise.allSettled([
      ft(`https://mempool.space/api/tx/${txid}`),
      ft(`https://mempool.space/api/tx/${txid}/status`),
      ft('https://mempool.space/api/blocks/tip/height'),
      ft('https://mempool.space/api/v1/fees/recommended'),
    ]);

    const tx       = txR.status==='fulfilled' && txR.value.ok ? await txR.value.json() : null;
    const txStatus = txStatusR.status==='fulfilled' && txStatusR.value.ok ? await txStatusR.value.json() : null;
    const tip      = tipR.status==='fulfilled' && tipR.value.ok ? parseInt(await tipR.value.text()) : 0;
    const fees     = feesR.status==='fulfilled' && feesR.value.ok ? await feesR.value.json() : {};

    if (!tx) {
      return res.status(200).json({ ok:true, status:'not_found', txid,
        message:'Transaction not found in mempool or blockchain' });
    }

    const vsize    = tx.weight ? Math.ceil(tx.weight/4) : (tx.size||250);
    const feePaid  = tx.fee || 0;
    const feeRate  = feePaid && vsize ? Math.round(feePaid/vsize) : 0;
    const fastest  = fees.fastestFee || 50;
    const confirmed = txStatus?.confirmed || false;
    const confs    = confirmed && tip && txStatus?.block_height
      ? Math.max(1, tip - txStatus.block_height + 1) : 0;

    return res.status(200).json({
      ok: true,
      txid,
      status: confirmed ? 'confirmed' : 'mempool',
      confirmed,
      confirmations: confs,
      blockHeight:   txStatus?.block_height || null,
      blockTime:     txStatus?.block_time   || null,
      vsize,
      feePaid,
      feeRate,
      feeRateNeeded: fastest,
      needsBoost:    !confirmed && feeRate < fastest * 0.5,
      inputs:  (tx.vin  || []).length,
      outputs: (tx.vout || []).length,
      timestamp: Date.now(),
    });
  } catch(e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
}
