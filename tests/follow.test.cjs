const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const content = fs.readFileSync('extension/content.js', 'utf8');
const follow = fs.readFileSync('extension/follow.js', 'utf8');
const bridge = fs.readFileSync('extension/bridge.js', 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 40));
const header = handle => `<div data-testid="User-Name"><div><a href="/${handle}">${handle}</a></div><div><span>@${handle}</span></div></div>`;
function setup() {
  const dom = new JSDOM(`<a data-testid="AppTabBar_Profile_Link" href="/Me">我</a><main><article>${header('Alice')}<button data-testid="caret" aria-expanded="false">更多</button><div role="link">${header('Bob')}</div></article><article>${header('Me')}<button data-testid="caret">更多</button></article></main>`, {
    url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  const observers = [];
  const Observer = w.MutationObserver;
  w.MutationObserver = class extends Observer {
    constructor(callback) { super(callback); observers.push(this); }
  };
  const close = w.close.bind(w);
  w.close = () => { observers.forEach(observer => observer.disconnect()); close(); };
  w.postMessage = data => w.dispatchEvent(new w.MessageEvent('message', { data, origin: w.location.origin, source: w }));
  w.eval(follow);
  w.eval(content);
  const send = users => w.postMessage({ channel: 'x-follower-count-v1', type: 'counts', users });
  const article = w.document.querySelector('article');
  const caret = article.querySelector('[data-testid="caret"]');
  const state = { following: false };
  let clicks = 0;
  function nativeMenu(label = '关注 @Alice', result) {
    caret.onclick = () => {
      if (caret.getAttribute('aria-expanded') === 'true') {
        caret.setAttribute('aria-expanded', 'false');
        w.document.querySelector('[role="menu"]')?.remove();
        return;
      }
      caret.setAttribute('aria-expanded', 'true');
      const menu = w.document.createElement('div'); menu.role = 'menu';
      const item = w.document.createElement('button'); item.role = 'menuitem'; item.textContent = label;
      item.onclick = () => { clicks++; result?.(); menu.remove(); caret.setAttribute('aria-expanded', 'false'); };
      menu.append(item); w.document.body.append(menu);
    };
  }
  async function ready(extra = {}) { send([{ handle: 'Alice', count: 12500, bio: '简介', following: false, ...extra }, { handle: 'Bob', count: 2, following: false }, { handle: 'Me', count: 3, following: false }]); await tick(); }
  function start() { const details = article.querySelector('[data-xfc-inline-profile]'); return w.xpandmaxFollow.start({ button: details.querySelector('[data-xfc-follow]'), details, handle: 'alice', getProfile: () => state }); }
  return { dom, w, article, caret, send, state, nativeMenu, ready, start, clicks: () => clicks };
}

test('关注按钮只给未关注的主帖作者显示，自己、引用作者、已关注和请求中不显示', async () => {
  const f = setup();
  try {
    await f.ready();
    assert.equal(f.w.document.querySelectorAll('[data-xfc-follow]').length, 1);
    assert.equal(f.article.querySelector('[data-xfc-follow]').textContent, '关注');
    for (const extra of [{ following: true }, { followRequestSent: true }, { followBlocked: true }]) {
      await f.ready({ following: false, followRequestSent: false, followBlocked: false, ...extra });
      assert.equal(f.w.document.querySelector('[data-xfc-follow]'), null);
    }
  } finally { f.dom.window.close(); }
});

test('网页伪造的点击不能发起关注，关注按钮也不展开简介', async () => {
  const f = setup();
  let calls = 0;
  try {
    await f.ready();
    f.w.xpandmaxFollow.start = () => { calls++; };
    f.article.querySelector('[data-xfc-follow]').click(); await tick();
    assert.equal(calls, 0);
    assert.equal(f.article.querySelector('[data-xfc-expanded]').hidden, true);
  } finally { f.dom.window.close(); }
});

test('只点一次精确匹配的原生关注，等待服务器确认后才显示已关注', async () => {
  const f = setup();
  try {
    await f.ready(); f.nativeMenu();
    const task = f.start(); await tick();
    assert.equal(f.clicks(), 1);
    assert.equal(f.w.xpandmaxFollow.state('alice').status, 'pending');
    assert.equal(f.article.querySelector('[data-xfc-follow]').disabled, true);
    await f.start(); assert.equal(f.clicks(), 1);
    f.state.following = true; f.send([{ handle: 'Alice', following: true }]);
    await task; await tick();
    assert.equal(f.article.querySelector('[data-xfc-follow]').textContent, '已关注');
    assert.equal(f.article.querySelector('[data-xfc-expanded]').hidden, true);
    assert.equal(f.w.document.querySelector('[role="menu"]'), null);
    assert.equal(f.w.document.documentElement.hasAttribute('data-xfc-follow-menu'), false);
  } finally { f.dom.window.close(); }
});

test('原生菜单已是取消关注时不点击，账号不同或菜单不匹配时停止', async () => {
  for (const label of ['取消关注 @Alice', '关注 @Bob', '不再关注 @Alice']) {
    const f = setup();
    try {
      await f.ready(); f.nativeMenu(label); await f.start();
      assert.equal(f.clicks(), 0);
      assert.equal(f.w.xpandmaxFollow.state('alice').status, label.startsWith('取消关注') ? 'success' : 'error');
      assert.equal(f.w.document.querySelector('[role="menu"]'), null);
    } finally { f.dom.window.close(); }
  }
});

test('关注请求待批准显示已请求，响应失败不误报成功', async () => {
  for (const requested of [true, false]) {
    const f = setup();
    try {
      await f.ready();
      const nativeTimeout = f.w.setTimeout.bind(f.w);
      f.w.setTimeout = (fn, delay, ...args) => nativeTimeout(fn, delay === 10000 ? 50 : delay, ...args);
      f.nativeMenu('Follow @Alice', requested ? () => { f.state.followRequestSent = true; f.send([{ handle: 'Alice', followRequestSent: true }]); } : undefined);
      await f.start(); await tick();
      assert.equal(f.clicks(), 1);
      assert.equal(f.w.xpandmaxFollow.state('alice').status, requested ? 'requested' : 'error');
      assert.equal(f.article.querySelector('[data-xfc-follow]').textContent, requested ? '已请求' : '重试关注');
    } finally { f.dom.window.close(); }
  }
});

test('作者 DOM 复用及已打开菜单时不执行关注', async () => {
  const f = setup();
  try {
    await f.ready(); f.nativeMenu();
    f.caret.onclick = () => {
      f.article.querySelector('a').href = '/Carol';
      f.article.querySelector('[data-testid="User-Name"] > div + div span').textContent = '@Carol';
      f.caret.setAttribute('aria-expanded', 'true');
      const menu = f.w.document.createElement('div'); menu.role = 'menu'; menu.textContent = '关注 @Alice'; f.w.document.body.append(menu);
    };
    await f.start(); assert.equal(f.clicks(), 0);
    assert.equal(f.w.xpandmaxFollow.state('alice').status, 'error');
  } finally { f.dom.window.close(); }
});

test('桥接兼容新旧关注状态并读取原生关注结果，不读取关注你字段或其他写入响应', async () => {
  const f = setup(); const messages = [];
  try {
    f.w.postMessage = data => messages.push(data);
    let url = 'https://x.com/i/api/graphql/example/Users';
    let body = [{ core: { screen_name: 'Alice' }, relationship_perspectives: { following: false, blocking: false, blocked_by: false, followed_by: true }, follow_request_sent: false }, { legacy: { screen_name: 'Bob', following: true, follow_request_sent: false } }];
    f.w.fetch = async () => ({ ok: true, url, clone: () => ({ json: async () => body }) });
    f.w.eval(bridge); await f.w.fetch('fixture'); await tick();
    const alice = messages[0].users.find(u => u.handle === 'alice');
    assert.equal(alice.following, false); assert.equal(alice.followBlocked, false); assert.equal(alice.followRequestSent, false);
    assert.equal(Object.hasOwn(alice, 'followedBy'), false);
    url = 'https://x.com/i/api/1.1/friendships/create.json'; body = { screen_name: 'Alice', following: false, follow_request_sent: false };
    await f.w.fetch('fixture'); await tick(); assert.equal(messages.at(-1).users[0].following, true);
    const count = messages.length;
    body = { screen_name: 'Alice', following: true, errors: [{ message: 'failed' }] };
    await f.w.fetch('fixture'); await tick(); assert.equal(messages.length, count);
    url = 'https://x.com/i/api/1.1/favorites/create.json'; await f.w.fetch('fixture'); await tick(); assert.equal(messages.length, count);
  } finally { f.dom.window.close(); }
});

test('原生取消关注或取消申请后，旧的成功状态不会锁死关注按钮', async () => {
  for (const requested of [false, true]) {
    const f = setup();
    try {
      await f.ready();
      f.nativeMenu('Follow @Alice', () => {
        if (requested) f.state.followRequestSent = true;
        else f.state.following = true;
        f.send([{ handle: 'Alice', ...f.state }]);
      });
      await f.start(); await tick();
      assert.equal(f.article.querySelector('[data-xfc-follow]').disabled, true);
      // Neither unrelated profile updates nor old relationship replays undo a result.
      f.send([{ handle: 'Alice', count: 12501 }]);
      f.send([{ handle: 'Alice', following: false, followRequestSent: false,
        observedAt: { following: Date.now() - 1000, followRequestSent: Date.now() - 1000 } }]);
      await tick();
      assert.equal(f.article.querySelector('[data-xfc-follow]').disabled, true);
      f.state.following = false;
      f.state.followRequestSent = false;
      f.send([{ handle: 'Alice', ...f.state }]);
      await tick();
      const button = f.article.querySelector('[data-xfc-follow]');
      assert.equal(button.disabled, false);
      assert.equal(button.textContent, '关注');
    } finally { f.dom.window.close(); }
  }
});

test('关注报错后通过原生界面成功关注，不再保留重试按钮', async () => {
  const f = setup();
  try {
    await f.ready(); f.nativeMenu('关注 @Bob');
    await f.start(); await tick();
    assert.equal(f.article.querySelector('[data-xfc-follow]').textContent, '重试关注');
    f.send([{ handle: 'Alice', following: true }]);
    await tick();
    assert.equal(f.article.querySelector('[data-xfc-follow]'), null);
  } finally { f.dom.window.close(); }
});
