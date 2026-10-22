'use strict';

/**
 * 问卷结构处理：短链生成、题目规范化、发布前校验。
 */
const crypto = require('node:crypto');

// 去掉了容易混淆的 0/o、1/l/I
const SLUG_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

function generateSlug(length = 8) {
  let slug = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return slug;
}

const TYPES = new Set(['single', 'multiple', 'text', 'number']);
const NUMBER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeOptions(rawOptions, questionNumber) {
  assert(Array.isArray(rawOptions), `第 ${questionNumber} 题缺少选项`);
  assert(rawOptions.length >= 2, `第 ${questionNumber} 题至少需要两个选项`);
  assert(rawOptions.length <= 50, `第 ${questionNumber} 题选项过多`);

  const keys = new Set();
  return rawOptions.map((raw, i) => {
    const key = String(raw && raw.key != null ? raw.key : '').trim();
    const label = String(raw && raw.label != null ? raw.label : '').trim();
    assert(/^[A-Za-z0-9_-]{1,8}$/.test(key), `第 ${questionNumber} 题第 ${i + 1} 个选项的 key 不合法`);
    assert(label.length > 0 && label.length <= 50, `第 ${questionNumber} 题第 ${i + 1} 个选项文字为空或过长`);
    assert(!keys.has(key), `第 ${questionNumber} 题选项 key 重复：${key}`);
    keys.add(key);
    return { key, label };
  });
}

function normalizeConstraints(type, raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};

  if (type === 'multiple') {
    for (const field of ['minSelect', 'maxSelect', 'exactSelect']) {
      if (input[field] != null && input[field] !== '') {
        const value = Number(input[field]);
        assert(Number.isInteger(value) && value >= 1, `多选的 ${field} 必须是正整数`);
        output[field] = value;
      }
    }
    if (output.minSelect != null && output.maxSelect != null) {
      assert(output.minSelect <= output.maxSelect, '多选的最小选择数不能大于最大选择数');
    }
  }

  if (type === 'text') {
    for (const field of ['minLength', 'maxLength']) {
      if (input[field] != null && input[field] !== '') {
        const value = Number(input[field]);
        assert(Number.isInteger(value) && value >= 0, `文本的 ${field} 必须是非负整数`);
        output[field] = value;
      }
    }
    if (output.minLength != null && output.maxLength != null) {
      assert(output.minLength <= output.maxLength, '文本的最小长度不能大于最大长度');
    }
  }

  if (type === 'number') {
    for (const field of ['min', 'max']) {
      if (input[field] != null && input[field] !== '') {
        const value = Number(input[field]);
        assert(Number.isFinite(value), `数字的 ${field} 必须是数字`);
        output[field] = value;
      }
    }
    if (output.min != null && output.max != null) {
      assert(output.min <= output.max, '数字的最小值不能大于最大值');
    }
    if (input.integer != null) {
      output.integer = input.integer === true || input.integer === 'true';
    }
  }

  return output;
}

function normalizeJumps(type, rawJumps, questionNumber) {
  if (rawJumps == null) return [];
  assert(Array.isArray(rawJumps), `第 ${questionNumber} 题的跳转规则格式不正确`);
  return rawJumps.map((raw, i) => {
    assert(raw && typeof raw === 'object', `第 ${questionNumber} 题第 ${i + 1} 条跳转规则格式不正确`);
    const when = raw.when || {};
    const to = String(raw.to || '').trim();
    assert(/^[A-Za-z0-9_-]{1,20}$/.test(to), `第 ${questionNumber} 题第 ${i + 1} 条跳转规则缺少目标题`);

    if (type === 'single') {
      const option = String(when.option || '').trim();
      assert(option, `第 ${questionNumber} 题第 ${i + 1} 条跳转规则缺少选项条件`);
      return { when: { option }, to };
    }
    if (type === 'multiple') {
      const includes = String(when.includes || '').trim();
      assert(includes, `第 ${questionNumber} 题第 ${i + 1} 条跳转规则缺少选项条件`);
      return { when: { includes }, to };
    }
    if (type === 'number') {
      const op = String(when.op || '').trim();
      assert(NUMBER_OPS.has(op), `第 ${questionNumber} 题第 ${i + 1} 条跳转规则运算符不合法`);
      if (op === 'between') {
        const min = Number(when.min);
        const max = Number(when.max);
        assert(Number.isFinite(min) && Number.isFinite(max) && min <= max, `第 ${questionNumber} 题区间条件不合法`);
        return { when: { op, min, max }, to };
      }
      const value = Number(when.value);
      assert(Number.isFinite(value), `第 ${questionNumber} 题跳转比较值必须是数字`);
      return { when: { op, value }, to };
    }
    throw new Error(`第 ${questionNumber} 题为填空题，不支持跳转`);
  });
}

/**
 * 把前端传来的题目整理成数据库里的结构，并做基础校验。
 */
function normalizeQuestion(raw, index) {
  const questionNumber = index + 1;
  assert(raw && typeof raw === 'object', `第 ${questionNumber} 题格式不正确`);

  const type = String(raw.type || '').trim();
  assert(TYPES.has(type), `第 ${questionNumber} 题类型不合法`);

  const title = String(raw.title || '').trim();
  assert(title.length > 0 && title.length <= 200, `第 ${questionNumber} 题标题不能为空`);

  const qid = String(raw.qid || '').trim() || `q${questionNumber}`;
  assert(/^[A-Za-z0-9_-]{1,20}$/.test(qid), `第 ${questionNumber} 题的题号不合法`);

  const question = {
    qid,
    type,
    title,
    required: raw.required === true || raw.required === 'true',
    options: type === 'single' || type === 'multiple' ? normalizeOptions(raw.options, questionNumber) : [],
    constraints: normalizeConstraints(type, raw.constraints),
    jumps: normalizeJumps(type, raw.jumps, questionNumber),
  };

  return question;
}

function normalizeQuestions(rawQuestions) {
  assert(Array.isArray(rawQuestions), 'questions 必须是数组');
  assert(rawQuestions.length <= 100, '题目数量不能超过 100');
  const questions = rawQuestions.map(normalizeQuestion);
  const ids = new Set();
  for (const q of questions) {
    assert(!ids.has(q.qid), `题号重复：${q.qid}`);
    ids.add(q.qid);
  }
  return questions;
}

/**
 * 发布前的完整校验：题目、选项、跳转目标、跳转方向。
 */
function validateForPublish(survey) {
  const errors = [];

  if (!survey.title || !survey.title.trim()) errors.push('问卷标题不能为空');
  if (!Array.isArray(survey.questions) || survey.questions.length === 0) {
    errors.push('至少需要一道题目才能发布');
    return errors;
  }

  const indexById = new Map(survey.questions.map((q, i) => [q.qid, i]));

  survey.questions.forEach((q, i) => {
    const number = i + 1;
    const keys = (q.options || []).map((o) => o.key);

    for (const rule of q.jumps || []) {
      const target = indexById.get(rule.to);
      if (target === undefined) {
        errors.push(`第 ${number} 题的跳转目标 ${rule.to} 不存在`);
        continue;
      }
      if (target <= i) {
        errors.push(`第 ${number} 题的跳转目标 ${rule.to} 必须排在它后面`);
      }
      if (q.type === 'single' && !keys.includes(rule.when.option)) {
        errors.push(`第 ${number} 题的跳转条件选项 ${rule.when.option} 不存在`);
      }
      if (q.type === 'multiple' && !keys.includes(rule.when.includes)) {
        errors.push(`第 ${number} 题的跳转条件选项 ${rule.when.includes} 不存在`);
      }
    }
  });

  return errors;
}

module.exports = {
  generateSlug,
  normalizeQuestions,
  validateForPublish,
  TYPES,
  NUMBER_OPS,
};
