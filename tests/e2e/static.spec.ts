import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(() => { expect(errors, `控制台错误：${errors.join(' | ')}`).toEqual([]); });

async function openAssistant(page: Page) {
  const railButton = page.locator('.rail-ai');
  if (await railButton.isVisible()) await railButton.click();
  else await page.locator('.mobile-head button[aria-label="AI 答疑"]').click();
  return page.locator('.assistant-panel');
}
let mock: ReturnType<typeof createServer> | undefined; let mockPort = 0;
test.beforeAll(async () => {
  mock = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    if (request.headers.authorization !== 'Bearer static-test-key') { response.writeHead(401).end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    response.write('data: {"choices":[{"delta":{"content":"这是来自模拟服务的回答。"}}]}\n\n');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => mock!.listen(0, '127.0.0.1', resolve));
  mockPort = (mock.address() as { port: number }).port;
});
test.afterAll(async () => { await new Promise<void>(resolve => mock?.close(() => resolve()) ?? resolve()); });

test('home and tutorial library have a clear path and honest filters', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: /把调色/ })).toBeVisible();
  await expect(page.getByText('今日跟练')).toBeVisible();
  await page.locator('.rail-nav').getByRole('link', { name: '教程' }).click();
  await expect(page.locator('.tutorial-item')).toHaveCount(8);
  await page.getByRole('button', { name: '有配套原片', exact: true }).click();
  await expect(page.locator('.tutorial-item')).toHaveCount(3);
  await page.getByRole('button', { name: '风光', exact: true }).click();
  await expect(page.locator('.tutorial-item')).toHaveCount(2);
  await page.getByRole('button', { name: '全部', exact: true }).first().click();
  await page.getByRole('button', { name: '有配套原片', exact: true }).click();
  await expect(page.locator('.tutorial-item')).toHaveCount(8);
});

test('a tutorial opens to a readable source-first page, and notes/status/favorites persist', async ({ page }) => {
  await page.goto('/#/library/t1');
  await expect(page.getByRole('heading', { name: /HDR Landscape/ })).toBeVisible();
  await expect(page.getByText('审核记录')).toBeVisible();
  await expect(page.getByRole('link', { name: /去作者原站/ })).toHaveAttribute('href', /^https:\/\//);
  const note = page.getByLabel('学习笔记');
  await note.fill('先合并曝光，再决定天空和前景谁更亮。');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByRole('button', { name: '已保存' })).toBeVisible();
  await page.getByRole('button', { name: '在学', exact: true }).click();
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.getByRole('button', { name: '已收藏' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('学习笔记')).toHaveValue('先合并曝光，再决定天空和前景谁更亮。');
  await expect(page.getByText('在学', { exact: true }).first()).toBeVisible();
  await page.goto('/#/notebook');
  await expect(page.getByRole('heading', { name: /HDR Landscape/ })).toBeVisible();
  await expect(page.getByText('先合并曝光，再决定天空和前景谁更亮。')).toBeVisible();
});

test('color atlas filters entries and the HSV relation wheel responds', async ({ page }) => {
  await page.goto('/#/atlas');
  await expect(page.locator('.wheel-hole strong')).toHaveText('30°');
  await page.locator('.wheel-controls input[type=range]').first().evaluate(element => { const input = element as HTMLInputElement; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(input, '200'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('.wheel-hole strong')).toHaveText('200°');
  await expect(page.locator('.atlas-entry')).toHaveCount(12);
  await page.locator('.atlas-index').getByRole('button', { name: /曲线/ }).click();
  await expect(page.locator('.atlas-entry')).toHaveCount(2);
  await page.locator('.atlas-index').getByRole('button', { name: /全部/ }).click();
  await page.getByPlaceholder('搜概念、工具或英文术语').fill('HSL');
  await expect(page.locator('.atlas-entry')).toHaveCount(5);
});

test('discover adds a reference work locally and removes it without touching the source', async ({ page }) => {
  await page.goto('/#/discover');
  await expect(page.locator('.timeline-row')).toHaveCount(12);
  await page.getByLabel('标题').fill('端到端参考作品');
  await page.getByLabel('作品链接').fill('https://example.org/reference-work');
  await page.getByLabel('作者').fill('测试作者');
  await page.getByLabel('我为什么记住它').fill('只记录观察与出处。');
  await page.getByRole('button', { name: '收藏作品' }).click();
  await expect(page.locator('.work-row').getByText('端到端参考作品')).toBeVisible();
  await page.reload();
  await expect(page.locator('.work-row').getByText('端到端参考作品')).toBeVisible();
  await page.getByRole('button', { name: '删除 端到端参考作品' }).click();
  await expect(page.locator('.work-row').getByText('端到端参考作品')).toHaveCount(0);
});

test('settings persist theme, export local data, and do not require a server', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: '浅色纸面' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出数据' }).click();
  expect((await download).suggestedFilename()).toMatch(/color-study-.*\.json/);
});

test('direct AI connection works against a CORS-enabled compatible service', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByLabel('Base URL').fill(`http://127.0.0.1:${mockPort}/v1`);
  await page.getByLabel('模型 ID').fill('mock-model');
  await page.getByLabel('API Key').fill('static-test-key');
  await page.getByLabel('我的模型支持图片输入').check();
  await page.getByRole('button', { name: '保存连接' }).click();
  await expect(page.getByText('已保存 Key')).toBeVisible();
  await page.goto('/#/library/t1');
  const panel = await openAssistant(page);
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlZ8ZkAAAAASUVORK5CYII=', 'base64');
  await panel.locator('input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: pixel });
  await expect(panel.getByText('附图 1')).toBeVisible();
  await panel.getByLabel('你的问题').fill('蓝色更纯净应该先分清什么？');
  await panel.getByRole('button', { name: '发送' }).click();
  await expect(panel.getByText('这是来自模拟服务的回答。')).toBeVisible();
  await expect(panel.getByText('本次带上')).toBeVisible();
});

test('desktop, tablet and 320px layouts do not overflow and keep primary navigation', async ({ page }) => {
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/atlas');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `宽度 ${width} 横向溢出`).toBeLessThanOrEqual(1);
    await expect(page.getByRole('heading', { name: '色彩手册' })).toBeVisible();
    const panel = await openAssistant(page);
    const box = await panel.boundingBox();
    expect(box).not.toBeNull(); expect(box!.width).toBeLessThanOrEqual(width + 1);
    await panel.getByRole('button', { name: '关闭' }).click();
  }
});

test('core static pages remain usable with external network blocked', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: /把调色/ })).toBeVisible();
  await page.goto('/#/library');
  await expect(page.locator('.tutorial-item')).toHaveCount(8);
  await page.goto('/#/atlas');
  await expect(page.getByRole('heading', { name: '色彩手册' })).toBeVisible();
});
