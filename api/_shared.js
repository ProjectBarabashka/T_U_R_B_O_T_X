// ═══════════════════════════════════════════════════════════════
//  api/_shared.js  —  общие утилиты TurboTX v14.1
//
//  ИЗМЕНЕНИЯ v14.1:
//  ✅ Добавлены signToken/verifyToken — HMAC активация
//     (не отдаём PREMIUM_SECRET клиенту — перехват в DevTools больше не даёт Premium)
//  ✅ Добавлен checkPremiumAuth — принимает и старый секрет (backward compat)
//     и новый подписанный HMAC токен
//  ✅ makeRl без изменений
// ═══════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from 'crypto';

// ─── CORS ──────────────────────────────────────────────────────
export const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-TurboTX-Token, Cache-Control, Pragma',
};

export const CORS_API = {
  ...CORS,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-TurboTX-Token, Cache-Control, Pragma',
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
//  HMAC ACTIVATION TOKEN SYSTEM  —  v14.1
//
//  ПРОБЛЕМА v14: verify.js и lightning.js отдавали клиенту сырой
//  PREMIUM_SECRET. Перехват в DevTools → бесплатный Premium навсегда.
//
//  РЕШЕНИЕ v14.1: клиент получает одноразовый подписанный токен.
//  Формат: base64url(JSON payload) + "." + HMAC-SHA256 подпись
//  Payload: { txHash, method, plan, iat, exp }
//
//  broadcast.js принимает ОБА формата (backward compat):
//    - старый: token === PREMIUM_SECRET (сырая строка)
//    - новый:  verifyToken(token, PREMIUM_SECRET) !== null
// ═══════════════════════════════════════════════════════════════

/**
 * Создаёт подписанный активационный токен.
 * @param {object} payload  — данные (txHash, method, plan и т.д.)
 * @param {string} secret   — PREMIUM_SECRET из env
 * @param {number} expiryMs — TTL токена (по умолчанию 7 суток)
 * @returns {string|null}
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
 * @returns {object|null} — payload если валиден и не истёк, null иначе
 */
export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const data = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
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
 * Проверяет Premium-авторизацию.
 * Принимает И старый сырой секрет (backward compat) И новый HMAC токен.
 * @returns {boolean}
 */
export function checkPremiumAuth(token, secret) {
  if (!secret) return true;            // PREMIUM_SECRET не настроен — пропускаем
  if (token === secret) return true;   // старый формат (backward compat)
  return verifyToken(token, secret) !== null; // новый HMAC формат
}
