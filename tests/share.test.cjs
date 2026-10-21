const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 30));

function setup(saved = true, clipboard = true, share = '<button data-testid="share">分享</button>') {
  const dom = new JSDOM(`<article data-testid="tweet"><a href="/api_author/status/123"><time>1h</time></a>${share}</article>`,
    { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  let copied = '';
  let listener;
  w.chrome = { runtime: {}, storage: { local: { get(defaults, callback) { callback({ ...defaults, copyAsMarkdownEnabled: saved }); } }, onChanged: { addListener(callback) { listener = callback; } } } };
  if (clipboard) Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(value) { copied = value; } } });
  w.postMessage = data => w.dispatchEvent(new w.MessageEvent('message', { data, origin: w.location.origin, source: w }));
  w.eval(fs.readFileSync('extension/share.js', 'utf8'));
  return { dom, w, copied: () => copied, change(value) { listener({ copyAsMarkdownEnabled: { newValue: value } }, 'local'); } };
}

function data(w) {
  w.postMessage({ channel: 'x-follower-count-v1', type: 'tweets', tweets: [{
    id: '123', text: '来自接口的正文\n![](https://pbs.twimg.com/photo.jpg)', authorName: '接口作者', authorHandle: 'api_author', observedAt: Date.now()
  }] });
}

function openMenu(w, html = '<div role="menuitem" data-testid="copyLink"><svg viewBox="0 0 24 24"><path d="M1 1"></path></svg><span>复制链接</span></div>') {
  w.document.querySelector('[data-testid="share"], [aria-label="分享帖子"]').click();
  const menu = w.document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = html;
  w.document.body.append(menu);
  return menu;
}

test('copy Markdown uses intercepted tweet data and injects once into the native share menu', async () => {
  const t = setup();
  try {
    data(t.w);
    const menu = openMenu(t.w); await tick();
    assert.equal(menu.querySelectorAll('[data-xfc-copy-markdown]').length, 1);
    assert.equal(menu.querySelector('[data-xfc-copy-markdown]').hasAttribute('data-testid'), false);
    const icon = menu.querySelector('[data-xfc-copy-markdown] svg');
    assert.equal(icon.dataset.lucide, 'clipboard-copy');
    assert.equal(icon.hasAttribute('width') || icon.hasAttribute('height'), false);
    assert.equal(icon.style.fill, 'none');
    menu.append(t.w.document.createElement('span')); await tick();
    assert.equal(menu.querySelectorAll('[data-xfc-copy-markdown]').length, 1);
    menu.querySelector('[data-xfc-copy-markdown]').click(); await tick();
    assert.equal(t.copied(), '来自接口的正文\n![](https://pbs.twimg.com/photo.jpg)\n\n— [接口作者 @api_author](https://x.com/api_author/status/123)\n');
    assert.equal(t.w.document.querySelector('[data-xfc-copy-toast]').textContent, '已复制为 Markdown');
  } finally { t.dom.window.close(); }
});

test('current X share button without a data-testid still opens a Markdown-capable menu', async () => {
  const t = setup(true, true, '<button aria-haspopup="menu" aria-label="分享帖子">分享</button>');
  try {
    data(t.w);
    const menu = openMenu(t.w); await tick();
    assert.ok(menu.querySelector('[data-xfc-copy-markdown]'));
  } finally { t.dom.window.close(); }
});

test('a share button outside a tweet clears the previous tweet target', async () => {
  const t = setup();
  try {
    data(t.w);
    const first = openMenu(t.w); await tick();
    assert.ok(first.querySelector('[data-xfc-copy-markdown]'));
    first.remove();
    const outside = t.w.document.createElement('button');
    outside.setAttribute('data-testid', 'share');
    t.w.document.body.append(outside);
    outside.click();
    const menu = t.w.document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div role="menuitem" data-testid="copyLink"><span>复制链接</span></div>';
    t.w.document.body.append(menu);
    await tick();
    assert.equal(menu.querySelector('[data-xfc-copy-markdown]'), null);
  } finally { t.dom.window.close(); }
});

test('an injected menu item keeps the tweet selected when that menu opened', async () => {
  const t = setup();
  try {
    data(t.w);
    const menu = openMenu(t.w); await tick();
    const other = t.w.document.createElement('article');
    other.setAttribute('data-testid', 'tweet');
    other.innerHTML = '<a href="/other/status/456"><time>1h</time></a><button data-testid="share">分享</button>';
    t.w.document.body.append(other);
    other.querySelector('button').click();
    menu.querySelector('[data-xfc-copy-markdown]').click(); await tick();
    assert.match(t.copied(), /api_author\/status\/123/);
  } finally { t.dom.window.close(); }
});

test('clipboard fallback failure removes its temporary textarea', async () => {
  const t = setup(true, false);
  try {
    t.w.document.execCommand = () => { throw new Error('blocked'); };
    data(t.w);
    const menu = openMenu(t.w); await tick();
    menu.querySelector('[data-xfc-copy-markdown]').click(); await tick();
    assert.equal(t.w.document.querySelector('textarea'), null);
    assert.equal(t.w.document.querySelector('[data-xfc-copy-toast]').textContent, '帖子数据尚未加载');
  } finally { t.dom.window.close(); }
});

test('X Article block menus are not mistaken for share menus', async () => {
  const t = setup();
  try {
    data(t.w);
    const menu = openMenu(t.w, '<div role="menuitem" data-testid="linkPreview"><span>链接预览</span></div><div role="menuitem"><span>LaTeX</span></div>');
    await tick();
    assert.equal(menu.querySelector('[data-xfc-copy-markdown]'), null);
  } finally { t.dom.window.close(); }
});

test('copy Markdown popup setting defaults on and removes or restores the menu item immediately', async () => {
  const t = setup();
  try {
    data(t.w);
    const menu = openMenu(t.w); await tick();
    assert.ok(menu.querySelector('[data-xfc-copy-markdown]'));
    t.change(false); await tick();
    assert.equal(menu.querySelector('[data-xfc-copy-markdown]'), null);
    t.change(true); await tick();
    assert.ok(menu.querySelector('[data-xfc-copy-markdown]'));
  } finally { t.dom.window.close(); }
});
