'use strict';

const express = require('express');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
} = require('../auth');

const USERNAME_PATTERN = /^[\w\u4e00-\u9fa5]{3,32}$/;

module.exports = function authRoutes(db) {
  const router = express.Router();

  router.post('/register', async (req, res, next) => {
    try {
      const username = String(req.body.username || '').trim();
      const password = String(req.body.password || '');

      if (!USERNAME_PATTERN.test(username)) {
        return res.status(400).json({ error: '用户名需为 3-32 位字母、数字、下划线或中文' });
      }
      if (password.length < 6 || password.length > 72) {
        return res.status(400).json({ error: '密码长度需在 6-72 位之间' });
      }

      const users = db.collection('users');
      const usernameLower = username.toLowerCase();
      const exists = await users.findOne({ usernameLower });
      if (exists) return res.status(409).json({ error: '用户名已被占用' });

      const { salt, hash } = hashPassword(password);
      const result = await users.insertOne({
        username,
        usernameLower,
        passwordHash: hash,
        passwordSalt: salt,
        createdAt: new Date(),
      });

      const token = await createSession(db, result.insertedId);
      setSessionCookie(res, token);
      res.status(201).json({ ok: true, user: { id: result.insertedId, username } });
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ error: '用户名已被占用' });
      }
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const username = String(req.body.username || '').trim();
      const password = String(req.body.password || '');
      if (!username || !password) {
        return res.status(400).json({ error: '请填写用户名和密码' });
      }

      const user = await db.collection('users').findOne({ usernameLower: username.toLowerCase() });
      if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
        return res.status(401).json({ error: '用户名或密码不正确' });
      }

      const token = await createSession(db, user._id);
      setSessionCookie(res, token);
      res.json({ ok: true, user: { id: user._id, username: user.username } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      await destroySession(db, req.sessionToken);
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', (req, res) => {
    res.json({
      user: req.user ? { id: req.user._id, username: req.user.username } : null,
    });
  });

  return router;
};
