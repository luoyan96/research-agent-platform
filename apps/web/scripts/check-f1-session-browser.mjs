// F1-01 regression against real B1. Only initial navigation loads a document;
// every logout/relogin/new-plan transition uses the existing tab and app links.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.F1_BASE_URL ?? 'http://127.0.0.1:4175';
const accounts = Object.fromEntries(JSON.parse(await readFile(process.env.F1_CREDENTIALS_FILE ?? '.runtime/f1-01/credentials.json', 'utf8')).map(account => [account.memberId.slice(-1), account]));
const evidence = resolve(process.env.F1_EVIDENCE_DIR ?? '.runtime/f1-01/evidence');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.F1_BROWSER_CHANNEL ?? 'msedge' });
const context = await browser.newContext({ viewport: { width: 1487, height: 1058 } });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const failures = [];
page.on('pageerror', error => failures.push(error.message));
const results = { base, checks: [], viewports: [] };
const check = label => { results.checks.push(label); console.log('PASS ' + label); };
const button = label => page.getByRole('button', { name: label, exact: true });
const input = label => page.getByRole('textbox', { name: label, exact: true });
const visible = text => page.getByText(text, { exact: false }).first().waitFor();
async function login(who) {
  await input('账号').fill(accounts[who].username);
  await input('密码').fill(accounts[who].password);
  await button('登录').click();
  await page.getByRole('heading', { name: '今天，想把什么事情推进一步？' }).waitFor();
}
async function logout() { await button('退出登录').click(); await input('账号').waitFor(); }
async function newFromList() {
  await page.getByRole('navigation').getByRole('link', { name: '实验室任务', exact: true }).click();
  await page.getByRole('link', { name: '手工创建方案', exact: true }).click();
}
async function fillPlan(title) {
  await input('整体目标').fill(title);
  await input('任务标题').fill(title);
  await input('这一项的目标').fill('合成目标');
  await input('交付什么').fill('合成文本');
  await input('怎样算完成').fill('包含合成条目');
}
async function save() {
  await button('保存方案').click();
  await page.waitForURL(/#\/plans\/(?!new)/);
  await visible('确认此版本并安排');
  return page.url();
}
async function expireSession() {
  const auth = await (await context.request.get(base + '/api/v1/auth/session')).json();
  const response = await context.request.post(base + '/api/v1/auth/logout', { headers: { Origin: base, 'X-CSRF-Token': auth.data.csrfToken }, data: {} });
  assert.equal(response.status(), 200); // Revoke the real session without resetting browser JS.
}
async function viewportScreenshot(name) {
  const actual = await page.evaluate(() => ({ innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  results.viewports.push(actual);
  assert.equal(actual.innerWidth, 390);
  assert.equal(actual.innerHeight, 844);
  assert(actual.scrollWidth <= actual.innerWidth);
  await page.screenshot({ path: resolve(evidence, name + '.png'), fullPage: true });
}
try {
  await page.goto(base + '/#/login');
  await login('A'); await newFromList(); await fillPlan('A_UNSAVED_MUST_NOT_LEAK');
  await logout(); await login('A'); await newFromList();
  // This assertion fails on 0d950cb: editor is undefined while editorRoute is /plans/new.
  await input('整体目标').waitFor();
  assert.equal(await input('整体目标').inputValue(), '');
  await fillPlan('F1-01 同账号重新登录后保存');
  const savedUrl = await save();
  await page.screenshot({ path: resolve(evidence, 'same-account-saved.png'), fullPage: true });
  check('同标签页 A 退出重登，经列表新建并保存；旧草案已清除');

  await newFromList(); await fillPlan('A_PRIVATE_UNSAVED');
  await logout(); await login('B'); await newFromList();
  assert.equal(await input('整体目标').inputValue(), '');
  assert.equal(await input('任务标题').inputValue(), '');
  assert(!(await page.locator('main').innerText()).includes('A_PRIVATE_UNSAVED'));
  await page.setViewportSize({ width: 390, height: 844 });
  await viewportScreenshot('different-account-mobile');
  check('A → B 重登没有旧方案；实际 DOM viewport=390×844，无页面横向溢出');
  await page.setViewportSize({ width: 1487, height: 1058 });

  await logout(); await login('A');
  // Hash-only navigation intentionally preserves the JS document and context.
  await page.evaluate(hash => { location.hash = hash; }, new URL(savedUrl).hash);
  await visible('版本 1'); await input('整体目标').fill('F1-01 已保存方案重新编辑');
  await button('保存方案').click(); await visible('版本 2');
  await button('确认此版本并安排').click(); await visible('方案已确认');
  await page.screenshot({ path: resolve(evidence, 'saved-plan-confirmed.png'), fullPage: true });
  check('已保存方案重新打开、编辑到 v2、确认成功');

  await newFromList(); await fillPlan('F1-01 失效会话保留的同账号草案');
  await expireSession(); await button('保存方案').click(); await visible('UNAUTHENTICATED');
  await login('A'); await newFromList();
  assert.equal(await input('整体目标').inputValue(), 'F1-01 失效会话保留的同账号草案');
  await button('保存方案').click(); await visible('PENDING_INTENT');
  await button('重试同一请求').click(); await page.waitForURL(/#\/plans\/(?!new)/);
  await visible('确认此版本并安排');
  check('写请求遇真实会话失效：同账号保留编辑与原请求并可重试保存');

  await newFromList(); await fillPlan('A_EXPIRED_PRIVATE');
  await expireSession(); await button('保存方案').click(); await visible('UNAUTHENTICATED');
  await login('B'); await newFromList();
  assert.equal(await input('整体目标').inputValue(), '');
  await fillPlan('F1-01 B 独立方案'); await save();
  check('失效后登录 B：A 的草案/未决请求清除，B 可独立保存');

  await newFromList(); await fillPlan('B_READ_EXPIRED'); await expireSession();
  await page.getByRole('navigation').getByRole('link', { name: '实验室任务', exact: true }).click();
  await visible('UNAUTHENTICATED'); await login('B'); await newFromList();
  assert.equal(await input('整体目标').inputValue(), 'B_READ_EXPIRED');
  check('读取遇会话失效：同账号重新认证后保留完整编辑上下文');
  assert.deepEqual(failures, []);
  check('无未捕获页面异常');
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify(results, null, 2));
} catch (error) {
  if (await button('读取最新状态').isVisible()) {
    await button('读取最新状态').click();
    await visible('暂时无法读取');
  }
  await page.screenshot({ path: resolve(evidence, 'regression-failure.png'), fullPage: true });
  await writeFile(resolve(evidence, 'failure.txt'), await page.locator('main').innerText());
  throw error;
} finally { await browser.close(); }
