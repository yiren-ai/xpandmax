// Dedicated test Chromium. Never opens or reuses a personal browser profile.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateChromeEvidence } from './extension-evidence.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const liveURL = 'https://x.com/bcherny/status/2111158659971699136';
const output = path.join(root, 'artifacts/browser-tests', live ? 'live' : 'isolated');
await fs.mkdir(output, { recursive: true });
if (live && process.env.XPANDMAX_LIVE_EVIDENCE) {
  const evidence = await validateChromeEvidence(process.env.XPANDMAX_LIVE_EVIDENCE, path.join(root, 'extension'));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: 'passed', mode: evidence.mode, candidateDelivery: evidence.candidateDelivery,
    verifiedAt: evidence.verifiedAt, extensionDigest: evidence.extensionDigest, samples: evidence.samples }, null, 2));
  process.exit(0);
}
const profile = live ? path.join(os.homedir(), '.local/share/xpandmax-test/browser-profile')
  : await fs.mkdtemp(path.join(os.tmpdir(), 'xpandmax-test-'));
if (live) await fs.mkdir(profile, { recursive: true, mode: 0o700 });
const report = { mode: live ? 'real-x-dedicated-session' : 'isolated-extension', startedAt: new Date().toISOString(), checks: [], status: 'running' };
let context;
const check = (name, evidence) => report.checks.push({ name, evidence, status: 'passed' });
async function launch() {
  const extension = path.join(root, 'extension');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', ...(process.env.XPANDMAX_TEST_BROWSER_EXECUTABLE && !live ? { executablePath: process.env.XPANDMAX_TEST_BROWSER_EXECUTABLE } : {}), headless: !live, viewport: { width: 1100, height: 850 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const manifest = await worker.evaluate(() => ({ id: chrome.runtime.id, version: chrome.runtime.getManifest().version }));
  assert.equal(manifest.version, JSON.parse(await fs.readFile(path.join(root, 'extension/manifest.json'), 'utf8')).version);
  report.extension = manifest;
  return manifest.id;
}
try {
  const id = await launch();
  check('actual-extension-loaded', report.extension.version);
  if (live) {
    // No route mocks, copied cookies, injected scripts or fabricated postMessage data.
    const page = await context.newPage();
    let graphqlResponses = 0;
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/i/api/graphql/')) graphqlResponses++;
    });
    try {
      const response = await page.goto(liveURL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      report.navigation = { url: liveURL, status: response?.status() };
      if (!response?.ok()) throw new Error(`X returned HTTP ${response?.status()}`);
      await page.locator('[data-xfc-velocity]').first().waitFor({ timeout: 30000 });
    }
    catch (cause) {
      report.cause = cause.message;
      report.pageModel = { graphqlResponses, authorRows: await page.locator('[data-testid="User-Name"]').count(),
        articleCount: await page.locator('article').count() };
      report.sessionSetup = 'npm run test:browser:login';
      report.status = 'blocked';
      report.reason = 'Real X did not expose the required GraphQL data and velocity badge to the dedicated test session. Anonymous SSR pages are not a positive feature test. Complete the dedicated browser login if needed; this is not a passing live test.';
      await page.screenshot({ path: path.join(output, 'live-blocked.png') }).catch(() => {});
      throw new Error(report.reason);
    }
    const badges = await page.locator('[data-xfc-velocity]').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, title: n.title })));
    assert.ok(badges.length > 0);
    assert.ok(badges.every(b => b.title.includes('发布时间：') && b.title.includes('流速：')));
    check('real-x-rendered-badges', badges);
    await page.screenshot({ path: path.join(output, 'real-x.png') });
  } else {
    const now = Date.now();
    const quoteTime = new Date(now - 7200000).toISOString();
    const fixtureURL = `https://x.com/home?quoteTime=${encodeURIComponent(quoteTime)}`;
    const html = await fs.readFile(path.join(root, 'tests/browser/fixture.html'), 'utf8');
    const tweet = (id, views, hours, extra = {}) => ({ __typename: 'Tweet', rest_id: id,
      views: { state: 'EnabledWithCount', count: String(views) },
      core: { user_results: { result: { core: { screen_name: id === '102' ? 'fixture_quote' : 'fixture_author' }, relationship_counts: { followers: 1234 }, profile_bio: { description: '合成测试简介' } } } },
      legacy: { created_at: new Date(now - hours * 3600000).toUTCString(), favorite_count: 100, retweet_count: 20, reply_count: 5, bookmark_count: 10 }, ...extra });
    // X returns whole-second timestamps. Keep the fixture equally precise.
    const preciseQuoteTime = new Date(new Date(quoteTime).setMilliseconds(0)).toISOString();
    const url = fixtureURL.replace(encodeURIComponent(quoteTime), encodeURIComponent(preciseQuoteTime));
    const payload = { data: [tweet('101', 6000, 1, { quoted_status_result: { result: tweet('102', 44000, 2) } }), { entryId: 'promoted-103', content: tweet('103', 10000, 1) }] };
    const unexpected = [];
    await context.route('**/*', async route => {
      const requestURL = new URL(route.request().url());
      if (requestURL.origin === 'https://x.com' && requestURL.pathname === '/filter-fixture') return route.fulfill({ contentType: 'text/html', body: await fs.readFile(path.join(root, 'tests/browser/filter-fixture.html'), 'utf8') });
      if (requestURL.origin === 'https://x.com' && requestURL.pathname === '/home') return route.fulfill({ contentType: 'text/html', body: html });
      if (requestURL.origin === 'https://x.com' && requestURL.pathname === '/i/api/graphql/fixture/HomeTimeline') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
      if (requestURL.protocol === 'chrome-extension:') return route.continue();
      unexpected.push(requestURL.origin + requestURL.pathname); return route.abort();
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => document.querySelectorAll('[data-xfc-velocity]').length === 2);
    assert.equal(await page.locator('article').nth(1).locator('[data-xfc-velocity]').count(), 0);
    assert.equal(await page.locator('[role="link"] [data-xfc-velocity]').getAttribute('data-tier'), 'viral');
    await page.locator('[data-xfc-inline-profile]').first().waitFor();
    check('manifest-bridge-content-isolated-world', 'Original, linkless quote, profiles and promoted filtering render through the installed extension');
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('#show-tweet-velocity').uncheck();
    await page.waitForFunction(() => !document.querySelector('[data-xfc-velocity]'));
    await popup.locator('#show-tweet-velocity').check();
    await page.waitForFunction(() => document.querySelectorAll('[data-xfc-velocity]').length === 2);
    await popup.locator('#velocity-rising').fill('100');
    await popup.locator('#velocity-viral').fill('500');
    await popup.getByRole('button', { name: '保存阈值' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-xfc-velocity]')].every(n => n.dataset.tier === 'viral'));
    await popup.reload();
    assert.equal(await popup.locator('#velocity-viral').inputValue(), '500');
    check('real-popup-storage-change-and-reload', 'Toggle and thresholds propagate through chrome.storage and persist after popup reload');
    await popup.screenshot({ path: path.join(output, 'popup.png') });
    const second = await context.newPage(); await second.goto(url);
    await second.waitForFunction(() => document.querySelectorAll('[data-xfc-velocity][data-tier="viral"]').length === 2);
    check('second-tab-storage', 'A new X tab reads saved settings');
    await page.locator('#reuse').click();
    await page.waitForFunction(() => !document.querySelector('[data-xfc-velocity]'));
    await page.locator('#restore').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-xfc-velocity]').length === 2);
    check('virtual-list-reuse', 'Old original and quote badges disappear together, then recover without duplicates');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, 'narrow.png') });
    check('narrow-layout', '390px viewport has no horizontal overflow');
    const filterPage = await context.newPage();
    filterPage.on('pageerror', error => errors.push(error.message));
    await filterPage.goto('https://x.com/filter-fixture');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/filter-options.html`);
    await popup.reload();
    assert.equal(await popup.locator('#filter-enabled').isChecked(), false);
    assert.equal(await filterPage.locator('[data-xfc-filter-notice]').count(), 0);
    assert.equal(await filterPage.locator('[data-testid="tweetText"]').isVisible(), true);
    check('filter-default-off', 'Fresh installations preserve the existing timeline until explicitly enabled');
    await popup.locator('#filter-enabled').check();
    await popup.reload();
    assert.equal(await popup.locator('#filter-enabled').isChecked(), true);
    const notice = filterPage.locator('[data-xfc-filter-notice]');
    await notice.waitFor();
    assert.equal(await filterPage.locator('[data-testid="tweetText"]').isVisible(), false);
    await filterPage.screenshot({ path: path.join(output, 'filter-collapsed.png') });
    await notice.getByRole('button', { name: '展开内容', exact: true }).click();
    await filterPage.locator('[data-testid="tweetText"]').waitFor({ state: 'visible' });
    assert.equal(await filterPage.locator('[data-testid="tweetText"]').isVisible(), true);
    await notice.getByRole('button', { name: '重新折叠' }).click();
    await filterPage.locator('[data-testid="tweetText"]').waitFor({ state: 'hidden' });
    assert.equal(await filterPage.locator('[data-testid="tweetText"]').isVisible(), false);
    check('filter-local-collapse-and-expand', 'Enabling folds locally with a reason; expanding restores the original content');
    assert.equal(await options.locator('.rule-row').count(), 13);
    const firstRule = await options.locator('.rule-row input').first().inputValue();
    await options.locator('.rule-row input').first().fill('误修改');
    await options.locator('.rule-row').nth(1).getByRole('button', { name: '删除' }).click();
    await options.getByRole('button', { name: '恢复默认', exact: true }).click();
    assert.equal(await options.locator('.rule-row').count(), 13);
    assert.equal(await options.locator('.rule-row input').first().inputValue(), firstRule);
    await options.locator('#new-keyword').fill('自定义推广');
    await options.getByRole('button', { name: '添加关键词', exact: true }).click();
    await options.getByRole('button', { name: '保存屏蔽设置' }).click();
    await options.reload();
    assert.equal(await options.locator('.rule-row').count(), 14);
    assert.equal(await options.locator('.rule-row input').last().inputValue(), '自定义推广');
    check('filter-edit-and-restore-defaults', 'Individual edits/deletes are restored with original text; a separately added keyword persists');
    await options.locator('#filterWhitelist').fill('@fixture_filter');
    await options.locator('#filterBlacklist').fill('@fixture_filter');
    await options.getByRole('button', { name: '保存屏蔽设置' }).click();
    await options.getByRole('status').filter({ hasText: /请刷新 X 页面/ }).waitFor();
    assert.equal(await filterPage.locator('[data-xfc-filter-notice]').count(), 1);
    await filterPage.reload();
    await filterPage.waitForFunction(() => !document.querySelector('[data-xfc-filter-notice]'));
    await filterPage.waitForTimeout(300);
    assert.equal(await filterPage.locator('[data-xfc-filter-notice]').count(), 0);
    await options.reload();
    assert.equal(await options.locator('#filterWhitelist').inputValue(), 'fixture_filter');
    assert.equal(await options.locator('#filterBlacklist').inputValue(), 'fixture_filter');
    check('filter-whitelist-refresh-and-priority', 'Independent account lists persist; changes take effect after reload and whitelist wins conflicts');
    await options.locator('#filterWhitelist').fill('');
    while (await options.locator('.rule-row').count()) await options.locator('.rule-row').first().getByRole('button', { name: '删除' }).click();
    await options.getByRole('button', { name: '保存屏蔽设置' }).click();
    await options.reload();
    assert.equal(await options.locator('.rule-row').count(), 0);
    await filterPage.reload();
    await filterPage.locator('[data-xfc-filter-notice]').filter({ hasText: /黑名单账号/ }).waitFor();
    check('filter-blacklist-without-content-rules', 'An empty rule list remains empty after reload; blacklist folds the account without keyword matches, entirely locally');
    await options.getByRole('button', { name: '恢复默认', exact: true }).click();
    await options.locator('#filterWhitelist').fill('@trusted_example');
    await options.getByRole('button', { name: '保存屏蔽设置' }).click();
    await options.screenshot({ path: path.join(output, 'filter-settings.png'), fullPage: true });
    await popup.locator('#filter-enabled').uncheck();
    await popup.screenshot({ path: path.join(output, 'popup.png'), fullPage: true });
    await filterPage.waitForFunction(() => !document.querySelector('[data-xfc-filter-notice]'));
    assert.equal(await filterPage.locator('[data-testid="tweetText"]').isVisible(), true);
    check('filter-master-switch-restores-blacklist', 'Disabling restores even a blacklisted account without changing account relationships');
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    check('no-page-errors-or-extra-requests', 'No unexpected request left the synthetic fixture');
  }
  report.status = 'passed';
} catch (error) {
  if (report.status !== 'blocked') report.status = 'failed';
  report.error = error.message;
  process.exitCode = report.status === 'blocked' ? 2 : 1;
} finally {
  await context?.close();
  if (!live) await fs.rm(profile, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
