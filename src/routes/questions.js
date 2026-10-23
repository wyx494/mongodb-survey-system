'use strict';

const express = require('express');
const { requireAuth, toObjectId } = require('../auth');
const {
  addVersion,
  canUse,
  contentFromInput,
  contentOf,
  crossSurveyStats,
  getQuestion,
  getVersion,
  listForUser,
  listVersions,
  usageSurveys,
} = require('../services/questions');

module.exports = function questionRoutes(db) {
  const router = express.Router();
  const users = db.collection('users');

  router.use(requireAuth);

  async function loadVisible(req) {
    const question = await getQuestion(db, req.params.id);
    if (!question) return null;
    if (!canUse(question, req.user._id)) return null;
    return question;
  }

  router.get('/', async (req, res, next) => {
    try {
      const list = await listForUser(db, req.user._id);
      res.json({ questions: list });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const question = await loadVisible(req);
      if (!question) return res.status(404).json({ error: '题目不存在' });
      const [versions, usage] = await Promise.all([
        listVersions(db, question._id),
        usageSurveys(db, question._id),
      ]);
      res.json({
        question,
        versions,
        usage,
        isOwner: String(question.ownerId) === String(req.user._id),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/versions', async (req, res, next) => {
    try {
      const question = await loadVisible(req);
      if (!question) return res.status(404).json({ error: '题目不存在' });
      const result = await addVersion(db, question._id, req.user._id, contentFromInput(req.body), {
        note: req.body.note,
      });
      res.status(201).json({ ok: true, version: result.version.version });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/:id/restore', async (req, res, next) => {
    try {
      const question = await loadVisible(req);
      if (!question) return res.status(404).json({ error: '题目不存在' });
      const versionNumber = Number(req.body.version);
      const old = await getVersion(db, question._id, versionNumber);
      if (!old) return res.status(404).json({ error: '版本不存在' });
      const result = await addVersion(db, question._id, req.user._id, contentOf(old), {
        note: `恢复自 v${versionNumber}`,
        restoredFrom: versionNumber,
      });
      res.json({ ok: true, version: result.version.version });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/:id/share', async (req, res, next) => {
    try {
      const question = await loadVisible(req);
      if (!question) return res.status(404).json({ error: '题目不存在' });
      if (String(question.ownerId) !== String(req.user._id)) {
        return res.status(403).json({ error: '只有题目所有者可以共享' });
      }
      const username = String(req.body.username || '').trim().toLowerCase();
      if (!username) return res.status(400).json({ error: '请输入用户名' });
      const target = await users.findOne({ usernameLower: username });
      if (!target) return res.status(404).json({ error: '用户不存在' });
      if (String(target._id) === String(req.user._id)) {
        return res.status(400).json({ error: '不能共享给自己' });
      }
      await db.collection('questions').updateOne(
        { _id: question._id },
        { $addToSet: { sharedWith: target._id }, $set: { updatedAt: new Date() } }
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id/share/:userId', async (req, res, next) => {
    try {
      const question = await loadVisible(req);
      if (!question) return res.status(404).json({ error: '题目不存在' });
      if (String(question.ownerId) !== String(req.user._id)) {
        return res.status(403).json({ error: '只有题目所有者可以取消共享' });
      }
      const targetId = toObjectId(req.params.userId);
      if (!targetId) return res.status(400).json({ error: '用户 id 不合法' });
      await db.collection('questions').updateOne(
        { _id: question._id },
        { $pull: { sharedWith: targetId }, $set: { updatedAt: new Date() } }
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/usage', async (req, res, next) => {
    try {
      const question = await loadVisible(req);
      if (!question) return res.status(404).json({ error: '题目不存在' });
      res.json({ surveys: await usageSurveys(db, question._id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/stats', async (req, res, next) => {
    try {
      const question = await loadVisible(req);
      if (!question) return res.status(404).json({ error: '题目不存在' });
      const stats = await crossSurveyStats(db, question._id);
      res.json({ stats });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
