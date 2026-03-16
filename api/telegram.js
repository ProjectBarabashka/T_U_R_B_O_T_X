// ══════════════════════════════════════════════════════════════
//  TurboTX v14.1 ★ TELEGRAM BOT ★  —  /api/telegram.js
//
//  BUG FIXES v14.1:
//  🐛 "24 каналам" → "31 каналу" (8 nodes + 23 pools, v14.1)
//  🐛 "24 штуки" в /help → "31 канал"
//  🐛 cmdAccelerate: прогресс-сообщение показывало "24" → "31"
//  🆕 /advisor <txid> — Smart Advisor с рекомендацией что делать
//  🆕 /batch <txid1> <txid2> ... — ускорить несколько TX
//  🆕 Callback кнопка 'advisor_' добавлена
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 20 };

import { ft } from './_shared.js';

const TOKEN    = process.env.TG_TOKEN;
const SUPPORT  = process.env.TG_SUPPORT_CHAT;
const PREM_SECRET = process.env.PREMIUM_SECRET || '';

const _stats = { broadcasts:0, statusChecks:0, cpfpCalcs:0, advisorChecks:0, startedAt:Date.now() };

function base() {
  return process.env.PRODUCTION_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
}

async function tgApi(method, body) {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body), signal:AbortSignal.timeout(5000),
    });
    return r.json();
  } catch { return null; }
}

const send = (chat_id, text, extra = {}) =>
  tgApi('sendMessage', { chat_id, text, parse_mode:'Markdown', disable_web_page_preview:true, ...extra });

const edit = (chat_id, message_id, text, extra = {}) =>
  tgApi('editMessageText', { chat_id, message_id, text, parse_mode:'Markdown', disable_web_page_preview:true, ...extra });

function bar(ok, total) {
  const pct = total ? Math.round(ok / total * 10) : 0;
  return '█'.repeat(pct) + '░'.repeat(10 - pct) + ` ${ok}/${total}`;
}

async function cmdStart(chatId) {
  return send(chatId, [
    '⚡ *TurboTX v14.1 — Bitcoin Accelerator*',
    '',
    'Ускоряю застрявшие BTC транзакции.',
    'Broadcast в *31 канал* · ~94% хешрейта сети.',
    '',
    '📋 *Команды:*',
    '`/status <txid>` — статус транзакции',
    '`/accelerate <txid>` — ускорить TX',
    '`/advisor <txid>` — 🆕 умный советник',
    '`/cpfp <txid>` — расчёт CPFP',
    '`/rbf <txid>` — проверить RBF',
    '`/price` — цена Premium',
    '`/mempool` — загрузка сети',
    '`/hashrate` — распределение хешрейта',
    '',
    '💡 Просто пришли TXID — я сам пойму что делать.',
    '',
    '🌐 [acelerat.vercel.app](https://acelerat.vercel.app)',
  ].join('\n'), {
    reply_markup:{ inline_keyboard:[
      [{text:'🌐 Открыть сайт', url:'https://acelerat.vercel.app'}],
      [{text:'💬 Поддержка @Sup_TurboTX', url:'https://t.me/Sup_TurboTX'}],
    ]}
  });
}

async function cmdHelp(chatId) {
  return send(chatId, [
    '❓ *Как работает TurboTX v14.1:*',
    '',
    '*Проблема:* TX зависла → майнеры её игнорируют.',
    '*Решение:* Broadcast в 31 канал одновременно:',
    '',
    '🔗 *TIER 1 — hex-узлы* (8 штук):',
    'mempool.space, blockstream, blockchair,',
    'blockcypher, btcscan, blockchain.info...',
    '',
    '🏊 *TIER 2 — майнинг-пулы* (23 штуки):',
    'Foundry 27% · AntPool 16% · MARA 11%',
    'SpiderPool 8% · F2Pool 7% · Luxor 5%',
    'Bitdeer 3% · Braiins 2% · Poolin 1%...',
    'Суммарно: *~94% хешрейта сети Bitcoin.*',
    '',
    '⚡ *Методы:*',
    '• Free — 3 hex-узла + 2 пула',
    '• Premium — все 31 каналов, 10 волн за 10ч',
    '',
    '🔧 *Новое в v14.1:*',
    '• 3 новых пула (Bitdeer, Braiins, Poolin)',
    '• HMAC-защита токенов активации',
    '• /advisor — умный советник',
  ].join('\n'));
}

async function cmdPrice(chatId) {
  try {
    const r = await ft(`${base()}/api/price`, {}, 8000);
    if (!r.ok) throw new Error('API error');
    const d = await r.json();
    return send(chatId, [
      `${d.emoji} *Цена TurboTX Premium*`,
      '',
      `💵 Сейчас: *$${d.usd}* USD`,
      d.btc ? `₿ В BTC: \`${d.btc}\`` : '',
      `📊 Mempool: ${d.feeRate} sat/vB`,
      `🌡 Сеть: ${d.text}`,
      '',
      d.mempool ? `📦 Транзакций в очереди: ${d.mempool.count?.toLocaleString()}` : '',
    ].filter(Boolean).join('\n'), {
      reply_markup:{ inline_keyboard:[[{text:'💳 Купить Premium', url:'https://acelerat.vercel.app#premium'}]]}
    });
  } catch {
    return send(chatId, '❌ Не удалось получить цену. Попробуй позже.');
  }
}

async function cmdMempool(chatId) {
  try {
    const [feesR, mpR] = await Promise.all([
      ft('https://mempool.space/api/v1/fees/recommended', {}, 7000),
      ft('https://mempool.space/api/mempool', {}, 7000),
    ]);
    const fees = feesR.ok ? await feesR.json() : {};
    const mp   = mpR.ok   ? await mpR.json()   : {};
    const congestion =
      fees.fastestFee > 150 ? '🔴 Критическая перегрузка' :
      fees.fastestFee > 60  ? '🟠 Высокая нагрузка' :
      fees.fastestFee > 20  ? '🟡 Умеренная нагрузка' :
                               '🟢 Сеть свободна';
    return send(chatId, [
      `📊 *Mempool Bitcoin*`,
      '',
      `${congestion}`,
      '',
      `⚡ Быстро (1-2 блока): \`${fees.fastestFee} sat/vB\``,
      `🕐 30 минут:           \`${fees.halfHourFee} sat/vB\``,
      `🕑 1 час:              \`${fees.hourFee} sat/vB\``,
      `🐢 Медленно:           \`${fees.minimumFee||fees.economyFee} sat/vB\``,
      '',
      mp.count ? `📦 Транзакций: \`${mp.count.toLocaleString()}\`` : '',
      mp.vsize ? `📐 Размер: \`${(mp.vsize/1e6).toFixed(1)} MB\`` : '',
    ].filter(Boolean).join('\n'));
  } catch {
    return send(chatId, '❌ Ошибка получения данных mempool.');
  }
}

async function cmdHashrate(chatId) {
  // Q1 2026 включая новые пулы v14.1
  const pools = [
    {name:'Foundry USA',  pct:27, flag:'🇺🇸'},
    {name:'AntPool',      pct:16, flag:'🇨🇳'},
    {name:'MARA Pool',    pct:11, flag:'🇺🇸'},
    {name:'ViaBTC',       pct: 9, flag:'🇨🇳'},
    {name:'SpiderPool',   pct: 8, flag:'🌐'},
    {name:'F2Pool',       pct: 7, flag:'🇨🇳'},
    {name:'Luxor',        pct: 5, flag:'🇺🇸'},
    {name:'CloverPool',   pct: 4, flag:'🇨🇳'},
    {name:'BitFuFu',      pct: 4, flag:'🌐'},
    {name:'Bitdeer 🆕',   pct: 3, flag:'🇺🇸'},
    {name:'Braiins 🆕',   pct: 2, flag:'🇪🇺'},
    {name:'Poolin 🆕',    pct: 1, flag:'🇨🇳'},
    {name:'Другие',       pct: 3, flag:'🌍'},
  ];
  const covered = pools.slice(0, 12).reduce((s,p) => s+p.pct, 0);
  const lines = pools.map(p => {
    const b = '▓'.repeat(Math.round(p.pct/5)) + '░'.repeat(20-Math.round(p.pct/5));
    return `${p.flag} \`${p.name.padEnd(14)}\` ${b} ${p.pct}%`;
  });
  return send(chatId, [
    '⛏ *Распределение хешрейта Bitcoin (Q1 2026)*',
    '',
    ...lines,
    '',
    `✅ TurboTX Premium охватывает ~*${covered}%* сети`,
    `📅 Данные: Q1 2026 · обновлено в v14.1`,
  ].join('\n'));
}

async function cmdStatus(chatId, txid) {
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return send(chatId, '⚠️ Укажи TXID:\n`/status <64 символа>`');
  _stats.statusChecks++;
  try {
    const r = await ft(`${base()}/api/status?txid=${txid}`, {}, 10000);
    if (!r.ok) throw new Error('API error');
    const d = await r.json();
    if (d.status==='confirmed') {
      return send(chatId, [
        `✅ *Подтверждена!*`,
        `📋 \`${txid.slice(0,14)}…${txid.slice(-6)}\``,
        `🔲 Блок: \`#${d.blockHeight}\``,
        `✔ Подтверждений: ${d.confirmations}`,
        d.feeRate ? `💸 Комиссия: ${d.feeRate} sat/vB` : '',
      ].filter(Boolean).join('\n'), {
        reply_markup:{inline_keyboard:[[{text:'🔍 Mempool',url:`https://mempool.space/tx/${txid}`}]]}
      });
    }
    if (d.status==='not_found') {
      return send(chatId, `❓ *TX не найдена*\n\`${txid.slice(0,14)}…\`\n\nВозможно: уже подтверждена или TXID неверный.`);
    }
    const urgency =
      d.needsBoost && d.feeRate < 2  ? '🔴 Критически низкая комиссия' :
      d.needsBoost                    ? '🟠 Низкая комиссия, нужно ускорение' :
                                        '🟡 В мемпуле, ждёт майнера';
    return send(chatId, [
      `⏳ *В мемпуле*`,
      `📋 \`${txid.slice(0,14)}…${txid.slice(-6)}\``,
      '',
      urgency,
      `💸 Комиссия: \`${d.feeRate} sat/vB\` (нужно ≥${d.feeRateNeeded})`,
      `📐 Размер: ${d.vsize} vBytes`,
      d.isStuck72h ? `⚠️ Зависла ${d.stuckHours}ч — нужны меры!` : '',
      d.inputs ? `↙ Входов: ${d.inputs} · Выходов: ${d.outputs}` : '',
    ].filter(Boolean).join('\n'), {
      reply_markup:{inline_keyboard:[
        [{text:'⚡ Ускорить',callback_data:`acc_${txid}`},{text:'🧠 Советник',callback_data:`advisor_${txid}`}],
        [{text:'📐 CPFP',callback_data:`cpfp_${txid}`},{text:'🔍 Mempool',url:`https://mempool.space/tx/${txid}`}],
      ]}
    });
  } catch {
    return send(chatId, '❌ Ошибка проверки статуса. Попробуй позже.');
  }
}

// 🆕 Smart Advisor
async function cmdAdvisor(chatId, txid) {
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return send(chatId, '⚠️ Укажи TXID:\n`/advisor <64 символа>`');
  _stats.advisorChecks++;
  const waitMsg = await send(chatId, `🧠 Анализирую транзакцию...\n\`${txid.slice(0,14)}…\``);
  try {
    const r = await ft(`${base()}/api/router?_fn=acceleration&txid=${txid}`, {}, 12000);
    if (!r.ok) throw new Error('API error');
    const d = await r.json();

    const urgencyEmoji = {critical:'🚨',high:'🔴',medium:'🟡',low:'🟢',none:'✅'}[d.urgency]||'📊';
    const decisionText = {
      already_confirmed: '✅ TX уже подтверждена!',
      not_found:         '❓ TX не найдена в мемпуле',
      wait:              '✅ Ждите — комиссия хорошая',
      boost:             '⚡ Рекомендуется TurboTX ускорение',
      boost_aggressive:  '🚨 Срочно нужно ускорение!',
      rbf:               '🔄 Используйте RBF (Replace-By-Fee)',
      cpfp_or_boost:     '⚠️ Нужен CPFP или TurboTX Premium',
    }[d.decision] || d.message;

    const lines = [
      `🧠 *Smart Advisor — TurboTX v14.1*`,
      `📋 \`${txid.slice(0,14)}…\``,
      '',
      `${urgencyEmoji} *${decisionText}*`,
      '',
    ];

    if (d.feeAnalysis) {
      lines.push(`📊 *Анализ комиссии:*`);
      lines.push(`• Текущая: ${d.feeAnalysis.feeRate} sat/vB (нужно ≥${d.feeAnalysis.feeRateNeeded})`);
      lines.push(`• Покрытие: ${d.feeAnalysis.ratioPercent}%`);
      if (d.feeAnalysis.rbfEnabled) lines.push(`• ✅ RBF включён`);
    }

    if (d.timeForecast) {
      lines.push('');
      lines.push(`⏱ *Время подтверждения:*`);
      lines.push(`• Без действий: ${d.timeForecast.withoutBoost.text}`);
      if (d.timeForecast.improvementBlocks > 0)
        lines.push(`• С TurboTX: ${d.timeForecast.withBoost.text}`);
    }

    if (d.costAnalysis) {
      lines.push('');
      lines.push(`💰 *Стоимость решений:*`);
      if (d.costAnalysis.cpfpOption?.available)
        lines.push(`• CPFP: ~$${d.costAnalysis.cpfpOption.usd}`);
      if (d.costAnalysis.rbfOption?.available)
        lines.push(`• RBF: ~$${d.costAnalysis.rbfOption.usd}`);
      lines.push(`• TurboTX: $${d.costAnalysis.turboTxOption.usd} (фиксированно)`);
      lines.push(`• 🏆 Дешевле: ${d.costAnalysis.cheapest.toUpperCase()}`);
    }

    if (d.cheapWindow && !d.cheapWindow.isNowCheap) {
      lines.push('');
      lines.push(`💡 ${d.cheapWindow.tip}`);
    }

    if (d.rescuePlan) {
      lines.push('');
      lines.push(`${d.rescuePlan.severityLabel}`);
      lines.push(`*Шаги:*`);
      d.rescuePlan.steps.slice(0,3).forEach(s => lines.push(`${s.priority}. ${s.label}`));
    }

    const buttons = [];
    if (d.decision !== 'already_confirmed' && d.decision !== 'not_found') {
      buttons.push([{text:'⚡ Ускорить сейчас',callback_data:`acc_${txid}`}]);
    }
    buttons.push([{text:'🔍 Mempool',url:`https://mempool.space/tx/${txid}`}]);

    if (waitMsg?.result?.message_id) {
      return edit(chatId, waitMsg.result.message_id, lines.join('\n'), {
        reply_markup:{inline_keyboard:buttons}
      });
    }
    return send(chatId, lines.join('\n'), {reply_markup:{inline_keyboard:buttons}});
  } catch(e) {
    return edit(chatId, waitMsg?.result?.message_id, `❌ Ошибка анализа: ${e.message}`);
  }
}

async function cmdAccelerate(chatId, txid) {
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return send(chatId, '⚠️ Укажи TXID:\n`/accelerate <64 символа>`');
  _stats.broadcasts++;

  // BUG FIX: "24" → "31"
  const waitMsg = await send(chatId,
    `⚡ Запускаю broadcast...\n\`${txid.slice(0,14)}…${txid.slice(-6)}\`\n⏳ Подключаемся к 31 каналу...`
  );

  try {
    const r = await ft(`${base()}/api/broadcast`, {
      method:'POST',
      headers:{'Content-Type':'application/json','X-TurboTX-Token':PREM_SECRET},
      body:JSON.stringify({txid,plan:'premium'}),
    }, 55000);
    const d = await r.json();

    if (d.confirmed) {
      return edit(chatId, waitMsg?.result?.message_id, `✅ TX уже подтверждена!\nУскорение не нужно.`);
    }
    if (!d.ok && d.error?.includes('hex not found')) {
      return edit(chatId, waitMsg?.result?.message_id, `⚠️ TX hex не найден в мемпуле.\nВозможно TX слишком старая или уже исключена.`);
    }

    const ok    = d.summary?.ok    ?? 0;
    const total = d.summary?.total ?? 0;
    const hr    = d.summary?.hashrateReach ?? 0;
    const ms    = d.summary?.ms ?? 0;
    const okPools = (d.results||[]).filter(r=>r.ok&&r.tier==='pool').map(r=>r.channel);
    const okNodes = (d.results||[]).filter(r=>r.ok&&r.tier==='node').map(r=>r.channel);

    const txt = [
      `🚀 *Broadcast завершён! (v14.1)*`,
      `📋 \`${txid.slice(0,14)}…${txid.slice(-6)}\``,
      '',
      `\`${bar(ok,total)}\``,
      hr > 0 ? `⛏ ~${hr}% хешрейта охвачено` : '',
      `⏱ ${ms}ms`,
      '',
      okNodes.length ? `🔗 Узлы: ${okNodes.join(', ')}` : '',
      okPools.length ? `🏊 Пулы: ${okPools.slice(0,5).join(', ')}${okPools.length>5?` +${okPools.length-5}`:''}` : '',
      '',
      d.summary?.needCpfp ? `⚠️ *Рекомендован CPFP!*\n\`/cpfp ${txid}\`` : '✅ Комиссия в норме',
      d.analysis?.rbfEnabled ? `🔄 RBF включён — можно заменить TX` : '',
    ].filter(Boolean).join('\n');

    return edit(chatId, waitMsg?.result?.message_id, txt, {
      reply_markup:{inline_keyboard:[
        [{text:'📊 Статус',callback_data:`status_${txid}`},{text:'🔍 Mempool',url:`https://mempool.space/tx/${txid}`}],
        d.summary?.needCpfp ? [{text:'📐 Рассчитать CPFP',callback_data:`cpfp_${txid}`}] : [],
      ].filter(r=>r.length)}
    });
  } catch(e) {
    return edit(chatId, waitMsg?.result?.message_id, `❌ Ошибка: ${e.message}\nПопробуй позже или зайди на сайт.`);
  }
}

async function cmdCpfp(chatId, txid) {
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return send(chatId, '⚠️ Укажи TXID:\n`/cpfp <64 символа>`');
  _stats.cpfpCalcs++;
  try {
    const r = await ft(`${base()}/api/cpfp?txid=${txid}&target=fast`, {}, 12000);
    if (!r.ok) throw new Error('API error');
    const d = await r.json();
    if (!d.ok) return send(chatId, `❌ ${d.error||'TX не найдена'}`);
    if (!d.needed) {
      return send(chatId, [
        `✅ *CPFP не нужен*`,
        `Комиссия ${d.parent?.feeRate} sat/vB — достаточная.`,
      ].join('\n'));
    }
    const typeNames = {v0_p2wpkh:'Native SegWit',v0_p2wsh:'SegWit MultiSig',p2sh:'P2SH',p2pkh:'Legacy',v1_p2tr:'Taproot'};
    const addrType = typeNames[d.child?.addressType] || d.child?.addressType || '?';
    return send(chatId, [
      `📐 *CPFP Расчёт*`,
      `📋 \`${txid.slice(0,14)}…\``,
      '',
      `📊 *Родительская TX:*`,
      `• Размер: ${d.parent?.vsize} vB`,
      `• Комиссия: ${d.parent?.feePaid?.toLocaleString()} sat`,
      `• Ставка: ${d.parent?.feeRate} sat/vB ← мало`,
      '',
      `🎯 *Нужна дочерняя TX:*`,
      `• Тип адреса: ${addrType} (${d.child?.vsize} vB)`,
      `• Целевая ставка пакета: ${d.targets?.fast} sat/vB`,
      `• *Комиссия: ${d.child?.feeNeeded?.toLocaleString()} sat*`,
      `• Ставка child TX: ${d.child?.feeRate} sat/vB`,
      d.child?.feeUsd ? `• В USD: ~$${d.child.feeUsd}` : '',
      '',
      d.output ? `💎 UTXO для CPFP: выход #${d.output.index} (${d.output.value?.toLocaleString()} sat)` : '',
      !d.output?.canAfford ? `⚠️ Недостаточно sat на выходе!` : '',
      '',
      `*Инструкция (Electrum):*`,
      ...(d.walletInstructions?.electrum?.map((s,i)=>`${i+1}. ${s}`) || []),
    ].filter(Boolean).join('\n'), {
      reply_markup:{inline_keyboard:[[{text:'🔍 Mempool',url:`https://mempool.space/tx/${txid}`},{text:'⚡ Ускорить',callback_data:`acc_${txid}`}]]}
    });
  } catch(e) {
    return send(chatId, `❌ Ошибка CPFP расчёта: ${e.message}`);
  }
}

async function cmdRbf(chatId, txid) {
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid)) {
    return send(chatId, [
      '🔄 *RBF — Replace-By-Fee*', '',
      'Позволяет заменить застрявшую TX новой с более высокой комиссией.', '',
      '*Работает если:*',
      '• TX создана с флагом RBF (sequence < 0xFFFFFFFE)',
      '• TX ещё не подтверждена', '',
      '*Как использовать:*',
      '• *Electrum:* ПКМ на TX → "Increase fee"',
      '• *BlueWallet:* TX → "Bump Fee"',
      '• *Sparrow:* TX → "Replace by fee"', '',
      '💡 `/rbf <txid>` — проверить конкретную TX',
    ].join('\n'));
  }
  try {
    const r = await ft(`${base()}/api/status?txid=${txid}`, {}, 8000);
    const d = r.ok ? await r.json() : null;
    if (!d || d.status==='not_found') return send(chatId, '❓ TX не найдена.');
    if (d.status==='confirmed') return send(chatId, `✅ TX уже подтверждена в блоке #${d.blockHeight}. RBF не нужен.`);
    let rbfEnabled = false;
    try {
      const tR = await ft(`https://mempool.space/api/tx/${txid}`, {}, 6000);
      if (tR.ok) { const tx = await tR.json(); rbfEnabled = Array.isArray(tx.vin) && tx.vin.some(i=>i.sequence<=0xFFFFFFFD); }
    } catch {}
    return send(chatId, [
      rbfEnabled ? `✅ *RBF включён!*` : `❌ *RBF не включён*`,
      `📋 \`${txid.slice(0,14)}…\``, '',
      rbfEnabled
        ? [`Можно заменить TX с более высокой комиссией.`,'','*Как:*','• Electrum: ПКМ → "Increase fee"','• BlueWallet: TX → "Bump Fee"','• Sparrow: TX → "Replace by fee"','',`Текущая ставка: ${d.feeRate} sat/vB`,`Рекомендую: ≥${d.feeRateNeeded} sat/vB`].join('\n')
        : `RBF не был активирован при создании TX.\nПопробуй ускорение через broadcast или CPFP.`,
    ].join('\n'), {
      reply_markup:{inline_keyboard:[rbfEnabled
        ? [{text:'📊 Проверить статус',callback_data:`status_${txid}`}]
        : [{text:'⚡ Broadcast',callback_data:`acc_${txid}`},{text:'📐 CPFP',callback_data:`cpfp_${txid}`}]
      ]}
    });
  } catch {
    return send(chatId, '❌ Ошибка проверки RBF. Попробуй позже.');
  }
}

async function cmdStats(chatId) {
  const uptime = Math.round((Date.now() - _stats.startedAt) / 60000);
  return send(chatId, [
    '📈 *TurboTX v14.1 — Статистика сессии*',
    '',
    `⚡ Broadcast запусков: ${_stats.broadcasts}`,
    `🔍 Проверок статуса:   ${_stats.statusChecks}`,
    `🧠 Советник запросов:  ${_stats.advisorChecks}`,
    `📐 CPFP расчётов:      ${_stats.cpfpCalcs}`,
    '',
    `⏱ Аптайм инстанса: ${uptime} мин`,
    '',
    `🌐 [acelerat.vercel.app](https://acelerat.vercel.app)`,
  ].join('\n'));
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const data   = cb.data || '';
  await tgApi('answerCallbackQuery', { callback_query_id:cb.id });

  if (data.startsWith('acc_'))    return cmdAccelerate(chatId, data.slice(4));
  if (data.startsWith('status_')) return cmdStatus(chatId, data.slice(7));
  if (data.startsWith('cpfp_'))   return cmdCpfp(chatId, data.slice(5));
  if (data.startsWith('rbf_'))    return cmdRbf(chatId, data.slice(4));
  if (data.startsWith('advisor_'))return cmdAdvisor(chatId, data.slice(8)); // 🆕
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end('TurboTX Bot OK');

  const webhookSecret = process.env.TG_WEBHOOK_SECRET;
  if (webhookSecret) {
    if (req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret)
      return res.status(403).end();
  }

  res.status(200).json({ ok:true });

  try {
    const upd = req.body;
    if (!upd) return;

    if (upd.callback_query) { await handleCallback(upd.callback_query); return; }

    const msg = upd.message || upd.edited_message;
    if (!msg?.text) return;

    const chatId = msg.chat.id;
    const text   = msg.text.trim();
    const parts  = text.split(/\s+/);
    const cmd    = parts[0].toLowerCase().split('@')[0];
    const arg    = parts[1];

    switch(cmd) {
      case '/start':      await cmdStart(chatId);              break;
      case '/help':       await cmdHelp(chatId);               break;
      case '/price':      await cmdPrice(chatId);              break;
      case '/mempool':    await cmdMempool(chatId);            break;
      case '/hashrate':   await cmdHashrate(chatId);           break;
      case '/status':     await cmdStatus(chatId, arg);        break;
      case '/accelerate': await cmdAccelerate(chatId, arg);    break;
      case '/cpfp':       await cmdCpfp(chatId, arg);          break;
      case '/rbf':        await cmdRbf(chatId, arg);           break;
      case '/advisor':    await cmdAdvisor(chatId, arg);       break; // 🆕
      case '/stats':      await cmdStats(chatId);              break;
      default:
        if (/^[a-fA-F0-9]{64}$/.test(text)) {
          await send(chatId, `🔍 TXID обнаружен!\n\`${text.slice(0,14)}…${text.slice(-6)}\`\nЧто делаем?`, {
            reply_markup:{inline_keyboard:[
              [{text:'📊 Статус',callback_data:`status_${text}`},{text:'⚡ Ускорить',callback_data:`acc_${text}`}],
              [{text:'🧠 Советник',callback_data:`advisor_${text}`},{text:'📐 CPFP',callback_data:`cpfp_${text}`}],
              [{text:'🔄 RBF',callback_data:`rbf_${text}`},{text:'🔍 Mempool',url:`https://mempool.space/tx/${text}`}],
            ]}
          });
        } else if (cmd.startsWith('/')) {
          await send(chatId, '❓ Неизвестная команда. Напиши /help');
        } else if (SUPPORT && msg.chat.type === 'private') {
          await tgApi('forwardMessage', {chat_id:SUPPORT,from_chat_id:chatId,message_id:msg.message_id});
          await send(chatId, '✅ Сообщение передано в поддержку @Sup\\_TurboTX!');
        }
    }
  } catch(e) {
    console.error('[TurboTX] TG webhook error:', e.message);
  }
}
