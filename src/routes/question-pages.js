'use strict';

const express = require('express');
const { requireAuthPage, toObjectId } = require('../auth');
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

module.exports = function questionPages(db) {
  const router = express.Router();
  const users = db.collection('users');

  router.get('/questions', requireAuthPage, async (req, res, next) => {
    try {
      const list = await listForUser(db, req.user._id);
      res.render('questions', { title: '题库', questions: list, user: req.user });
    } catch (err) {
      next(err);
    }
  });

  router.get('/questions/:id', requireAuthPage, async (req, res, next) => {
    try {
      const question = await getQuestion(db, req.params.id);
      if (!question || !canUse(question, req.user._id)) {
        return res.status(404).render('error', { title: '找不到题目', message: '题目不存在，或你没有权限。' });
      }
      const [versions, usage] = await Promise.all([
        listVersions(db, question._id),
        usageSurveys(db, question._id),
      ]);
      const isOwner = String(question.ownerId) === String(req.user._id);
      const current = versions.find((v) => v.version === question.currentVersion) || versions[0];
      let sharedUsers = [];
      if ((question.sharedWith || []).length > 0) {
        sharedUsers = await users
          .find({ _id: { $in: question.sharedWith } })
          .project({ username: 1 })
          .toArray();
      }
      res.render('question-detail', {
        title: '题目详情',
        question,
        current,
        versions,
        usage,
        isOwner,
        sharedUsers,
        user: req.user,
        notice: req.query.notice || '',
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/questions/:id/stats', requireAuthPage, async (req, res, next) => {
    try {
      const question = await getQuestion(db, req.params.id);
      if (!question || !canUse(question, req.user._id)) {
        return res.status(404).render('error', { title: '找不到题目', message: '题目不存在，或你没有权限。' });
      }
      const stats = await crossSurveyStats(db, question._id);
      res.render('question-stats', { title: '题目统计', question, stats, user: req.user });
    } catch (err) {
      next(err);
    }
  });

  router.post('/questions/:id/versions', requireAuthPage, async (req, res, next) => {
    try {
      const question = await getQuestion(db, req.params.id);
      if (!question || !canUse(question, req.user._id)) {
        return res.status(404).render('error', { title: '找不到题目', message: '题目不存在，或你没有权限。' });
      }
      await addVersion(db, question._id, req.user._id, contentFromInput(req.body), {
        note: req.body.note,
      });
      res.redirect(`/questions/${question._id}?notice=${encodeURIComponent('已创建新版本')}`);
    } catch (err) {
      res.status(400).render('error', { title: '保存失败', message: err.message });
    }
  });

  router.post('/questions/:id/restore', requireAuthPage, async (req, res, next) => {
    try {
      const question = await getQuestion(db, req.params.id);
      if (!question || !canUse(question, req.user._id)) {
        return res.status(404).render('error', { title: '找不到题目', message: '题目不存在，或你没有权限。' });
      }
      const versionNumber = Number(req.body.version);
      const old = await getVersion(db, question._id, versionNumber);
      if (!old) return res.status(404).render('error', { title: '版本不存在', message: '要恢复的版本不存在。' });
      await addVersion(db, question._id, req.user._id, contentOf(old), {
        note: `恢复自 v${versionNumber}`,
        restoredFrom: versionNumber,
      });
      res.redirect(`/questions/${question._id}?notice=${encodeURIComponent(`已恢复 v${versionNumber}`)}`);
    } catch (err) {
      res.status(400).render('error', { title: '恢复失败', message: err.message });
    }
  });

  router.post('/questions/:id/share', requireAuthPage, async (req, res, next) => {
    try {
      const question = await getQuestion(db, req.params.id);
      if (!question || String(question.ownerId) !== String(req.user._id)) {
        return res.status(404).render('error', { title: '找不到题目', message: '题目不存在，或你不是所有者。' });
      }
      const username = String(req.body.username || '').trim().toLowerCase();
      const target = await users.findOne({ usernameLower: username });
      if (!target) {
        return res.status(404).render('error', { title: '用户不存在', message: `找不到用户 ${username}。` });
      }
      await db.collection('questions').updateOne(
        { _id: question._id },
        { $addToSet: { sharedWith: target._id }, $set: { updatedAt: new Date() } }
      );
      res.redirect(`/questions/${question._id}?notice=${encodeURIComponent(`已共享给 ${target.username}`)}`);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
