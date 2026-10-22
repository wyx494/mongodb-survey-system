'use strict';

/**
 * 跳转引擎。
 *
 * 规则存在题目的 jumps 数组里，形如：
 *   单选  { when: { option: 'A' }, to: 'q5' }
 *   多选  { when: { includes: 'A' }, to: 'q3' }
 *   数字  { when: { op: 'gte', value: 60 }, to: 'q6' }
 *
 * 一道题可以有多条规则，按顺序匹配，命中第一条就跳；
 * 一条都没命中就走下一题。整个过程不依赖任何写死的题号。
 */

function matchRule(rule, answer) {
  if (!rule || !rule.when) return false;
  const when = rule.when;

  if (typeof answer === 'string') {
    return typeof when.option === 'string' && answer === when.option;
  }
  if (Array.isArray(answer)) {
    return typeof when.includes === 'string' && answer.includes(when.includes);
  }
  if (typeof answer === 'number' && Number.isFinite(answer)) {
    switch (when.op) {
      case 'eq':
        return answer === when.value;
      case 'neq':
        return answer !== when.value;
      case 'gt':
        return answer > when.value;
      case 'gte':
        return answer >= when.value;
      case 'lt':
        return answer < when.value;
      case 'lte':
        return answer <= when.value;
      case 'between':
        return answer >= when.min && answer <= when.max;
      default:
        return false;
    }
  }
  return false;
}

/**
 * 根据已作答内容计算实际经过的题目顺序。
 * @param {Array} questions 题目数组（顺序即默认作答顺序）
 * @param {Map<string, any>} answers qid -> 答案
 * @returns {string[]} 题号路径
 */
function computePath(questions, answers) {
  const indexById = new Map(questions.map((q, i) => [q.qid, i]));
  const path = [];
  const visited = new Set();
  let index = 0;

  while (index >= 0 && index < questions.length) {
    const question = questions[index];
    if (visited.has(question.qid)) {
      throw new Error(`检测到循环跳转：${question.qid}`);
    }
    visited.add(question.qid);
    path.push(question.qid);

    const answer = answers.get(question.qid);
    const rule = (question.jumps || []).find((r) => matchRule(r, answer));

    if (rule) {
      const target = indexById.get(rule.to);
      if (target === undefined) throw new Error(`跳转目标不存在：${rule.to}`);
      index = target;
    } else {
      index += 1;
    }
  }

  return path;
}

module.exports = { matchRule, computePath };
