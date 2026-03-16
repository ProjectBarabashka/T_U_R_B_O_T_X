// ══════════════════════════════════════════════════════════════
//  TurboTX v14.1 PUBLIC API  —  /api/v1.js
//
//  ИЗМЕНЕНИЯ v14.1:
//  🐛 CRITICAL: authenticate() теперь проверяет _dynamicKeys.
//     Ранее ключи созданные через ?method=keys&action=create
//     НИКОГДА не работали — Map был изолирован от auth.
//  🐛 getDynamicKeys() используется в authenticate()
//  🆕 ?method=batch — batch broadcast через v1 API
//  🆕 X-Request-ID header в ответах для дебага
//  🆕 lastUsed и requestCount трекаются для каждого ключа
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 30 };

import { CORS_API as CORS, ft, getIp, sj } from './_shared.js';

// ─── API KEY STORE ────────────────────────────────────────────
function loadApiKeys() {
  const raw = process.env.TURBOTX_API_KEYS || '';
  const map = new Map();
  const testKey = process.env.TURBOTX_TEST_KEY;
  if (testKey) map.set(testKey, { tier:'pro', name:'Internal', createdAt:Date.now() });
  raw.split(',').forEach(entry => {
    const [key, tier, name] = entry.trim().split(':');
    if (key && key.startsWith('ttx_'))
      map.set(key, { tier: tier || 'basic', name: name || 'Partner', createdAt: Date.now() });
  });
  return map;
}

const API_KEYS = loadApiKeys();

// In-memory динамические ключи (созданные через ?method=keys)
const _dynamicKeys = new Map();

// BUG FIX v14.1: экспортируем для использования в authenticate()
export function getDynamicKeys() { return _dynamicKeys; }

const TIER_LIMITS = {
  free:    { perMin: 30,       perDay: 500    },
  basic:   { perMin: 100,      perDay: 5000   },
  pro:     { perMin: 500,      perDay: 50000  },
  partner: { perMin: Infinity, perDay: Infinity },
};

const _rl = new Map();
function checkRateLimit(apiKey, tier) {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;
  const now    = Date.now();
  const minKey = `${apiKey}:min:${Math.floor(now / 60000)}`;
  const dayKey = `${apiKey}:day:${Math.floor(now / 86400000)}`;
  if (_rl.size > 10000)
    for (const [k, v] of _rl) if (v.expires < now) _rl.delete(k);
  let min = _rl.get(minKey) || { count: 0, expires: now + 60000 };
  let day = _rl.get(dayKey) || { count: 0, expires: now + 86400000 };
  if (min.count >= limits.perMin) return { ok:false, reason:'per_minute', limit:limits.perMin, reset:min.expires };
  if (day.count >= limits.perDay) return { ok:false, reason:'per_day',    limit:limits.perDay, reset:day.expires };
  min.count++; day.count++;
  _rl.set(minKey, min); _rl.set(dayKey, day);
  return { ok:true, remaining:{ perMin: limits.perMin - min.count, perDay: limits.perDay - day.count }, limits };
}

// BUG FIX v14.1 CRITICAL: authenticate() проверяет ОБА стора
function authenticate(req) {
  let key = null;
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ttx_'))          key = auth.slice(7);
  else if (req.headers['x-api-key']?.startsWith('ttx_')) key = req.headers['x-api-key'];
  else if (req.query?.apikey?.startsWith('ttx_'))         key = req.query.apikey;

  if (!key) return { ok:false, error:'API key required. Pass Authorization: Bearer ttx_...' };

  // BUG FIX v14.1: проверяем env-ключи И динамические
  let info = API_KEYS.get(key);
  if (!info) info = _dynamicKeys.get(key); // ← КРИТИЧЕСКИЙ FIX
  if (!info) return { ok:false, error:'Invalid API key' };

  if (info.active === false) return { ok:false, error:'API key revoked' };

  // Трекаем lastUsed для динамических ключей
  if (_dynamicKeys.has(key)) {
    const record = _dynamicKeys.get(key);
    record.lastUsed      = Date.now();
    record.requestCount  = (record.requestCount || 0) + 1;
    _dynamicKeys.set(key, record);
  }

  return { ok:true, key, ...info };
}

async function callInternal(fn, params = {}) {
  const base = process.env.PRODUCTION_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const qs = new URLSearchParams({ _fn: fn, ...params }).toString();
  try {
    const r = await ft(`${base}/api/router?${qs}`, {}, 15000);
    return r.ok ? await sj(r) : { ok:false, error:`Internal error: ${r.status}` };
  } catch(e) { return { ok:false, error:e.message }; }
}

async function callAcceleration(txid) {
  const base = process.env.PRODUCTION_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  try {
    const r = await ft(`${base}/api/router?_fn=acceleration&txid=${txid}`, {}, 15000);
    return r.ok ? await sj(r) : { ok:false, error:`Acceleration error: ${r.status}` };
  } catch(e) { return { ok:false, error:e.message }; }
}

async function handleAccelerate(req, auth) {
  if (req.method !== 'POST') return { status:405, body:{ ok:false, error:'POST required' } };
  const { txid, plan = 'free', webhookUrl } = req.body || {};
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid))
    return { status:400, body:{ ok:false, error:'Invalid txid' } };

  const effectivePlan = (auth.tier === 'pro' || auth.tier === 'partner') ? 'premium' : plan;
  const base = process.env.PRODUCTION_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  try {
    const r = await ft(`${base}/api/broadcast`, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-TurboTX-Token':  process.env.PREMIUM_SECRET || '',
        'X-API-Source':     'public_api_v1',
        'X-API-Key-Tier':   auth.tier,
      },
      body: JSON.stringify({ txid, plan: effectivePlan, apiKey: auth.key }),
    }, 55000);

    const data = r.ok ? await sj(r) : { ok:false, error:`Broadcast error: ${r.status}` };

    if (webhookUrl && data.ok) {
      ft(webhookUrl, {
        method:  'POST', headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ event:'acceleration.started', txid, plan:effectivePlan, ...data }),
      }, 5000).catch(()=>{});
    }
    return { status:200, body:{ ...data, plan:effectivePlan, apiVersion:'v1' } };
  } catch(e) {
    return { status:500, body:{ ok:false, error:e.message } };
  }
}

// Batch accelerate
async function handleBatchAccelerate(req, auth) {
  if (req.method !== 'POST') return { status:405, body:{ ok:false, error:'POST required' } };
  const { txids, webhookUrl } = req.body || {};
  if (!Array.isArray(txids) || txids.length === 0)
    return { status:400, body:{ ok:false, error:'txids array required' } };

  const effectivePlan = (auth.tier === 'pro' || auth.tier === 'partner') ? 'premium' : 'free';
  const base = process.env.PRODUCTION_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  try {
    const r = await ft(`${base}/api/broadcast`, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-TurboTX-Token': process.env.PREMIUM_SECRET || '',
        'X-API-Source':    'public_api_v1_batch',
      },
      body: JSON.stringify({ txids, plan: effectivePlan }),
    }, 55000);
    const data = r.ok ? await sj(r) : { ok:false, error:`Batch error: ${r.status}` };
    return { status:200, body:{ ...data, apiVersion:'v1' } };
  } catch(e) {
    return { status:500, body:{ ok:false, error:e.message } };
  }
}

function handlePing(auth, rl) {
  return {
    status: 200,
    body: {
      ok: true, message: 'pong', apiVersion: 'v1', authenticated: true,
      keyInfo:   { tier: auth.tier, name: auth.name },
      rateLimit: rl.limits, remaining: rl.remaining,
      timestamp: Date.now(),
    },
  };
}

function checkAdmin(req) {
  const secret = process.env.ADMIN_SECRET || process.env.PREMIUM_SECRET;
  const token  = req.headers['x-admin-token'] || req.query?.adminToken;
  return secret && token === secret;
}

function generateKey(tier) {
  const prefix = tier === 'partner' ? 'ttx_partner_' : tier === 'pro' ? 'ttx_pro_' : 'ttx_live_';
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return `${prefix}${rand}`;
}

async function handleKeys(req) {
  if (!checkAdmin(req))
    return { status:401, body:{ ok:false, error:'Unauthorized' } };

  const action = req.query?.action || req.body?.action;

  if (action === 'create' || (req.method === 'POST' && !action)) {
    const { tier = 'basic', name = 'Partner', note = '', webhookUrl } = req.body || {};
    if (!['free','basic','pro','partner'].includes(tier))
      return { status:400, body:{ ok:false, error:'Invalid tier' } };

    const key = generateKey(tier);
    _dynamicKeys.set(key, {
      key, tier, name, note,
      webhookUrl:    webhookUrl || null,
      createdAt:     Date.now(),
      lastUsed:      null,
      requestCount:  0,
      active:        true,
    });

    return {
      status: 201,
      body: {
        ok: true, apiKey: key, tier, name,
        limits: { free:'30/мин · 500/день', basic:'100/мин · 5k/день', pro:'500/мин · 50k/день', partner:'Unlimited' }[tier],
        docsUrl: 'https://acelerat.vercel.app/api-docs',
        note: 'Сохраните ключ — он показывается один раз',
      },
    };
  }

  if (action === 'list' || req.method === 'GET') {
    const envKeys = (process.env.TURBOTX_API_KEYS || '').split(',').filter(Boolean).map(entry => {
      const [key, tier, name] = entry.trim().split(':');
      return { key: key.slice(0,12) + '****', tier, name, source:'env', active:true };
    });
    const dynKeys = Array.from(_dynamicKeys.values()).map(k => ({
      key:          k.key.slice(0,12) + '****',
      tier:         k.tier,
      name:         k.name,
      note:         k.note,
      createdAt:    k.createdAt,
      lastUsed:     k.lastUsed,
      requestCount: k.requestCount,
      active:       k.active,
      source:       'dynamic',
    }));
    return { status:200, body:{ ok:true, total: envKeys.length + dynKeys.length, keys:[...envKeys, ...dynKeys] } };
  }

  if (action === 'revoke') {
    const { key } = req.body || {};
    if (!key) return { status:400, body:{ ok:false, error:'key required' } };
    const record = _dynamicKeys.get(key);
    if (!record) return { status:404, body:{ ok:false, error:'Key not found (env keys cannot be revoked here)' } };
    _dynamicKeys.delete(key);
    return { status:200, body:{ ok:true, message:'Key revoked', key: key.slice(0,12) + '****' } };
  }

  return { status:400, body:{ ok:false, error:'Unknown action', validActions:['create','list','revoke'] } };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));

  // Request ID для дебага
  const requestId = `v1_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  res.setHeader('X-Request-ID',  requestId);
  res.setHeader('X-API-Version', 'v1');
  res.setHeader('X-Powered-By',  'TurboTX');

  const setRlHeaders = (rl) => {
    if (!rl?.limits) return;
    res.setHeader('X-RateLimit-Limit-Minute',     rl.limits.perMin);
    res.setHeader('X-RateLimit-Limit-Day',         rl.limits.perDay);
    res.setHeader('X-RateLimit-Remaining-Minute',  rl.remaining?.perMin ?? 0);
    res.setHeader('X-RateLimit-Remaining-Day',     rl.remaining?.perDay ?? 0);
  };

  const auth = authenticate(req);
  if (!auth.ok)
    return res.status(401).json({ ok:false, error:auth.error, docs:'https://acelerat.vercel.app/api-docs' });

  const rl = checkRateLimit(auth.key, auth.tier);
  setRlHeaders(rl);
  if (!rl.ok)
    return res.status(429).json({
      ok:false, error:`Rate limit exceeded (${rl.reason})`,
      limit:rl.limit, resetAt:rl.reset,
      upgradeUrl:'https://acelerat.vercel.app/api-docs#pricing',
    });

  const method = req.query?.method || req.body?.method;
  const txid   = req.query?.txid   || req.body?.txid;

  let result;
  switch (method) {
    case 'ping':
      result = handlePing(auth, rl); break;

    case 'status':
      if (!txid) { result = { status:400, body:{ ok:false, error:'txid required' } }; break; }
      result = { status:200, body: await callInternal('status', { txid }) }; break;

    case 'mempool':
      result = { status:200, body: await callInternal('mempool', txid ? { txid } : {}) }; break;

    case 'fees': {
      const data = await callInternal('mempool');
      result = { status:200, body:{ ok:true, fees:data.fees, congestion:data.congestion, history24h:data.history24h, predictions:data.predictions, mempool:data.mempool, timestamp:data.timestamp } };
      break;
    }

    case 'price':
      result = { status:200, body: await callInternal('price') }; break;

    case 'acceleration':
    case 'advisor':
      if (!txid) { result = { status:400, body:{ ok:false, error:'txid required' } }; break; }
      result = { status:200, body: await callAcceleration(txid) }; break;

    case 'accelerate':
      result = await handleAccelerate(req, auth); break;

    case 'batch':
      result = await handleBatchAccelerate(req, auth); break;

    case 'health':
      result = { status:200, body: await callInternal('health', req.query?.verbose === '1' ? { verbose:'1' } : {}) }; break;

    case 'stats':
      result = { status:200, body: await callInternal('stats') }; break;

    case 'cpfp':
      if (!txid) { result = { status:400, body:{ ok:false, error:'txid required' } }; break; }
      result = { status:200, body: await callInternal('cpfp', { txid, ...req.query }) }; break;

    case 'rbf':
      if (!txid) { result = { status:400, body:{ ok:false, error:'txid required' } }; break; }
      result = { status:200, body: await callInternal('rbf', { txid, ...req.query }) }; break;

    case 'keys':
      result = await handleKeys(req); break;

    default:
      result = {
        status: 400,
        body: {
          ok:false, error:`Unknown method: "${method}"`,
          availableMethods: ['ping','status','mempool','fees','price','acceleration','accelerate','batch','health','stats','cpfp','rbf','keys'],
          docs: 'https://acelerat.vercel.app/api-docs',
        },
      };
  }

  if (result.body && typeof result.body === 'object') {
    result.body._meta = {
      apiVersion: 'v1',
      tier:       auth.tier,
      remaining:  rl.remaining,
      requestId,
    };
  }

  return res.status(result.status).json(result.body);
}
