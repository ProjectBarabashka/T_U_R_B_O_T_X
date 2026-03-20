// ══════════════════════════════════════════════════════════════
//  TurboTX v14.2 — client-api.js
//
//  ИЗМЕНЕНИЯ v14.2:
//  🔧 CRITICAL FIX: Волны переписаны с нуля.
//     Старая система: 10× setTimeout → умирали при закрытии вкладки.
//     Новая система: setInterval (2 мин) + localStorage — волны
//     выживают после закрытия/обновления вкладки, автоматически
//     восстанавливаются при возврате пользователя.
//  🔧 CRITICAL FIX: checkLightningPayment — теперь корректно
//     обрабатывает notFound (инвойс не найден из-за cold start
//     Vercel) без крашей в консоли.
//  🆕 recoverPendingWaves() — вызывается при DOMContentLoaded,
//     подхватывает незаконченные волны из localStorage.
//  🆕 visibilitychange listener — мгновенно запускает просроченные
//     волны когда пользователь возвращается во вкладку.
// ══════════════════════════════════════════════════════════════

const _API = ''; // тот же origin (acelerat.vercel.app)

// ─── WAVE STATE PERSISTENCE ───────────────────────────────────
// Волны хранятся в localStorage → выживают между сессиями браузера
const WAVE_KEY_PREFIX   = 'ttx_wave_v2_';
// Интервалы ДОЛЖНЫ совпадать с repeat.js BASE_INTERVALS (критично!)
const WAVE_MINS         = [15, 15, 30, 60, 120, 120, 120, 120, 180, 180];
const MAX_WAVES         = WAVE_MINS.length; // 10 волн
// Интервал проверки: каждые 2 минуты
const CHECK_INTERVAL_MS = 2 * 60_000;
// TTL хранилища: 3 дня
const WAVE_JOB_TTL_MS   = 3 * 24 * 3600 * 1000;

function _waveKey(txid) { return WAVE_KEY_PREFIX + txid; }

function saveWaveState(txid, state) {
  try { localStorage.setItem(_waveKey(txid), JSON.stringify(state)); } catch {}
}

function loadWaveState(txid) {
  try {
    const raw = localStorage.getItem(_waveKey(txid));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s.startedAt > WAVE_JOB_TTL_MS) {
      localStorage.removeItem(_waveKey(txid));
      return null;
    }
    return s;
  } catch { return null; }
}

function clearWaveState(txid) {
  try { localStorage.removeItem(_waveKey(txid)); } catch {}
}

// ─── ACTIVE REPEATS MAP ───────────────────────────────────────
// txid → intervalId (setInterval, не setTimeout!)
const _activeRepeats = new Map();

// ─── BROADCAST ────────────────────────────────────────────────
async function serverBroadcast(txid, plan, token) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-TurboTX-Token'] = token;
    const r = await fetch(`${_API}/api/broadcast`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ txid, plan }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  } catch(e) {
    console.warn('[TurboTX] Server broadcast failed:', e.message);
    if (typeof freeBroadcast === 'function' && plan !== 'premium')
      return freeBroadcast(txid);
    throw e;
  }
}

// ─── BATCH BROADCAST ──────────────────────────────────────────
async function batchBroadcast(txids, token) {
  if (!Array.isArray(txids) || txids.length === 0) throw new Error('txids array required');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-TurboTX-Token'] = token;
  const r = await fetch(`${_API}/api/broadcast`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ txids, plan: 'premium' }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ─── WAVE CORE ────────────────────────────────────────────────
// Читает localStorage, проверяет время и стреляет волну если пора.
// Вызывается каждые 2 мин через setInterval + при visibility change.
async function checkAndFireWave(txid, onWave) {
  const state = loadWaveState(txid);
  if (!state) { stopServerRepeat(txid); return; }
  if (state.nextWave > MAX_WAVES) {
    stopServerRepeat(txid);
    clearWaveState(txid);
    return;
  }

  const now = Date.now();
  if (now < state.nextWaveAt) return; // ещё не время

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['X-TurboTX-Token'] = state.token;

    const r = await fetch(`${_API}/api/repeat`, {
      method:  'POST',
      headers,
      body: JSON.stringify({
        txid,
        wave:           state.nextWave,
        startedAt:      state.startedAt,
        waveIntervalMs: WAVE_MINS[state.nextWave - 1] * 60_000,
      }),
    });
    const data = await r.json();

    // TX подтверждена — останавливаем всё
    if (data.confirmed) {
      stopServerRepeat(txid);
      clearWaveState(txid);
      console.log(`[TurboTX] TX подтверждена на волне ${state.nextWave}`);
      if (typeof onWave === 'function') onWave({ confirmed: true, wave: state.nextWave, data });
      return;
    }

    const firedWave = state.nextWave;
    const nextWave  = firedWave + 1;

    if (nextWave > MAX_WAVES) {
      stopServerRepeat(txid);
      clearWaveState(txid);
      console.log('[TurboTX] Все 10 волн завершены');
    } else {
      // Используем адаптивный интервал с сервера или базовый
      const msToNext = data.recommendedNextWaveMs || (WAVE_MINS[nextWave - 1] * 60_000);
      saveWaveState(txid, { ...state, nextWave, nextWaveAt: now + msToNext });
      console.log(`[TurboTX] Волна ${firedWave} отправлена. Следующая ${nextWave} через ${Math.round(msToNext / 60000)} мин`);
    }

    if (typeof onWave === 'function') onWave({ confirmed: false, wave: firedWave, data });

  } catch(e) {
    console.warn(`[TurboTX] Ошибка волны ${state.nextWave}:`, e.message);
  }
}

// ─── START SERVER REPEAT ──────────────────────────────────────
// Запускает или продолжает волновую систему для txid.
// Состояние в localStorage → переживает закрытие/перезагрузку вкладки.
function startServerRepeat(txid, token, onWave) {
  stopServerRepeat(txid); // чистим предыдущий interval если был

  // Загружаем существующее состояние или создаём новое
  let state = loadWaveState(txid);
  if (!state) {
    state = {
      txid,
      token:      token || '',
      startedAt:  Date.now(),
      nextWave:   1,
      nextWaveAt: Date.now() + WAVE_MINS[0] * 60_000,
    };
    saveWaveState(txid, state);
    console.log(`[TurboTX] Запланированы ${MAX_WAVES} волн для ${txid.slice(0, 8)}…`);
  } else {
    // Обновляем токен если пришёл новый
    if (token && token !== state.token) {
      state.token = token;
      saveWaveState(txid, state);
    }
    const minsLeft = Math.max(0, Math.round((state.nextWaveAt - Date.now()) / 60_000));
    console.log(`[TurboTX] Wave job восстановлен: волна ${state.nextWave}/${MAX_WAVES}, через ${minsLeft} мин`);
  }

  // Основной таймер: каждые 2 минуты проверяем, не пора ли стрелять волну
  const intervalId = setInterval(() => checkAndFireWave(txid, onWave), CHECK_INTERVAL_MS);
  _activeRepeats.set(txid, intervalId);

  // Если волна уже просрочена — стреляем через секунду, не ждём 2 мин
  if (Date.now() >= state.nextWaveAt) {
    setTimeout(() => checkAndFireWave(txid, onWave), 1000);
  }
}

function stopServerRepeat(txid) {
  const intervalId = _activeRepeats.get(txid);
  if (intervalId !== undefined) {
    clearInterval(intervalId);
    _activeRepeats.delete(txid);
  }
}

// ─── ВОССТАНОВЛЕНИЕ ВОЛН ─────────────────────────────────────
// Вызывается при DOMContentLoaded.
// Подхватывает все незаконченные волновые задания из localStorage
// и возобновляет их. Работает даже после полного закрытия браузера.
function recoverPendingWaves() {
  try {
    const toRecover = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(WAVE_KEY_PREFIX)) continue;
      const txid  = key.slice(WAVE_KEY_PREFIX.length);
      const state = loadWaveState(txid);
      if (state && state.nextWave <= MAX_WAVES && !_activeRepeats.has(txid)) {
        toRecover.push(state);
      }
    }
    if (toRecover.length > 0) {
      console.log(`[TurboTX] Восстанавливаем ${toRecover.length} wave job(s)...`);
      for (const state of toRecover) {
        startServerRepeat(state.txid, state.token, null);
      }
    }
  } catch {}
}

// ─── VISIBILITY CHANGE ────────────────────────────────────────
// Когда пользователь возвращается во вкладку — сразу проверяем
// просроченные волны, не ждём следующего CHECK_INTERVAL.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  for (const txid of _activeRepeats.keys()) {
    const state = loadWaveState(txid);
    if (state && Date.now() >= state.nextWaveAt) {
      checkAndFireWave(txid, null);
    }
  }
});

// ─── DYNAMIC PRICE ────────────────────────────────────────────
let _priceCache     = null;
let _priceFetchedAt = 0;

async function fetchDynamicPrice(forceRefresh = false) {
  const CLIENT_CACHE_MS = 90_000;
  if (!forceRefresh && _priceCache && Date.now() - _priceFetchedAt < CLIENT_CACHE_MS)
    return _priceCache;
  try {
    const cacheBust = '?_t=' + Math.floor(Date.now() / 60000);
    const ac = new AbortController();
    const _t = setTimeout(() => ac.abort(), 6000);
    const r = await fetch(`${_API}/api/price` + cacheBust, {
      cache: 'no-store', signal: ac.signal,
    }).finally(() => clearTimeout(_t));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _priceCache     = await r.json();
    _priceFetchedAt = Date.now();
    applyDynamicPrice(_priceCache);
    if (window._TurboPrice?.apply && _priceCache?.usd > 0)
      window._TurboPrice.apply(_priceCache);
    return _priceCache;
  } catch(e) {
    console.warn('[TurboTX] Price fetch failed:', e.message);
    return _priceCache;
  }
}

function applyDynamicPrice(p) {
  if (!p) return;
  const { usd, btc, sats, emoji, text, congestion, mempoolCongestion, feeRate } = p;

  document.querySelectorAll('[data-price-usd]').forEach(el => { el.textContent = `$${usd}`; });
  document.querySelectorAll('[data-price-btc]').forEach(el => { if (btc) el.textContent = `${btc} BTC`; });
  document.querySelectorAll('[data-price-sats]').forEach(el => { if (sats) el.textContent = `${sats.toLocaleString()} sats`; });

  const netEl = document.getElementById('network-congestion');
  if (netEl) {
    netEl.textContent = `${emoji} ${text} · ${feeRate} sat/vB`;
    netEl.style.color = congestion === 'low'    ? 'var(--g)' :
                        congestion === 'medium' ? 'var(--a)' : '#ff5555';
  }

  const mpEl = document.getElementById('mempool-congestion');
  if (mpEl && mempoolCongestion) {
    const mc    = mempoolCongestion;
    const txStr = mc.txCount != null ? ` · ${mc.txCount.toLocaleString()} TX` : '';
    mpEl.textContent = `${mc.emoji} ${mc.text}${txStr}`;
    mpEl.style.color = mc.level === 'clear' || mc.level === 'low' ? 'var(--g)' :
                       mc.level === 'medium' ? 'var(--a)' : '#ff5555';
  }

  document.querySelectorAll('[data-mempool-count]').forEach(el => {
    if (mempoolCongestion?.txCount != null)
      el.textContent = mempoolCongestion.txCount.toLocaleString();
  });
  document.querySelectorAll('[data-mempool-level]').forEach(el => {
    if (mempoolCongestion?.level) el.dataset.level = mempoolCongestion.level;
  });

  if (btc && typeof selBtc !== 'undefined') {
    selBtc = btc;
    const amtEl = document.getElementById('pay-amount');
    if (amtEl) amtEl.textContent = `${btc} BTC`;
  }
}

// ─── LIGHTNING PAYMENT ────────────────────────────────────────
async function createLightningInvoice(amountUsd, txid) {
  const r = await fetch(`${_API}/api/lightning`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ amountUsd, txid }),
  });
  if (!r.ok) throw new Error(`Lightning invoice failed: ${r.status}`);
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || 'Invoice error');
  return data;
}

// FIX v14.2: не бросаем исключение при 404/500 — возвращаем safe объект.
// Сервер теперь возвращает HTTP 200 + { notFound: true } при cold start.
async function checkLightningPayment(paymentHash) {
  try {
    const r = await fetch(`${_API}/api/lightning?hash=${paymentHash}`);
    const data = await r.json();
    return data;
  } catch(e) {
    console.warn('[TurboTX] LN check error:', e.message);
    return { ok: false, paid: false, error: e.message };
  }
}

// FIX v14.2: останавливаем polling при notFound (cold start → инвойс потерян)
function waitForLightningPayment(paymentHash, onStatus) {
  const MAX_MS  = 60 * 60_000;
  const start   = Date.now();
  let   stopped = false;

  const poll = async () => {
    if (stopped || Date.now() - start > MAX_MS) return;
    try {
      const data = await checkLightningPayment(paymentHash);
      if (typeof onStatus === 'function') onStatus(data);
      if (data.paid)     { stopped = true; return; }
      if (data.expired)  { stopped = true; return; }
      if (data.notFound) { stopped = true; return; } // cold start — инвойс не найден
    } catch(e) {
      console.warn('[TurboTX] LN poll error:', e.message);
    }
    if (!stopped) setTimeout(poll, 3000);
  };

  poll();
  return () => { stopped = true; };
}

// ─── ИНИЦИАЛИЗАЦИЯ ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetchDynamicPrice();
  recoverPendingWaves(); // FIX v14.2: восстанавливаем незаконченные волны
});

// ─── ГЛОБАЛЬНЫЙ API ───────────────────────────────────────────
window._TurboAPI = {
  broadcast:      serverBroadcast,
  batchBroadcast,
  startRepeat:    startServerRepeat,
  stopRepeat:     stopServerRepeat,
  recoverWaves:   recoverPendingWaves,
  fetchPrice:     fetchDynamicPrice,
  applyPrice:     applyDynamicPrice,
  createInvoice:  createLightningInvoice,
  checkPayment:   checkLightningPayment,
  waitPayment:    waitForLightningPayment,
};

console.log('[TurboTX] v14.2 Client API loaded (waves: localStorage+interval, lightning: notFound-safe)');
