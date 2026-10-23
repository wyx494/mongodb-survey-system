'use strict';

/**
 * 题目库：题目身份、版本、共享、引用与跨问卷统计。
 *
 * 设计要点：
 * - questions 存“这是哪道题”（所有者、当前版本、共享人、派生关系）
 * - question_versions 存不可变的内容（题干、题型、选项、约束）
 * - 问卷里保存的是“引用 + 快照”：questionId/version 指向来源，同时保留一份内容，
 *   这样已发布问卷不会因为题库改版而变化，读取时也不依赖联表。
 */
const { ObjectId } = require('mongodb');

const TYPES = new Set(['single', 'multiple', 'text', 'number']);

function toId(value) {
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)) return new ObjectId(value);
  return null;
}

function normalizeContent(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const type = String(input.type || '').trim();
  if (!TYPES.has(type)) throw new Error('题目类型不合法');

  const title = String(input.title || '').trim();
  if (!title) throw new Error('题目内容不能为空');
  if (title.length > 200) throw new Error('题目内容过长');

  const options = [];
  if (type === 'single' || type === 'multiple') {
    const rawOptions = Array.isArray(input.options) ? input.options : [];
    if (rawOptions.length < 2) throw new Error('选择题至少需要两个选项');
    const keys = new Set();
    for (const [index, option] of rawOptions.entries()) {
      const key = String(option && option.key != null ? option.key : '').trim();
      const label = String(option && option.label != null ? option.label : '').trim();
      if (!/^[A-Za-z0-9_-]{1,8}$/.test(key)) throw new Error(`第 ${index + 1} 个选项的 key 不合法`);
      if (!label || label.length > 50) throw new Error(`第 ${index + 1} 个选项文字为空或过长`);
      if (keys.has(key)) throw new Error(`选项 key 重复：${key}`);
      keys.add(key);
      options.push({ key, label });
    }
  }

  const c = input.constraints && typeof input.constraints === 'object' ? input.constraints : {};
  const constraints = {};
  if (type === 'multiple') {
    for (const field of ['minSelect', 'maxSelect', 'exactSelect']) {
      if (c[field] != null && c[field] !== '') {
        const value = Number(c[field]);
        if (!Number.isInteger(value) || value < 1) throw new Error(`多选的 ${field} 必须是正整数`);
        constraints[field] = value;
      }
    }
  }
  if (type === 'text') {
    for (const field of ['minLength', 'maxLength']) {
      if (c[field] != null && c[field] !== '') {
        const value = Number(c[field]);
        if (!Number.isInteger(value) || value < 0) throw new Error(`文本的 ${field} 必须是非负整数`);
        constraints[field] = value;
      }
    }
  }
  if (type === 'number') {
    for (const field of ['min', 'max']) {
      if (c[field] != null && c[field] !== '') {
        const value = Number(c[field]);
        if (!Number.isFinite(value)) throw new Error(`数字的 ${field} 必须是数字`);
        constraints[field] = value;
      }
    }
    if (c.integer != null) constraints.integer = c.integer === true || c.integer === 'true';
  }

  return { type, title, options, constraints };
}

function contentOf(version) {
  return {
    type: version.type,
    title: version.title,
    options: version.options || [],
    constraints: version.constraints || {},
  };
}

function canUse(question, userId) {
  if (!question || !userId) return false;
  if (String(question.ownerId) === String(userId)) return true;
  return (question.sharedWith || []).some((id) => String(id) === String(userId));
}

async function createQuestion(db, ownerId, content, options = {}) {
  const normalized = normalizeContent(content);
  const now = new Date();
  const questionDoc = {
    ownerId,
    title: normalized.title,
    type: normalized.type,
    currentVersion: 1,
    inBank: options.inBank !== false,
    sharedWith: [],
    derivedFrom: options.derivedFrom || null,
    createdAt: now,
    updatedAt: now,
  };
  const inserted = await db.collection('questions').insertOne(questionDoc);

  const versionDoc = {
    questionId: inserted.insertedId,
    version: 1,
    ...normalized,
    createdBy: ownerId,
    createdAt: now,
    note: options.note || '初始版本',
    restoredFrom: null,
  };
  await db.collection('question_versions').insertOne(versionDoc);

  return {
    question: { ...questionDoc, _id: inserted.insertedId },
    version: versionDoc,
  };
}

async function addVersion(db, questionId, userId, content, options = {}) {
  const id = toId(questionId);
  if (!id) throw new Error('题目 id 不合法');
  const question = await db.collection('questions').findOne({ _id: id });
  if (!question) throw new Error('题目不存在');
  if (String(question.ownerId) !== String(userId)) throw new Error('只有题目所有者可以修改');

  const normalized = normalizeContent(content);
  const nextVersion = question.currentVersion + 1;
  const now = new Date();
  const versionDoc = {
    questionId: id,
    version: nextVersion,
    ...normalized,
    createdBy: userId,
    createdAt: now,
    note: options.note || `第 ${nextVersion} 版`,
    restoredFrom: options.restoredFrom != null ? Number(options.restoredFrom) : null,
  };
  await db.collection('question_versions').insertOne(versionDoc);
  await db.collection('questions').updateOne(
    { _id: id },
    { $set: { currentVersion: nextVersion, title: normalized.title, type: normalized.type, updatedAt: now } }
  );

  return { question: { ...question, currentVersion: nextVersion }, version: versionDoc };
}

async function getQuestion(db, questionId) {
  const id = toId(questionId);
  if (!id) return null;
  return db.collection('questions').findOne({ _id: id });
}

async function getVersion(db, questionId, version) {
  const id = toId(questionId);
  if (!id) return null;
  const query = { questionId: id };
  if (version != null) query.version = Number(version);
  return db.collection('question_versions').findOne(query, {
    sort: version != null ? undefined : { version: -1 },
  });
}

async function listVersions(db, questionId) {
  const id = toId(questionId);
  if (!id) return [];
  return db
    .collection('question_versions')
    .find({ questionId: id })
    .sort({ version: -1 })
    .toArray();
}

async function usageSurveys(db, questionId) {
  const id = toId(questionId);
  if (!id) return [];
  return db
    .collection('surveys')
    .find({ 'questions.questionId': id })
    .project({ title: 1, status: 1, slug: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .toArray();
}

async function listForUser(db, userId) {
  const questions = await db
    .collection('questions')
    .find({ $or: [{ ownerId: userId }, { sharedWith: userId }] })
    .sort({ updatedAt: -1 })
    .toArray();

  const result = [];
  for (const question of questions) {
    const current = await getVersion(db, question._id, question.currentVersion);
    const usage = await db.collection('surveys').countDocuments({ 'questions.questionId': question._id });
    result.push({
      ...question,
      current: current ? contentOf(current) : null,
      usageCount: usage,
      isOwner: String(question.ownerId) === String(userId),
    });
  }
  return result;
}

/**
 * 跨问卷统计：按题目 id 把不同问卷、不同版本的答案汇总。
 * 返回按版本分组的统计，避免不同版本选项不一致时硬合并。
 */
async function crossSurveyStats(db, questionId) {
  const id = toId(questionId);
  const question = await db.collection('questions').findOne({ _id: id });
  if (!question) return null;

  const versions = await listVersions(db, id);
  const responses = db.collection('responses');
  const result = { question: { id: question._id, title: question.title, type: question.type }, total: 0, versions: [] };

  for (const version of versions) {
    const matchVersion = {
      surveyId: { $exists: true },
      answers: { $elemMatch: { questionId: id, version: version.version } },
    };
    const total = await responses.countDocuments({
      answers: { $elemMatch: { questionId: id, version: version.version } },
    });
    const entry = {
      version: version.version,
      type: version.type,
      title: version.title,
      createdAt: version.createdAt,
      totalAnswered: total,
    };

    if (version.type === 'single' || version.type === 'multiple') {
      const pipeline = [
        { $match: matchVersion },
        { $unwind: '$answers' },
        { $match: { 'answers.questionId': id, 'answers.version': version.version } },
      ];
      if (version.type === 'multiple') pipeline.push({ $unwind: '$answers.value' });
      pipeline.push({ $group: { _id: '$answers.value', count: { $sum: 1 } } });

      const rows = await responses.aggregate(pipeline).toArray();
      const counts = new Map(rows.map((r) => [r._id, r.count]));
      entry.options = (version.options || []).map((o) => ({
        key: o.key,
        label: o.label,
        count: counts.get(o.key) || 0,
      }));
    } else if (version.type === 'text') {
      const rows = await responses
        .aggregate([
          { $match: matchVersion },
          { $unwind: '$answers' },
          { $match: { 'answers.questionId': id, 'answers.version': version.version } },
          { $project: { _id: 0, value: '$answers.value' } },
        ])
        .toArray();
      entry.values = rows.map((r) => r.value);
    } else {
      const [row] = await responses
        .aggregate([
          { $match: matchVersion },
          { $unwind: '$answers' },
          { $match: { 'answers.questionId': id, 'answers.version': version.version } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              avg: { $avg: '$answers.value' },
              min: { $min: '$answers.value' },
              max: { $max: '$answers.value' },
              values: { $push: '$answers.value' },
            },
          },
        ])
        .toArray();
      entry.totalAnswered = row ? row.count : 0;
      entry.avg = row ? Number(row.avg.toFixed(2)) : null;
      entry.min = row ? row.min : null;
      entry.max = row ? row.max : null;
      entry.values = row ? row.values : [];
    }

    result.total += entry.totalAnswered;
    result.versions.push(entry);
  }

  return result;
}

function parseOptions(input) {
  if (Array.isArray(input)) return input;
  return String(input || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split('|');
      return { key: key.trim(), label: rest.join('|').trim() };
    });
}

function contentFromInput(body) {
  const content = {
    type: body.type,
    title: body.title,
    options: parseOptions(body.options),
    constraints: {},
  };

  if (body.constraints && typeof body.constraints === 'object') {
    Object.assign(content.constraints, body.constraints);
  }
  for (const field of ['min', 'max', 'minLength', 'maxLength', 'minSelect', 'maxSelect', 'exactSelect']) {
    if (body[field] != null && body[field] !== '') content.constraints[field] = Number(body[field]);
  }
  if (body.integer === true || body.integer === 'on' || body.integer === 'true') {
    content.constraints.integer = true;
  }

  return content;
}

module.exports = {
  TYPES,
  toId,
  normalizeContent,
  contentOf,
  canUse,
  createQuestion,
  addVersion,
  getQuestion,
  getVersion,
  listVersions,
  usageSurveys,
  listForUser,
  crossSurveyStats,
  parseOptions,
  contentFromInput,
};
