// ══════════════════════════════════════════════════════════════
//  TurboTX v14.2 ★ SERVER-SIDE WAVE CRON ★  —  /api/cron.js
//
//  Волны работают даже когда пользователь закрыл вкладку.
//
//  НАСТРОЙКА (5 минут, бесплатно):
//  ─────────────────────────────────────────────────────────────
//  1. Заходим на https://cron-job.org → Sign Up (бесплатно)
//  2. Create Cronjob:
//       URL:      https://acelerat.vercel.app/api/cron
//       Method:   GET
//       Interval: Every minute
//       Header:   X-Cron-Secret: <значение CRON_SECRET из Vercel env>
//  3. Добавить в Vercel env переменные:
//       CRON_SECRET=любой_длинный_случайный_секрет
//       (FIREBASE_DB_URL, PREMIUM_SECRET уже должны быть)
//  ─────────────────────────────────────────────────────────────
//
//  КАК РАБОТАЕТ:
//  Каждую минуту cron-job.org GET /api/cron
//    → читаем /waves.json из Firebase (активные jobs)
//    → для каждого job где nextWaveAt <= now:
//        вызываем /api/repeat → он делает broadcast + обновляет Firebase
//    → если TX подтверждена или все 10 волн → job.active = false
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 28 };

const FIREBASE_DB  = process.env.FIREBASE_DB_URL || '';
const CRON_SECRET  = process.env.CRON_SECRET || '';
const PROD_URL     = process.env.PRODUCTION_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
const MAX_JOBS_PER_TICK = 5; // ограничение при 30s timeout // обрабатываем не больше 10 TX за один вызов

// ── Fetch с таймаутом ─────────────────────────────────────────
async function ft(url, opts = {}, ms = 10000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

// ── Firebase ──────────────────────────────────────────────────
async function fbGet(path) {
  if (!FIREBASE_DB) return null;
  try {
    const r = await ft(`${FIREBASE_DB}${path}`, {}, 5000);
    if (!r.ok) return null;
    const text = await r.text();
    return text === 'null' ? null : JSON.parse(text);
  } catch { return null; }
}

async function fbSet(path, data) {
  if (!FIREBASE_DB) return;
  try {
    await ft(`${FIREBASE_DB}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 4000);
  } catch {}
}

async function fbPatch(path, data) {
  if (!FIREBASE_DB) return;
  try {
    await ft(`${FIREBASE_DB}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 4000);
  } catch {}
}

// ── Базовые интервалы волн (совпадают с repeat.js BASE_INTERVALS) ──
const WAVE_INTERVALS_MS = [
  15 * 60000,   // волна 1
  15 * 60000,   // волна 2
  30 * 60000,   // волна 3
  60 * 60000,   // волна 4
  120 * 60000,  // волна 5
  120 * 60000,  // волна 6
  120 * 60000,  // волна 7
  120 * 60000,  // волна 8
  180 * 60000,  // волна 9
  180 * 60000,  // волна 10
];
const MAX_WAVES = WAVE_INTERVALS_MS.length; // 10

// ── Получить активные jobs из Firebase ───────────────────────
async function getActiveJobs() {
  // shallow=true возвращает только ключи {txid: true, ...}
  const keys = await fbGet('/waves.json?shallow=true');
  if (!keys || typeof keys !== 'object') return [];

  const now   = Date.now();
  const txids = Object.keys(keys).slice(0, MAX_JOBS_PER_TICK * 2);

  // Читаем все jobs параллельно
  const fetched = await Promise.allSettled(
    txids.map(txid => fbGet(`/waves/${txid}.json`))
  );

  const due = [];
  for (let i = 0; i < txids.length; i++) {
    const r = fetched[i];
    if (r.status !== 'fulfilled' || !r.value) continue;
    const job = { ...r.value, txid: r.value.txid || txids[i] };

    // Пропускаем завершённые
    if (job.active === false) continue;
    if (!job.startedAt) continue;

    // Удаляем jobs старше 4 дней (startedAt должен быть в мс, проверяем)
    const startedAtMs = job.startedAt > 1e12 ? job.startedAt : job.startedAt * 1000;
    if (now - startedAtMs > 4 * 24 * 3600000) {
      await fbPatch(`/waves/${job.txid}.json`, { active: false });
      continue;
    }

    // Пропускаем если ещё не время (с буфером 10 сек на cold start)
    if (job.nextWaveAt && job.nextWaveAt > now + 10000) continue;

    due.push(job);
    if (due.length >= MAX_JOBS_PER_TICK) break;
  }

  return due;
}

// ── Выполнить одну волну ──────────────────────────────────────
async function fireWave(job) {
  const { txid, wavesDone = 0, startedAt } = job;
  const waveNum = (wavesDone || 0) + 1;

  if (waveNum > MAX_WAVES) {
    await fbPatch(`/waves/${txid}.json`, { active: false });
    return { txid, skipped: true, reason: 'all_waves_done' };
  }

  if (!PROD_URL) {
    // FIX: откладываем на 30 мин чтобы не крутиться в цикле при отсутствии конфига
    await fbPatch(`/waves/${txid}.json`, { nextWaveAt: Date.now() + 30 * 60000 });
    return { txid, ok: false, error: 'PRODUCTION_URL not set' };
  }

  const token = process.env.PREMIUM_SECRET || '';

  try {
    const r = await ft(`${PROD_URL}/api/repeat`, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-TurboTX-Token': token,
        'X-Cron-Source':   'cron-job.org',
      },
      body: JSON.stringify({
        txid,
        wave:      waveNum,
        startedAt: startedAt,
      }),
    }, 22000); // 22s — укладываемся в 30s лимит cron-job.org

    if (!r.ok) {
      // repeat вернул ошибку — обновляем nextWaveAt чтобы повторить через 5 мин
      await fbPatch(`/waves/${txid}.json`, {
        nextWaveAt: Date.now() + 5 * 60000,
        lastError:  `HTTP ${r.status}`,
        lastErrorAt: Date.now(),
      });
      return { txid, ok: false, wave: waveNum, error: `repeat HTTP ${r.status}` };
    }

    const data = await r.json();

    // TX подтверждена → завершаем job
    if (data.confirmed) {
      await fbPatch(`/waves/${txid}.json`, {
        active:      false,
        confirmedAt: Date.now(),
        wavesDone:   waveNum,
      });
      return { txid, ok: true, wave: waveNum, confirmed: true };
    }

    // Обновляем состояние job в Firebase
    const nextWaveNum = waveNum + 1;
    const isDone      = nextWaveNum > MAX_WAVES;
    // Используем адаптивный интервал от repeat.js или базовый
    const msToNext    = data.recommendedNextWaveMs
      || (isDone ? null : WAVE_INTERVALS_MS[nextWaveNum - 1]);

    await fbPatch(`/waves/${txid}.json`, {
      wavesDone:   waveNum,
      active:      !isDone,
      nextWaveAt:  isDone ? null : Date.now() + msToNext,
      lastWaveAt:  Date.now(),
      lastAdaptive: data.adaptiveReason || null,
    });

    return {
      txid, ok: true, wave: waveNum,
      broadcasted:   data.broadcasted,
      hashrateReach: data.hashrateReach || 0,
      nextWaveIn:    isDone ? null : Math.round(msToNext / 60000) + ' мин',
    };

  } catch (e) {
    // Сетевая ошибка — повторим через 5 мин
    await fbPatch(`/waves/${txid}.json`, {
      nextWaveAt:  Date.now() + 5 * 60000,
      lastError:   e.message,
      lastErrorAt: Date.now(),
    });
    return { txid, ok: false, wave: waveNum, error: e.message };
  }
}

// ── MAIN HANDLER ─────────────────────────────────────────────
export default async function handler(req, res) {
  // Принимаем только GET (cron-job.org шлёт GET)
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  // Проверяем секрет — защита от случайных вызовов
  // cron-job.org шлёт его в заголовке X-Cron-Secret
  if (CRON_SECRET) {
    const incoming = req.headers['x-cron-secret']
      || req.headers['authorization']?.replace('Bearer ', '')
      || req.query?.secret;
    if (incoming !== CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  if (!FIREBASE_DB) {
    return res.status(200).json({
      ok: false,
      error: 'FIREBASE_DB_URL not configured — wave jobs cannot be tracked server-side',
      hint: 'Set FIREBASE_DB_URL in Vercel env variables',
    });
  }

  const t0   = Date.now();
  const jobs = await getActiveJobs();

  if (jobs.length === 0) {
    return res.status(200).json({
      ok:      true,
      fired:   0,
      message: 'No due wave jobs',
      ts:      t0,
    });
  }

  // Обрабатываем все просроченные jobs параллельно
  const results = await Promise.allSettled(jobs.map(job => fireWave(job)));
  const fired   = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { txid: jobs[i].txid, ok: false, error: r.reason?.message }
  );

  const okCount        = fired.filter(f => f.ok).length;
  const confirmedCount = fired.filter(f => f.confirmed).length;

  console.log(`[cron] fired=${okCount}/${fired.length} confirmed=${confirmedCount} ms=${Date.now()-t0}`);

  return res.status(200).json({
    ok:        true,
    processed: fired.length,
    succeeded: okCount,
    confirmed: confirmedCount,
    ms:        Date.now() - t0,
    jobs:      fired,
  });
}
