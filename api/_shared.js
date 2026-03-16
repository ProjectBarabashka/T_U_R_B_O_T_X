// ═══════════════════════════════════════════════════════════════
//  api/_shared.js  —  общие утилиты TurboTX v14.1
//  BUG FIXES:
//   ✅ Добавлены signToken/verifyToken — HMAC активация (не гоним PREMIUM_SECRET клиенту!)
//   ✅ makeRl теперь принимает необязательный label для логирования
// ═══════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from 'crypto';

// ─── CORS ──────────────────────────────────────────────────────
export const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-TurboTX-Token',
};

export const CORS_API = {
  ...CORS,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-TurboTX-Token',
};

// ─── FETCH С ТАЙМАУТОМ ─────────────────────────────────────────
export async function ft(url, opts = {}, ms = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// ─── SAFE JSON ─────────────────────────────────────────────────
export async function sj(r) {
  try { return await r.json(); } catch { return {}; }
}

// ─── SLEEP ─────────────────────────────────────────────────────
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── GET IP ────────────────────────────────────────────────────
export function getIp(req) {
  return req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress || 'unknown';
}

// ─── IP RATE LIMITER FACTORY ───────────────────────────────────
export function makeRl(max, windowMs = 3_600_000) {
  const map = new Map();
  return function checkRl(ip) {
    const now = Date.now();
    if (map.size > 2000) for (const [k, v] of map) if (v.r < now) map.delete(k);
    let e = map.get(ip);
    if (!e || e.r < now) { e = { c: 0, r: now + windowMs }; map.set(ip, e); }
    return ++e.c <= max;
  };
}

// ═══════════════════════════════════════════════════════════════
//  HMAC ACTIVATION TOKEN SYSTEM
//  BUG FIX CRITICAL: раньше verify.js + lightning.js отдавали
//  клиенту сырой PREMIUM_SECRET — перехват в DevTools = бесплатный Premium.
//  Теперь клиент получает одноразовый подписанный JWT-like токен.
//
//  Формат: base64url(JSON payload) + "." + HMAC-SHA256 подпись
//  payload: { txHash, method, iat, exp }
//
//  broadcast.js проверяет и старый секрет (для обратной совместимости)
//  и новый HMAC токен.
// ═══════════════════════════════════════════════════════════════

/**
 * Создаёт подписанный активационный токен.
 * @param {object} payload  — данные (txHash, method и т.д.)
 * @param {string} secret   — PREMIUM_SECRET из env
 * @param {number} expiryMs — TTL токена (по умолчанию 7 суток)
 */
export function signToken(payload, secret, expiryMs = 7 * 86_400_000) {
  if (!secret) return null;
  const data = Buffer.from(JSON.stringify({
    ...payload,
    iat: Date.now(),
    exp: Date.now() + expiryMs,
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/**
 * Проверяет подписанный токен.
 * @returns {object|null} — payload если валиден, null если нет
 */
export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const data = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  // Timing-safe сравнение — защита от timing attacks
  const expected = createHmac('sha256', secret).update(data).digest('base64url');
  try {
    const a = Buffer.from(sig,      'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null; // истёк
    return payload;
  } catch { return null; }
}

/**
 * Проверяет авторизацию для premium: принимает и старый сырой секрет
 * (обратная совместимость) и новый HMAC токен.
 * @returns {boolean}
 */
export function checkPremiumAuth(token, secret) {
  if (!secret) return true; // не настроено → пропускаем
  if (token === secret) return true; // старый формат (backward compat)
  return verifyToken(token, secret) !== null; // новый HMAC формат
}
