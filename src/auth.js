'use strict';

/**
 * 账号与会话。
 *
 * - 密码用 Node 内置的 scrypt 加盐哈希，不存明文；
 * - 会话不放在内存里，而是写进 MongoDB 的 sessions 集合，
 *   靠 TTL 索引自动过期，服务重启也不会把所有人踢下线。
 */
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const config = require('./config');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  await db.collection('sessions').insertOne({
    _id: token,
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + config.sessionTtlMs),
  });
  return token;
}

async function destroySession(db, token) {
  if (!token) return;
  await db.collection('sessions').deleteOne({ _id: token });
}

function setSessionCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlMs,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, { path: '/' });
}

/**
 * 每个请求都尝试解析会话，失败也不报错——只是当作未登录。
 */
function attachUser(db) {
  return async function attachUserMiddleware(req, res, next) {
    try {
      const cookies = parseCookies(req.headers.cookie || '');
      const token = cookies[config.cookieName];
      req.sessionToken = token || null;
      req.user = null;
      if (token) {
        const session = await db.collection('sessions').findOne({
          _id: token,
          expiresAt: { $gt: new Date() },
        });
        if (session) {
          const user = await db.collection('users').findOne({ _id: session.userId });
          if (user) {
            req.user = { _id: user._id, username: user.username, createdAt: user.createdAt };
          }
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  next();
}

function requireAuthPage(req, res, next) {
  if (!req.user) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?next=${nextUrl}`);
  }
  next();
}

function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)) return new ObjectId(value);
  return null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  parseCookies,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireAuthPage,
  toObjectId,
};
