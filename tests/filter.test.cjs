const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(`extension/${name}.js`, 'utf8');
const tick = () => new Promise(r => setTimeout(r, 60));
const post = (handle = 'alice', id = '101', body = '在线博彩 注册', quote = '') => `<article><div data-testid="User-Name"><a href="/${handle}">${handle}</a><a href="/${handle}/status/${id}"><time>now</time></a></div><div data-testid="tweetText">${body}</div>${quote}</article>`;
function rules() { const context = {}; vm.runInNewContext(source('filter-rules'), context); return context.xpandmaxFilterRules; }
const match = (r, text, bio = '', handle = 'alice', config = {}) => r.match(text, bio, handle, { filterEnabled: true, ...config });
function setup(html = post(), saved = { filterEnabled: true }, deferred = false) {
  const dom = new JSDOM(html, { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, observers = [], NativeObserver = w.MutationObserver;
  w.MutationObserver = class extends NativeObserver { constructor(fn) { super(fn); observers.push(this); } };
  const close = w.close.bind(w); w.close = () => { observers.forEach(o => o.disconnect()); close(); };
  let config = { ...saved }, listener, finishLoad;
  const profiles = {}, requests = [];
  w.fetch = (...args) => { requests.push(args); throw new Error('Content filtering must not fetch'); };
  w.chrome = { runtime: { sendMessage() { throw new Error('Content filtering must not ask the background to act'); } }, storage: {
    local: {
      get(defaults, callback) { const result = { ...defaults, ...config }; if (callback) { finishLoad = () => callback(result); if (!deferred) finishLoad(); } else return Promise.resolve(result); },
      async set(values) { config = { ...config, ...values }; listener(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local'); }
    }, onChanged: { addListener(fn) { listener = fn; } }
  } };
  w.xpandmaxProfiles = { get: handle => profiles[handle] || {} };
  w.eval(source('filter-rules')); w.eval(source('filter'));
  return { dom, w, profiles, requests, saved: () => config, finishLoad: () => finishLoad(), change: values => w.chrome.storage.local.set(values) };
}

test('总开关默认关闭，遗留自动拉黑配置不进入首版设置', () => {
  const r = rules();
  assert.equal(r.defaults.filterEnabled, false);
  assert.equal(r.match('在线博彩', '', 'alice', {}), null);
  assert.equal('filterAutoBlock' in r.settings({ filterAutoBlock: true }), false);
  assert.equal(r.validate(r.defaultRules), '');
});

test('统一规则覆盖句式、全角与零宽文字，自定义关键词按字面匹配', () => {
  const r = rules();
  for (const text of ['约炮', '裸照流出', '黑丝写真', '主页来✈️', '去找我✈️', '电报福利频道', '约P平台', '🔞联系我', '全网独创线下匹配', '联系我直接点击大号', '小号已禁言', '澳门线上赌场', 't.me 福利资源', 'ＯＮＬＩＮＥ ＣＡＳＩＮＯ', '裸\u200b聊']) assert.ok(match(r, text), text);
  assert.equal(match(r, '普通新闻 赌博 色情 反诈 科普'), null);
  assert.equal(match(r, '裸聊', '', 'alice', { filterRules: [] }), null);
  assert.equal(match(r, 'a.*b', '', 'alice', { filterRules: [{ kind: 'keyword', value: 'a.*b' }] }).keyword, 'a.*b');
  assert.equal(match(r, 'axxb', '', 'alice', { filterRules: [{ kind: 'keyword', value: 'a.*b' }] }), null);
  assert.equal(match(r, '', '裸聊').source, '简介');
});

test('正则拒绝空分支、残缺括号、无上限重复与复杂模式，有限匹配不回溯', () => {
  const r = rules();
  for (const value of ['(约炮|)', '(约炮', 'a*', 'a+', 'a{0,}', '(a)?', 'a{0,41}', '(?=a)', '(a{40}){40}']) assert.notEqual(r.validate([{ kind: 'pattern', value }]), '', value);
  const check = r.compile({ kind: 'pattern', value: '🔞.{0,40}(私聊|主页)' });
  assert.equal(check('🔞' + '甲'.repeat(40) + '私聊'), true);
  assert.equal(check('🔞' + '甲'.repeat(41) + '私聊'), false);
  assert.equal(r.compile({ kind: 'pattern', value: 'a?'.repeat(80) + 'b' })('a'.repeat(1000)), false);
});

test('旧版自定义词合并，保存空列表不自动回填默认规则', () => {
  const r = rules(), migrated = r.settings({ filterAdultKeywords: '旧词甲', filterGamblingKeywords: '旧词乙' });
  assert.ok(migrated.filterRules.some(x => x.value === '旧词甲'));
  assert.ok(match(r, '旧词乙', '', 'alice', { ...migrated, filterEnabled: true }));
  assert.equal(r.settings({ filterRules: [] }).filterRules.length, 0);
});

test('命中展示原因，展开完整恢复正文，重新折叠不执行任何请求', async () => {
  const { w, dom, requests } = setup();
  try {
    await tick(); const article = w.document.querySelector('article'), body = article.querySelector('[data-testid="tweetText"]');
    assert.equal(article.dataset.xfcFiltered, 'true');
    assert.match(article.querySelector('[data-xfc-filter-notice]').textContent, /正文匹配/);
    const button = article.querySelector('[data-xfc-filter-notice] button');
    button.click(); await tick(); assert.equal(article.dataset.xfcFiltered, 'false');
    assert.equal(article.querySelector('[data-testid="tweetText"]'), body);
    button.click(); await tick(); assert.equal(article.dataset.xfcFiltered, 'true');
    assert.equal(requests.length, 0);
  } finally { dom.window.close(); }
});

test('默认不折叠；总开关和规则增删改跨标签设置事件即时生效', async () => {
  const { w, dom, change } = setup(post(), {});
  try {
    await tick(); const article = w.document.querySelector('article');
    assert.equal(article.hasAttribute('data-xfc-filtered'), false);
    await change({ filterEnabled: true }); await tick(); assert.equal(article.dataset.xfcFiltered, 'true');
    await change({ filterRules: [] }); await tick(); assert.equal(article.hasAttribute('data-xfc-filtered'), false);
    await change({ filterRules: [{ kind: 'keyword', value: '注册' }] }); await tick(); assert.equal(article.dataset.xfcFiltered, 'true');
    await change({ filterRules: [{ kind: 'keyword', value: '别的文字' }] }); await tick(); assert.equal(article.hasAttribute('data-xfc-filtered'), false);
    await change({ filterEnabled: false }); await tick(); assert.equal(article.hasAttribute('data-xfc-filtered'), false);
  } finally { dom.window.close(); }
});

test('简介异步到达可折叠；引用正文不归罪外层作者；动态加载与节点复用清理旧提示', async () => {
  const quote = '<div role="link"><div data-testid="User-Name">@quote</div><div data-testid="tweetText">裸聊</div></div>';
  const { w, dom, profiles } = setup(post('alice', '101', '普通正文', quote));
  try {
    await tick(); assert.equal(w.document.querySelector('[data-xfc-filter-notice]'), null);
    profiles.alice = { bio: '裸聊' }; w.dispatchEvent(new w.Event('xpandmax:profiles')); await tick();
    assert.match(w.document.querySelector('[data-xfc-filter-notice]').textContent, /简介匹配/);
    const article = w.document.querySelector('article');
    article.innerHTML = post('bob', '102', '普通正文').replace(/^<article>|<\/article>$/g, ''); await tick();
    assert.equal(article.hasAttribute('data-xfc-filtered'), false);
    w.document.body.insertAdjacentHTML('beforeend', post('carol', '103')); await tick();
    assert.equal(w.document.querySelectorAll('[data-xfc-filter-notice]').length, 1);
    assert.match(w.document.querySelector('[data-xfc-filter-notice]').textContent, /@carol/);
  } finally { dom.window.close(); }
});

test('黑名单仅折叠、白名单优先，名单保存后刷新生效，快捷信任立即恢复当前页', async () => {
  const r = rules();
  assert.equal(match(r, '普通正文', '', 'alice', { filterBlacklist: '@Alice', filterRules: [] }).source, '黑名单');
  assert.equal(match(r, '裸聊', '', 'alice', { filterBlacklist: '@Alice', filterWhitelist: '@ALICE' }), null);
  const current = setup(post('alice', '101', '普通正文'));
  try {
    await tick(); await current.change({ filterBlacklist: '@ALICE' }); await tick();
    assert.equal(current.w.document.querySelector('[data-xfc-filter-notice]'), null);
    const fresh = setup(post('alice', '101', '普通正文'), current.saved());
    try {
      await tick(); assert.match(fresh.w.document.querySelector('[data-xfc-filter-notice]').textContent, /黑名单账号/);
      fresh.w.document.querySelectorAll('[data-xfc-filter-notice] button')[1].click(); await tick();
      assert.equal(fresh.w.document.querySelector('[data-xfc-filter-notice]'), null);
      assert.equal((await fresh.w.chrome.storage.local.get({})).filterWhitelist, 'alice');
      assert.equal(fresh.requests.length, 0);
    } finally { fresh.dom.window.close(); }
  } finally { current.dom.window.close(); }
});

test('初始名单晚返回不丢失白名单，也不覆盖较新的开关', async () => {
  const current = setup(post(), { filterWhitelist: '@alice' }, true);
  try {
    await current.change({ filterEnabled: true }); await tick();
    assert.equal(current.w.document.querySelector('[data-xfc-filter-notice]'), null);
    current.finishLoad(); await tick(); assert.equal(current.w.document.querySelector('[data-xfc-filter-notice]'), null);
  } finally { current.dom.window.close(); }
});

test('设置页规则增删改、恢复默认保留名单、保存校验与失败恢复；没有账号动作开关', () => {
  const dom = new JSDOM(fs.readFileSync('extension/filter-options.html', 'utf8'), { runScripts: 'outside-only' });
  const w = dom.window, writes = [];
  w.chrome = { runtime: {}, storage: { local: { get: (d, fn) => fn(d), set: (v, fn) => { writes.push(v); fn(); } } } };
  try {
    w.eval(source('filter-rules')); w.eval(source('filter-options'));
    const form = w.document.querySelector('form'), list = w.document.querySelector('#rule-list'), white = w.document.querySelector('#filterWhitelist');
    assert.equal(w.document.querySelector('#filterEnabled'), null);
    assert.equal(w.document.querySelector('#filterAutoBlock'), null);
    const original = list.firstElementChild.querySelector('input').value;
    list.firstElementChild.querySelector('input').value = '改写'; list.children[1].querySelector('button').click();
    white.value = '@Alice'; w.document.querySelector('#filterBlacklist').value = '@Bob';
    w.document.querySelector('#restore-defaults').click(); assert.equal(list.children.length, 13);
    assert.equal(list.firstElementChild.querySelector('input').value, original); assert.equal(white.value, '@Alice');
    w.document.querySelector('#new-keyword').value = '自定义推广'; w.document.querySelector('#add-keyword').click(); assert.equal(list.children.length, 14);
    white.value = 'https://x.com/foo'; form.dispatchEvent(new w.Event('submit', { cancelable: true })); assert.equal(writes.length, 0);
    white.value = '@Alice\nBOB'; form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    assert.equal(writes[0].filterWhitelist, 'alice\nbob'); assert.equal(writes[0].filterBlacklist, 'bob');
    assert.equal(writes[0].filterRules.at(-1).value, '自定义推广'); assert.equal('filterAutoBlock' in writes[0], false);
    assert.match(w.document.querySelector('#status').textContent, /重叠账号按白名单/);
    w.chrome.storage.local.set = (v, fn) => { w.chrome.runtime.lastError = {}; fn(); delete w.chrome.runtime.lastError; };
    form.dispatchEvent(new w.Event('submit', { cancelable: true })); assert.match(w.document.querySelector('#status').textContent, /保存失败/); assert.equal(white.disabled, false);
  } finally { dom.window.close(); }
});

test('过滤运行文件无后台动作、网络请求或原生菜单点击路径；站点权限与上游一致', () => {
  for (const name of ['filter', 'filter-rules', 'filter-options']) assert.doesNotMatch(source(name), /fetch\s*\(|XMLHttpRequest|sendMessage|chrome\.storage\.session/);
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json'));
  assert.equal(manifest.background.service_worker, 'translation-background.js');
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.content_scripts.flatMap(x => x.js).includes('block.js'), false);
  assert.equal(fs.existsSync('extension/block.js'), false);
  assert.equal(fs.existsSync('extension/block-background.js'), false);
});
