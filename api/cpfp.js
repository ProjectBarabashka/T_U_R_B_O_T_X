// ══════════════════════════════════════════════════════════════
//  TurboTX v5 ★ NEW ★  —  /api/cpfp.js
//  Vercel Serverless · Node.js 20
//
//  GET /api/cpfp?txid=<64hex>&outputIndex=<n>
//
//  Рассчитывает параметры CPFP (Child-Pays-For-Parent):
//  ✦ Сколько sat/vB не хватает parent TX
//  ✦ Сколько комиссии нужно добавить в child TX
//  ✦ Готовые инструкции для кошелька
//  ✦ Минимальный размер child TX (110 vB)
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 10 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const CHILD_VSIZE = 110; // типичный 1-in-1-out P2WPKH

async function ft(url, ms = 7000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); clearTimeout(t); return r; }
  catch(e) { clearTimeout(t); throw e; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));

  const txid        = req.query?.txid;
  const outputIndex = parseInt(req.query?.outputIndex ?? '0');
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return res.status(400).json({ ok:false, error:'Invalid TXID' });

  try {
    const [txR, feesR] = await Promise.all([
      ft(`https://mempool.space/api/tx/${txid}`),
      ft('https://mempool.space/api/v1/fees/recommended'),
    ]);
    if (!txR.ok) return res.status(404).json({ ok:false, error:'TX not found' });
    const tx   = await txR.json();
    const fees = feesR.ok ? await feesR.json() : {};

    // Уже подтверждена?
    if (tx.status?.confirmed) {
      return res.status(200).json({ ok:true, needed:false, reason:'TX already confirmed' });
    }

    const vsize    = tx.weight ? Math.ceil(tx.weight/4) : (tx.size||250);
    const feePaid  = tx.fee || 0;
    const feeRate  = feePaid && vsize ? Math.round(feePaid/vsize) : 0;
    const target   = fees.fastestFee || 50;

    // Нужная суммарная комиссия для пакета parent+child
    const packageVsize    = vsize + CHILD_VSIZE;
    const totalFeeNeeded  = target * packageVsize;
    const childFeeNeeded  = Math.max(0, totalFeeNeeded - feePaid);
    const childFeeRate    = Math.ceil(childFeeNeeded / CHILD_VSIZE);

    // Получаем выходы TX чтобы указать UTXO для child
    const outputs = tx.vout || [];
    const out     = outputs[outputIndex];

    return res.status(200).json({
      ok: true,
      needed: feeRate < target * 0.9,
      txid,
      parentVsize:   vsize,
      parentFeePaid: feePaid,
      parentFeeRate: feeRate,
      targetFeeRate: target,
      childVsize:    CHILD_VSIZE,
      childFeeNeeded,
      childFeeRate,
      packageFeeRate: target,
      // Инструкция для кошелька
      instructions: {
        ru: `Создай дочернюю транзакцию, потрать выход #${outputIndex} этой TX, установи комиссию ${childFeeRate} sat/vB (≈${childFeeNeeded} sat)`,
        en: `Create a child TX spending output #${outputIndex} of this TX with fee rate ${childFeeRate} sat/vB (≈${childFeeNeeded} sat)`,
      },
      output: out ? {
        index:   outputIndex,
        value:   out.value,
        address: out.scriptpubkey_address || null,
        type:    out.scriptpubkey_type    || null,
      } : null,
      timestamp: Date.now(),
    });
  } catch(e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
}
