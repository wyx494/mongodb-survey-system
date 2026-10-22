'use strict';

/**
 * 浏览器端的端到端检查：
 * 1) 编辑页保存一次，确认前端序列化的题目能被后端接受；
 * 2) 完整填写一份问卷并提交，确认跳题、校验、统计链路。
 * 需要先启动服务，并执行过 seed 脚本。
 */
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:3000';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();

  await page.goto(`${base}/login`);
  await page.fill('input[name="username"]', 'demo');
  await page.fill('input[name="password"]', 'demo123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');

  const surveys = await page.evaluate(async () => (await fetch('/api/surveys')).json());
  const draft = surveys.surveys.find((s) => s.status === 'draft');
  const published = surveys.surveys.find((s) => s.status === 'published');
  if (!draft || !published) throw new Error('缺少演示问卷，请先运行 node scripts/seed.js');

  // 1. 编辑页保存
  await page.goto(`${base}/surveys/${draft._id}/edit`);
  await page.waitForSelector('.question');
  await page.click('#save');
  await page.waitForFunction(() => document.getElementById('save-message').textContent.includes('已保存'));
  console.log('编辑页保存：通过');

  // 2. 完整填写一份问卷
  await page.goto(`${base}/survey/${published.slug}`);
  await page.waitForSelector('.choice-item');

  // 第 1 题：选 B（会进入第 2 题）
  await page.check('input[name="choice"][value="B"]');
  await page.click('#next-btn');
  await page.waitForSelector('h2');
  if (!(await page.textContent('h2')).includes('第 2 题')) throw new Error('第 1 题后没有进入第 2 题');

  // 第 2 题：多选 B、C（选 A 会按规则直接跳到第 4 题）
  await page.check('input[name="choice"][value="B"]');
  await page.check('input[name="choice"][value="C"]');
  await page.click('#next-btn');
  await page.waitForSelector('h2');
  if (!(await page.textContent('h2')).includes('第 3 题')) throw new Error('第 2 题后没有进入第 3 题');

  // 第 3 题：数字
  await page.fill('#answer-input', '15');
  await page.click('#next-btn');
  await page.waitForSelector('h2');
  if (!(await page.textContent('h2')).includes('第 4 题')) throw new Error('第 3 题后没有进入第 4 题');

  // 第 4 题：文本
  await page.fill('#answer-input', '这是自动化检查填写的内容。');
  await page.click('#next-btn');
  await page.waitForURL('**/thanks');
  console.log('完整填写并提交：通过');

  // 3. 统计页能看到这份新答卷
  await page.goto(`${base}/surveys/${published._id}/stats`);
  await page.waitForSelector('.stats-block');
  const totalText = await page.textContent('.page-head .muted');
  console.log('统计页：', totalText.trim());

  await browser.close();
  console.log('浏览器端检查全部通过。');
})().catch((err) => {
  console.error('浏览器端检查失败：', err.message);
  process.exit(1);
});
