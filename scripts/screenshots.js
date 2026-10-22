'use strict';

/**
 * 用真实浏览器跑一遍页面，顺便截图放进 docs/screenshots。
 * 需要先启动服务（默认 http://127.0.0.1:3000）。
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:3000';
const shotDir = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

async function shot(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(shotDir, name), fullPage });
  console.log('截图：', name);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' });
  const page = await context.newPage();

  // 登录页
  await page.goto(`${base}/login`);
  await shot(page, '01-login.png');

  // 登录
  await page.fill('input[name="username"]', 'demo');
  await page.fill('input[name="password"]', 'demo123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
  await page.waitForSelector('.survey-item');
  await shot(page, '02-dashboard.png');

  // 问卷 id / slug
  const surveys = await page.evaluate(async () => (await fetch('/api/surveys')).json());
  const published = surveys.surveys.find((s) => s.status === 'published');
  const draft = surveys.surveys.find((s) => s.status === 'draft');
  if (!published) throw new Error('没有已发布问卷，先运行 node scripts/seed.js');
  const surveyId = published._id;
  const slug = published.slug;

  // 编辑页：用草稿问卷，能看到完整的题目、选项和跳转配置
  if (!draft) throw new Error('没有草稿问卷，先运行 node scripts/seed.js');
  await page.goto(`${base}/surveys/${draft._id}/edit`);
  await page.waitForSelector('.question');
  await shot(page, '03-edit.png');
  await page.locator('.jumps').first().scrollIntoViewIfNeeded();
  await shot(page, '03b-edit-jumps.png');

  // 填写页：验证跳转（第 1 题选 D 应直接到第 4 题）
  await page.goto(`${base}/survey/${slug}`);
  await page.waitForSelector('.choice-item');
  await shot(page, '04-fill-q1.png');

  await page.check('input[name="choice"][value="D"]');
  await page.click('#next-btn');
  await page.waitForSelector('h2');
  const heading = (await page.textContent('h2')).trim();
  if (!heading.includes('第 4 题')) {
    throw new Error(`跳转不对，期望第 4 题，实际：${heading}`);
  }
  console.log('跳转验证通过：第 1 题选 D →', heading);
  await shot(page, '05-fill-q4.png');

  // 统计页
  await page.goto(`${base}/surveys/${surveyId}/stats`);
  await page.waitForSelector('.stats-block');
  await shot(page, '06-stats.png');

  await browser.close();
  console.log('全部页面检查通过。');
})().catch((err) => {
  console.error('浏览器检查失败：', err.message);
  process.exit(1);
});
