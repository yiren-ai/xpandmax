const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 40));
const author = id => `<div data-testid="User-Name"><a href="/demo/status/${id}"><time>1h</time></a></div>`;

test('UserName author rows retain velocity badges on timelines and detail pages', async () => {
  const t = setup(`<article>${author('1').replace('User-Name', 'UserName')}</article><article><div data-testid="UserName"><a href="/demo">Main author</a></div><a href="/demo/status/2"><time>1h</time></a></article>`);
  try {
    t.w.history.replaceState({}, '', '/demo/status/2');
    send(t.w, [record('1'), record('2')]);
    await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 2);
  } finally { t.dom.window.close(); }
});
function setup(html = author('1'), saved = {}, late = false) {
  const dom = new JSDOM(html, { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const observers = [];
  const NativeObserver = w.MutationObserver;
  w.MutationObserver = class extends NativeObserver { constructor(cb) { super(cb); observers.push(this); } };
  const close = w.close.bind(w);
  w.close = () => { observers.forEach(observer => observer.disconnect()); close(); };
  let listener, finish;
  w.chrome = { runtime: {}, storage: { local: { get(defaults, cb) { finish = () => cb({ ...defaults, ...saved }); if (!late) finish(); } }, onChanged: { addListener(cb) { listener = cb; } } } };
  w.postMessage = data => w.dispatchEvent(new w.MessageEvent('message', { data, origin: w.location.origin, source: w }));
  w.eval(fs.readFileSync('extension/velocity.js', 'utf8'));
  return { dom, w, finish: () => finish(), change(values) { listener(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { newValue: v }])), 'local'); } };
}
const record = (id, overrides = {}) => ({ id, valid: true, observedAt: Date.now(), createdAt: Date.now() - 3600000, views: 10000, likes: 100, reposts: 10, replies: 5, bookmarks: 3, ...overrides });
function send(w, tweets, origin = w.location.origin) { w.dispatchEvent(new w.MessageEvent('message', { data: { channel: 'x-follower-count-v1', type: 'tweets', tweets }, origin, source: w })); }
function bridgeSetup() {
  const { dom, w } = setup(author('1') + author('2') + author('3'));
  const messages = [];
  w.addEventListener('message', event => { if (event.data.type === 'tweets') messages.push(...event.data.tweets); });
  let response;
  w.fetch = () => Promise.resolve({ ok: true, url: 'https://x.com/i/api/graphql/abc/HomeTimeline', clone: () => ({ json: () => Promise.resolve(response) }) });
  w.eval(fs.readFileSync('extension/bridge.js', 'utf8'));
  return { dom, w, messages, async receive(value) { response = value; await w.fetch('/ignored'); await tick(); } };
}
const tweet = (id, extra = {}) => ({ __typename: 'Tweet', rest_id: id, views: { state: 'EnabledWithCount', count: '10000' }, legacy: { created_at: new Date(Date.now() - 3600000).toUTCString(), favorite_count: 100, retweet_count: 10, reply_count: 5, bookmark_count: 3 }, ...extra });

test('bridge extracts original and quoted tweet IDs, excludes promoted/missing/disabled/invalid counts, does not mutate response', async () => {
  const t = bridgeSetup();
  try {
    const payload = { timeline: [tweet('1', { quoted_status_result: { result: tweet('2') } }), { entryId: 'promoted-3', content: tweet('3') }, tweet('4', { views: { state: 'Disabled', count: '42' } }), tweet('5', { views: { state: 'EnabledWithCount', count: '-1' } })] };
    const before = JSON.stringify(payload);
    await t.receive(payload);
    assert.equal(JSON.stringify(payload), before);
    assert.deepEqual(t.messages.filter(x => x.valid).map(x => x.id).sort(), ['1', '2']);
    assert.deepEqual(t.messages.filter(x => !x.valid).map(x => x.id).sort(), ['3', '4', '5']);
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 2);
    t.messages.length = 0;
    t.w.postMessage({ channel: 'x-follower-count-v1', type: 'ready' });
    assert.equal(t.messages.length, 5);
    await t.receive({ promotedMetadata: {}, result: tweet('1') });
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 1);
  } finally { t.dom.window.close(); }
});

test('six minute floor, zero views, missing interaction fields and bounded score remain explicit', async () => {
  const t = setup(author('1') + author('2'));
  try {
    send(t.w, [record('1', { views: 5000, createdAt: Date.now(), likes: 1000, reposts: 1000, replies: 1000, bookmarks: 1000 }), record('2', { views: 0, bookmarks: undefined })]);
    await tick();
    const badges = t.w.document.querySelectorAll('[data-xfc-velocity]');
    assert.equal(badges[0].textContent, '50,000/小时');
    assert.equal(badges[0].dataset.tier, 'viral');
    assert.match(badges[0].title, /爆帖指数：100.0\/100/);
    assert.equal(badges[1].textContent, '0/小时');
    assert.match(badges[1].title, /收藏：—/);
    assert.match(badges[1].title, /互动字段不完整/);
  } finally { t.dom.window.close(); }
});

test('quote mapping, DOM reuse, settings changes and invalid timestamps remove stale badges', async () => {
  const t = setup(`<article>${author('1')}<div role="link">${author('2')}</div></article>`);
  try {
    send(t.w, [record('1', { views: 500 }), record('2', { views: 5000 })]);
    await tick();
    let badges = t.w.document.querySelectorAll('[data-xfc-velocity]');
    assert.deepEqual([...badges].map(x => x.dataset.tier), ['normal', 'rising']);
    t.change({ velocityRisingThreshold: 100, velocityViralThreshold: 1000 });
    await tick();
    assert.deepEqual([...badges].map(x => x.dataset.tier), ['rising', 'viral']);
    t.w.document.querySelector('a').href = '/demo/status/999';
    await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 1);
    t.change({ showTweetVelocity: false }); await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 0);
    t.change({ showTweetVelocity: true }); await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 1);
    send(t.w, [record('2', { valid: false })]); await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 0);
    send(t.w, [record('2', { observedAt: Date.now() - 1800001 })]);
    send(t.w, [record('2', { createdAt: Date.now() + 100000 })]);
    send(t.w, [record('2')], 'https://evil.example'); await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 0);
  } finally { t.dom.window.close(); }
});

test('late settings read cannot override toggle, invalid thresholds fall back, timer expires records', async () => {
  const t = setup(author('1'), { showTweetVelocity: true }, true);
  try {
    t.change({ showTweetVelocity: false }); t.finish();
    send(t.w, [record('1')]); await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 0);
    t.change({ showTweetVelocity: true, velocityRisingThreshold: -1, velocityViralThreshold: 0 });
    send(t.w, [record('1', { views: 5000 })]); await tick();
    assert.equal(t.w.document.querySelector('[data-xfc-velocity]').dataset.tier, 'rising');
    const now = Date.now(); t.w.Date.now = () => now + 1800001;
    t.w.dispatchEvent(new t.w.PopStateEvent('popstate')); await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 0);
  } finally { t.dom.window.close(); }
});

test('popup rejects reversed and nonpositive thresholds and stores valid pair atomically', () => {
  const dom = new JSDOM(fs.readFileSync('extension/popup.html', 'utf8'), { runScripts: 'outside-only' });
  const w = dom.window, writes = [];
  w.chrome = { runtime: {}, storage: { local: { get(defaults, cb) { cb(defaults); }, set(values, cb) { writes.push(values); cb(); } } } };
  try {
    w.eval(fs.readFileSync('extension/popup.js', 'utf8'));
    const low = w.document.querySelector('#velocity-rising'), high = w.document.querySelector('#velocity-viral');
    const submit = () => w.document.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    low.value = '100'; high.value = '50'; submit(); assert.equal(writes.length, 0);
    low.value = '0'; high.value = '50'; submit(); assert.equal(writes.length, 0);
    low.value = '500'; high.value = '5000'; submit();
    assert.equal(JSON.stringify(writes), '[{"velocityRisingThreshold":500,"velocityViralThreshold":5000}]');
  } finally { dom.window.close(); }
});

test('real X quote cards without links use explicit quoted ID and matching timestamp', async () => {
  const createdAt = Date.now() - 3600000;
  const t = setup(`<article>${author('1')}<div role="link"><div data-testid="User-Name"><span>quoted author</span><div><time datetime="${new Date(createdAt).toISOString()}">1h</time></div></div></div></article>`);
  try {
    send(t.w, [record('1', { quotedId: '2', valid: false }), record('2', { createdAt, views: 5000 })]);
    await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 1);
    assert.equal(t.w.document.querySelector('[role="link"] [data-xfc-velocity]').textContent, '5,000/小时');
    t.w.document.querySelector('[role="link"] time').setAttribute('datetime', new Date(createdAt - 1000).toISOString());
    await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 0);
  } finally { t.dom.window.close(); }
});

test('bridge retains explicit quote relationship and wraps visibility results', async () => {
  const t = bridgeSetup();
  try {
    await t.receive(tweet('1', { views: { state: 'Disabled' }, quoted_status_result: { result: { __typename: 'TweetWithVisibilityResults', tweet: tweet('2') } } }));
    assert.equal(t.messages.find(x => x.id === '1').quotedId, '2');
    assert.equal(t.messages.find(x => x.id === '1').valid, false);
    assert.equal(t.messages.find(x => x.id === '2').valid, true);
  } finally { t.dom.window.close(); }
});

test('detail permalink outside author row maps only the matching main author and its quote', async () => {
  const createdAt = Date.now() - 3600000;
  const t = setup(`<article><div data-testid="User-Name"><a href="/demo">Main author</a></div><p>Body</p><a href="/demo/status/1"><time>1h</time></a><div role="link"><div data-testid="User-Name"><span>Quote author</span><time datetime="${new Date(createdAt).toISOString()}">1h</time></div></div></article><article><div data-testid="User-Name"><a href="/other">Other author</a></div><a href="/other/status/3"><time>1h</time></a></article>`);
  try {
    t.w.history.replaceState({}, '', '/demo/status/1');
    send(t.w, [record('1', { quotedId: '2' }), record('2', { createdAt }), record('3')]);
    await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 2);
    assert.equal(t.w.document.querySelectorAll('article')[1].querySelector('[data-xfc-velocity]'), null);
    t.w.history.replaceState({}, '', '/someone_else/status/1');
    t.w.dispatchEvent(new t.w.PopStateEvent('popstate'));
    await tick();
    assert.equal(t.w.document.querySelectorAll('[data-xfc-velocity]').length, 0);
  } finally { t.dom.window.close(); }
});
