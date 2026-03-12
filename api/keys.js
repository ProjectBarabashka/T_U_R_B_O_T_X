// ══════════════════════════════════════════════════════════════
//  TurboTX  —  /api/keys.js
//  Управление API ключами (только для внутреннего использования)
//
//  POST /api/keys?action=create   — создать новый ключ
//  GET  /api/keys?action=list     — список всех ключей
//  POST /api/keys?action=revoke   — отозвать ключ
//
//  Защита: требует ADMIN_SECRET в заголовке X-Admin-Token
//
//  В продакшне подключите KV/Firebase для персистентности.
//  Сейчас: in-memory + env-based (перезапуск сбрасывает динамические ключи)
// ══════════════════════════════════════════════════════════════

export const config = { maxDuration: 10 };

const CORS = {
  'Access-Control-Allow-Origin':  process.env.PRODUCTION_URL || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
};

// In-memory store (дополняется поверх env-ключей)
const _dynamicKeys = new Map();

function generateKey(tier) {
  const prefix = tier === 'partner' ? 'ttx_partner_' : tier === 'pro' ? 'ttx_pro_' : 'ttx_live_';
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return `${prefix}${rand}`;
}

function checkAdmin(req) {
  const secret = process.env.ADMIN_SECRET || process.env.PREMIUM_SECRET;
  const token = req.headers['x-admin-token'] || req.query?.adminToken;
  return secret && token === secret;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (!checkAdmin(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const action = req.query?.action || req.body?.action;

  if (action === 'create' || req.method === 'POST' && !action) {
    const { tier = 'basic', name = 'Partner', note = '', webhookUrl } = req.body || {};
    if (!['free', 'basic', 'pro', 'partner'].includes(tier)) {
      return res.status(400).json({ ok: false, error: 'Invalid tier. Use: free, basic, pro, partner' });
    }

    const key = generateKey(tier);
    const record = {
      key, tier, name, note,
      webhookUrl: webhookUrl || null,
      createdAt: Date.now(),
      lastUsed: null,
      requestCount: 0,
      active: true,
    };
    _dynamicKeys.set(key, record);

    return res.status(201).json({
      ok: true,
      apiKey: key,
      tier,
      name,
      limits: {
        free:    '30 req/мин · 500 req/день',
        basic:   '100 req/мин · 5,000 req/день',
        pro:     '500 req/мин · 50,000 req/день',
        partner: 'Unlimited',
      }[tier],
      docsUrl: 'https://acelerat.vercel.app/api-docs',
      note: 'Сохраните ключ — он показывается один раз',
    });
  }

  if (action === 'list' || req.method === 'GET') {
    // Показываем env-ключи (без значения) + динамические
    const envKeys = (process.env.TURBOTX_API_KEYS || '').split(',')
      .filter(Boolean)
      .map(entry => {
        const [key, tier, name] = entry.trim().split(':');
        return { key: key.slice(0, 12) + '****', tier, name, source: 'env', active: true };
      });

    const dynKeys = Array.from(_dynamicKeys.values()).map(k => ({
      key:   k.key.slice(0, 12) + '****',
      tier:  k.tier,
      name:  k.name,
      note:  k.note,
      createdAt: k.createdAt,
      lastUsed:  k.lastUsed,
      requestCount: k.requestCount,
      active: k.active,
      source: 'dynamic',
    }));

    return res.status(200).json({
      ok: true,
      total: envKeys.length + dynKeys.length,
      keys: [...envKeys, ...dynKeys],
    });
  }

  if (action === 'revoke') {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ ok: false, error: 'key required' });
    const record = _dynamicKeys.get(key);
    if (!record) return res.status(404).json({ ok: false, error: 'Key not found (env keys cannot be revoked here)' });
    _dynamicKeys.delete(key);
    return res.status(200).json({ ok: true, message: 'Key revoked', key: key.slice(0, 12) + '****' });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action', validActions: ['create', 'list', 'revoke'] });
}

// Экспортируем для использования в v1.js
export function getDynamicKeys() { return _dynamicKeys; }
