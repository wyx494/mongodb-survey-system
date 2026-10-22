'use strict';

/**
 * 答案校验。
 *
 * 前端也会做一遍提示，但真正说了算的是这里：
 * 服务端从第一题重新走一遍跳转路径，只校验路径上的题目。
 */
const { computePath } = require('./jump');

function isBlank(value) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function optionKeys(question) {
  return (question.options || []).map((o) => o.key);
}

function checkConstraints(question, value) {
  const c = question.constraints || {};

  if (question.type === 'multiple') {
    const list = value;
    if (c.exactSelect != null && list.length !== c.exactSelect) {
      return `需要正好选择 ${c.exactSelect} 个选项`;
    }
    if (c.minSelect != null && list.length < c.minSelect) {
      return `至少需要选择 ${c.minSelect} 个选项`;
    }
    if (c.maxSelect != null && list.length > c.maxSelect) {
      return `最多只能选择 ${c.maxSelect} 个选项`;
    }
  }

  if (question.type === 'text') {
    const length = value.length;
    if (c.minLength != null && length < c.minLength) {
      return `至少需要输入 ${c.minLength} 个字`;
    }
    if (c.maxLength != null && length > c.maxLength) {
      return `最多只能输入 ${c.maxLength} 个字`;
    }
  }

  if (question.type === 'number') {
    if (c.integer === true && !Number.isInteger(value)) {
      return '必须填写整数';
    }
    if (c.min != null && value < c.min) {
      return `不能小于 ${c.min}`;
    }
    if (c.max != null && value > c.max) {
      return `不能大于 ${c.max}`;
    }
  }

  return null;
}

/**
 * 校验单个答案，返回错误文案或 null。
 */
function validateAnswer(question, value) {
  if (question.type === 'single') {
    if (typeof value !== 'string') return '答案格式不正确';
    if (!optionKeys(question).includes(value)) return '选项不存在';
    return null;
  }

  if (question.type === 'multiple') {
    if (!Array.isArray(value)) return '答案格式不正确';
    if (value.some((v) => typeof v !== 'string')) return '答案格式不正确';
    if (new Set(value).size !== value.length) return '选项不能重复';
    const keys = optionKeys(question);
    if (value.some((v) => !keys.includes(v))) return '选项不存在';
    return checkConstraints(question, value);
  }

  if (question.type === 'text') {
    if (typeof value !== 'string') return '答案格式不正确';
    return checkConstraints(question, value);
  }

  if (question.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '必须填写数字';
    return checkConstraints(question, value);
  }

  return '未知题型';
}

/**
 * 校验整份答卷。
 * @returns {{ok: boolean, errors: string[], answers: Array, path: string[]}}
 */
function validateSubmission(survey, rawAnswers) {
  const errors = [];

  if (!Array.isArray(rawAnswers)) {
    return { ok: false, errors: ['answers 必须是数组'], answers: [], path: [] };
  }

  const answersMap = new Map();
  for (const item of rawAnswers) {
    if (!item || typeof item.qid !== 'string') {
      errors.push('答案格式不正确');
      continue;
    }
    if (answersMap.has(item.qid)) {
      errors.push(`题目 ${item.qid} 重复作答`);
      continue;
    }
    answersMap.set(item.qid, item.value);
  }

  const questionIds = new Set(survey.questions.map((q) => q.qid));
  for (const qid of answersMap.keys()) {
    if (!questionIds.has(qid)) errors.push(`题目 ${qid} 不存在`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, answers: [], path: [] };
  }

  let path;
  try {
    path = computePath(survey.questions, answersMap);
  } catch (err) {
    return { ok: false, errors: [err.message], answers: [], path: [] };
  }

  const byId = new Map(survey.questions.map((q) => [q.qid, q]));
  const normalized = [];

  for (const qid of path) {
    const question = byId.get(qid);
    const number = survey.questions.indexOf(question) + 1;
    const value = answersMap.get(qid);

    if (isBlank(value)) {
      if (question.required) {
        errors.push(`第 ${number} 题「${question.title}」是必答题`);
      }
      continue;
    }

    const message = validateAnswer(question, value);
    if (message) {
      errors.push(`第 ${number} 题「${question.title}」${message}`);
      continue;
    }

    const finalValue =
      question.type === 'text' ? value.trim() : question.type === 'multiple' ? [...new Set(value)] : value;
    normalized.push({ qid, value: finalValue });
  }

  return { ok: errors.length === 0, errors, answers: normalized, path };
}

module.exports = { validateAnswer, validateSubmission, isBlank };
