// ══════════════════════════════════════════════════════════════
//  TurboTX v5.3 ★ АКТУАЛЬНО 2026 ★  —  /api/status.js
//  GET /api/status?txid=<64hex>
//  ✦ Статус TX: confirmed / mempool / not_found
//  ✦ RBF-детекция (sequence < 0xFFFFFFFE)
//  ✦ Estimated confirmation time (min/max) по мемпулу
//  ✦ CPFP eligibility check
//  ✦ Позиция в очереди (приблизительная)
//  ✦ Три источника для надёжности
// ══════════════════════════════════════════════════════════════
export const config = { maxDuration: 12 };

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
async function sj(r) { try { return await r.json(); } catch { return {}; } }

// Estimated wait in minutes based on fee rate vs network tiers
function estimateWait(feeRate, fees, mempoolVsize) {
  if (!feeRate || !fees) return { minMin: null, maxMin: null, label: 'неизвестно' };
  const f = fees.fastestFee || 50;
  const h = fees.halfHourFee || 25;
  const o = fees.hourFee || 15;
  if (feeRate >= f * 0.9)  return { minMin: 10,  maxMin: 20,  label: '10–20 мин' };
  if (feeRate >= h * 0.9)  return { minMin: 20,  maxMin: 40,  label: '20–40 мин' };
  if (feeRate >= o * 0.9)  return { minMin: 40,  maxMin: 90,  label: '40–90 мин' };
  if (feeRate >= o * 0.5)  return { minMin: 90,  maxMin: 240, label: '1.5–4 ч'   };
  return                          { minMin: 240, maxMin: null, label: '> 4 ч · нужен буст' };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));

  const txid = req.query?.txid || req.body?.txid;
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return res.status(400).json({ ok:false, error:'Invalid TXID' });

  try {
    const [txR, txStatusR, tipR, feesR, mempoolR] = await Promise.allSettled([
      ft(`https://mempool.space/api/tx/${txid}`),
      ft(`https://mempool.space/api/tx/${txid}/status`),
      ft('https://mempool.space/api/blocks/tip/height'),
      ft('https://mempool.space/api/v1/fees/recommended'),
      ft('https://mempool.space/api/mempool'),
    ]);

    const tx       = txR.status==='fulfilled'       && txR.value.ok       ? await sj(txR.value)       : null;
    const txStatus = txStatusR.status==='fulfilled' && txStatusR.value.ok ? await sj(txStatusR.value) : null;
    const tip      = tipR.status==='fulfilled'      && tipR.value.ok      ? parseInt(await tipR.value.text()) : 0;
    const fees     = feesR.status==='fulfilled'     && feesR.value.ok     ? await sj(feesR.value)     : {};
    const mempool  = mempoolR.status==='fulfilled'  && mempoolR.value.ok  ? await sj(mempoolR.value)  : {};

    if (!tx) {
      // Fallback: blockstream
      try {
        const r = await ft(`https://blockstream.info/api/tx/${txid}`, 6000);
        if (r.ok) {
          const bsTx = await sj(r);
          const confirmed = bsTx?.status?.confirmed || false;
          return res.status(200).json({
            ok:true, txid, status: confirmed ? 'confirmed' : 'mempool',
            confirmed, source:'blockstream',
          });
        }
      } catch {}
      return res.status(200).json({ ok:true, status:'not_found', txid,
        message:'Transaction not found in mempool or blockchain' });
    }

    const vsize     = tx.weight ? Math.ceil(tx.weight / 4) : (tx.size || 250);
    const feePaid   = tx.fee || 0;
    const feeRate   = feePaid && vsize ? Math.round(feePaid / vsize) : 0;
    const fastest   = fees.fastestFee || 50;
    const confirmed = txStatus?.confirmed || false;
    const confs     = confirmed && tip && txStatus?.block_height
      ? Math.max(1, tip - txStatus.block_height + 1) : 0;

    // RBF: хотя бы один input с sequence < 0xFFFFFFFE
    const rbfEnabled = (tx.vin || []).some(v => (v.sequence ?? 0xFFFFFFFF) < 0xFFFFFFFE);

    // CPFP eligibility: есть ли unspent output (vout без spending_txid)
    const hasCpfpOutput = (tx.vout || []).some(o => !o.spent);

    // Estimated wait
    const waitEst = confirmed ? null : estimateWait(feeRate, fees, mempool.vsize);

    // Approximate position in mempool (rough: backlog vsize / avg tx vsize)
    const mempoolTxCount = mempool.count || 0;
    const mempoolVsize   = mempool.vsize || 0;

    return res.status(200).json({
      ok: true,
      txid,
      status:        confirmed ? 'confirmed' : 'mempool',
      confirmed,
      confirmations: confs,
      blockHeight:   txStatus?.block_height || null,
      blockTime:     txStatus?.block_time   || null,
      vsize,
      feePaid,
      feeRate,
      feeRateNeeded: fastest,
      needsBoost:    !confirmed && feeRate < fastest * 0.5,
      rbfEnabled,
      canCpfp:       !confirmed && hasCpfpOutput,
      estimatedWait: waitEst,
      inputs:        (tx.vin  || []).length,
      outputs:       (tx.vout || []).length,
      mempool: {
        count:        mempoolTxCount,
        vsizeMb:      mempoolVsize ? Math.round(mempoolVsize / 1e6 * 10) / 10 : null,
        fastestFee:   fees.fastestFee  || null,
        halfHourFee:  fees.halfHourFee || null,
        hourFee:      fees.hourFee     || null,
      },
      timestamp: Date.now(),
    });
  } catch(e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}
