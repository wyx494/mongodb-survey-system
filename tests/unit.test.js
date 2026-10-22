'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { matchRule, computePath } = require('../src/services/jump');
const { validateSubmission } = require('../src/services/validate');
const {
  normalizeQuestions,
  validateForPublish,
  generateSlug,
} = require('../src/services/survey');

function survey(questions) {
  return { title: '测试问卷', questions };
}

const single = {
  qid: 'q1',
  type: 'single',
  title: '单选题',
  required: true,
  options: [
    { key: 'A', label: 'A' },
    { key: 'B', label: 'B' },
    { key: 'C', label: 'C' },
  ],
  constraints: {},
  jumps: [{ when: { option: 'B' }, to: 'q3' }],
};

const multiple = {
  qid: 'q2',
  type: 'multiple',
  title: '多选题',
  required: true,
  options: [
    { key: 'A', label: 'A' },
    { key: 'B', label: 'B' },
    { key: 'C', label: 'C' },
  ],
  constraints: { minSelect: 1, maxSelect: 2 },
  jumps: [],
};

const text = {
  qid: 'q3',
  type: 'text',
  title: '填空题',
  required: false,
  options: [],
  constraints: { minLength: 2, maxLength: 10 },
  jumps: [],
};

test('matchRule：单选/多选/数字条件', () => {
  assert.equal(matchRule({ when: { option: 'A' } }, 'A'), true);
  assert.equal(matchRule({ when: { option: 'A' } }, 'B'), false);
  assert.equal(matchRule({ when: { includes: 'B' } }, ['A', 'B']), true);
  assert.equal(matchRule({ when: { includes: 'C' } }, ['A', 'B']), false);
  assert.equal(matchRule({ when: { op: 'gte', value: 18 } }, 18), true);
  assert.equal(matchRule({ when: { op: 'gte', value: 18 } }, 17), false);
  assert.equal(matchRule({ when: { op: 'between', min: 10, max: 20 } }, 15), true);
  assert.equal(matchRule({ when: { op: 'between', min: 10, max: 20 } }, 9), false);
});

test('computePath：顺序作答与命中跳转', () => {
  const questions = [single, multiple, text];
  assert.deepEqual(computePath(questions, new Map()), ['q1', 'q2', 'q3']);
  assert.deepEqual(computePath(questions, new Map([['q1', 'B']])), ['q1', 'q3']);
  assert.deepEqual(computePath(questions, new Map([['q1', 'A']])), ['q1', 'q2', 'q3']);
});

test('computePath：目标不存在会报错', () => {
  const broken = { ...single, jumps: [{ when: { option: 'A' }, to: 'nope' }] };
  assert.throws(() => computePath([broken], new Map([['q1', 'A']])), /跳转目标不存在/);
});

test('computePath：检测循环跳转', () => {
  const a = {
    qid: 'a', type: 'single', title: 'a', required: true,
    options: [{ key: 'X', label: 'X' }], constraints: {},
    jumps: [{ when: { option: 'X' }, to: 'b' }],
  };
  const b = {
    qid: 'b', type: 'single', title: 'b', required: true,
    options: [{ key: 'X', label: 'X' }], constraints: {},
    jumps: [{ when: { option: 'X' }, to: 'a' }],
  };
  assert.throws(() => computePath([a, b], new Map([['a', 'X'], ['b', 'X']])), /循环跳转/);
});

test('validateSubmission：必答题缺失', () => {
  const result = validateSubmission(survey([single, multiple, text]), [{ qid: 'q1', value: 'A' }]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(''), /必答/);
});

test('validateSubmission：单选题非法选项', () => {
  const result = validateSubmission(survey([single]), [{ qid: 'q1', value: 'X' }]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(''), /选项不存在/);
});

test('validateSubmission：多选题数量限制', () => {
  const questions = [multiple];
  const ok = validateSubmission(survey(questions), [{ qid: 'q2', value: ['A'] }]);
  assert.equal(ok.ok, true);
  const tooMany = validateSubmission(survey(questions), [{ qid: 'q2', value: ['A', 'B', 'C'] }]);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.errors.join(''), /最多/);
});

test('validateSubmission：文本长度限制并自动去空格', () => {
  const result = validateSubmission(survey([text]), [{ qid: 'q3', value: '  hi  ' }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.answers, [{ qid: 'q3', value: 'hi' }]);

  const tooShort = validateSubmission(survey([text]), [{ qid: 'q3', value: 'a' }]);
  assert.equal(tooShort.ok, false);
  assert.match(tooShort.errors.join(''), /至少需要输入/);
});

test('validateSubmission：数字范围与整数校验', () => {
  const number = {
    qid: 'n1', type: 'number', title: '年龄', required: true,
    options: [], constraints: { min: 0, max: 120, integer: true }, jumps: [],
  };
  assert.equal(validateSubmission(survey([number]), [{ qid: 'n1', value: 18 }]).ok, true);
  assert.equal(validateSubmission(survey([number]), [{ qid: 'n1', value: 18.5 }]).ok, false);
  assert.equal(validateSubmission(survey([number]), [{ qid: 'n1', value: 130 }]).ok, false);
  assert.equal(validateSubmission(survey([number]), [{ qid: 'n1', value: '18' }]).ok, false);
});

test('validateSubmission：跳过的题不计入答案，未知题号会报错', () => {
  const questions = [single, multiple, text];
  const result = validateSubmission(survey(questions), [
    { qid: 'q1', value: 'B' },
    { qid: 'q3', value: 'hello' },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.path, ['q1', 'q3']);
  assert.deepEqual(result.answers.map((a) => a.qid), ['q1', 'q3']);

  const unknown = validateSubmission(survey(questions), [{ qid: 'q9', value: 'x' }]);
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join(''), /不存在/);
});

test('normalizeQuestions：整理题目并去重题号', () => {
  const questions = normalizeQuestions([
    {
      qid: 'q1', type: 'single', title: '题目一', required: true,
      options: [{ key: 'A', label: '甲' }, { key: 'B', label: '乙' }],
      constraints: {}, jumps: [{ when: { option: 'B' }, to: 'q2' }],
    },
    { qid: 'q2', type: 'text', title: '题目二', options: [], constraints: { minLength: 1 } },
  ]);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].options.length, 2);
  assert.equal(questions[0].jumps[0].to, 'q2');

  assert.throws(() => normalizeQuestions([questions[0], { ...questions[1], qid: 'q1' }]), /题号重复/);
  assert.throws(
    () => normalizeQuestions([{ qid: 'q1', type: 'single', title: 'x', options: [{ key: 'A', label: 'a' }] }]),
    /至少需要两个选项/
  );
});

test('validateForPublish：目标必须存在且只能向后跳', () => {
  const two = normalizeQuestions([
    { qid: 'q1', type: 'single', title: '一', options: [{ key: 'A', label: 'a' }, { key: 'B', label: 'b' }], jumps: [{ when: { option: 'A' }, to: 'q2' }] },
    { qid: 'q2', type: 'text', title: '二' },
  ]);
  assert.deepEqual(validateForPublish({ title: '标题', questions: two }), []);

  const brokenTarget = normalizeQuestions([
    { qid: 'q1', type: 'single', title: '一', options: [{ key: 'A', label: 'a' }, { key: 'B', label: 'b' }], jumps: [{ when: { option: 'A' }, to: 'q9' }] },
  ]);
  assert.match(validateForPublish({ title: '标题', questions: brokenTarget }).join(''), /不存在/);

  const backward = normalizeQuestions([
    { qid: 'q1', type: 'text', title: '一' },
    { qid: 'q2', type: 'single', title: '二', options: [{ key: 'A', label: 'a' }, { key: 'B', label: 'b' }], jumps: [{ when: { option: 'A' }, to: 'q1' }] },
  ]);
  assert.match(validateForPublish({ title: '标题', questions: backward }).join(''), /必须排在它后面/);
});

test('validateForPublish：空题目不能发布', () => {
  const errors = validateForPublish({ title: '标题', questions: [] });
  assert.match(errors.join(''), /至少需要一道题目/);
});

test('generateSlug：长度和字符集', () => {
  for (let i = 0; i < 20; i += 1) {
    const slug = generateSlug();
    assert.equal(slug.length, 8);
    assert.match(slug, /^[23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]+$/);
  }
});
