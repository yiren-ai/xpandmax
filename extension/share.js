(() => {
  'use strict';
  const CHANNEL = 'x-follower-count-v1';
  const TTL = 30 * 60 * 1000;
  const tweets = new Map();
  let activeId;
  let enabled = true;
  let settingChanged = false;

  function configure(value) {
    enabled = typeof value === 'boolean' ? value : true;
    if (!enabled) for (const item of document.querySelectorAll('[data-xfc-copy-markdown]')) item.remove();
    else for (const menu of document.querySelectorAll('[role="menu"]')) inject(menu);
  }

  if (globalThis.chrome?.storage?.local) {
    chrome.storage.local.get({ copyAsMarkdownEnabled: true }, saved => {
      if (!chrome.runtime.lastError && !settingChanged) configure(saved.copyAsMarkdownEnabled);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !Object.hasOwn(changes, 'copyAsMarkdownEnabled')) return;
      settingChanged = true;
      configure(changes.copyAsMarkdownEnabled.newValue);
    });
  }

  function articleTweetId(root) {
    const ownLinks = selector => [...root.querySelectorAll(selector)]
      .filter(link => link.closest('article[data-testid="tweet"]') === root);
    const idFrom = link => link?.getAttribute('href')?.match(/\/status\/(\d+)(?:[/?#]|$)/)?.[1];
    const analytics = idFrom(ownLinks('a[href*="/status/"][href*="/analytics"]')[0]);
    if (analytics) return analytics;
    const links = ownLinks('a[href*="/status/"]');
    for (const link of links) {
      const id = idFrom(link);
      if (id && tweets.has(id)) return id;
    }
    return idFrom(links[0]);
  }

  function markdown(record) {
    if (!record?.text) return '';
    const handle = record.authorHandle ? `@${record.authorHandle}` : '';
    const author = [record.authorName, handle].filter(Boolean).join(' ') || 'X 帖子';
    const label = author.replace(/[\[\]]/g, '\\$&');
    const url = record.authorHandle ? `https://x.com/${record.authorHandle}/status/${record.id}` : `https://x.com/i/web/status/${record.id}`;
    return `${record.text.trim()}\n\n— [${label}](${url})\n`;
  }

  async function copy(text) {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch {}
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    try { return document.execCommand('copy'); }
    catch { return false; }
    finally { input.remove(); }
  }

  function toast(message) {
    document.querySelector('[data-xfc-copy-toast]')?.remove();
    const node = document.createElement('div');
    node.setAttribute('data-xfc-copy-toast', '');
    node.setAttribute('role', 'status');
    node.textContent = message;
    document.body.append(node);
    setTimeout(() => node.remove(), 1600);
  }

  const label = item => `${item.getAttribute('aria-label') || ''} ${item.textContent || ''}`.toLowerCase();
  function shareMenu(menu) {
    const items = menu.querySelectorAll('[role="menuitem"]');
    if ([...items].some(item => /链接预览|リンクプレビュー|link preview|preview link|\blatex\b/.test(label(item)))) return false;
    if ([...menu.querySelectorAll('[data-testid]')].some(node => /copy/i.test(node.dataset.testid || '') && /link/i.test(node.dataset.testid || ''))) return true;
    return [...items].some(item => /copy link|copy post link|复制(?:帖子|推文)?链接|リンクをコピー/.test(label(item)));
  }

  function inject(menu) {
    if (!enabled || !activeId || !shareMenu(menu) || menu.querySelector('[data-xfc-copy-markdown]')) return;
    const items = menu.querySelectorAll('[role="menuitem"]');
    const template = items[items.length - 1];
    if (!template?.parentNode) return;
    const item = template.cloneNode(true);
    item.setAttribute('data-xfc-copy-markdown', '');
    item.setAttribute('aria-label', '复制为 Markdown');
    item.removeAttribute('href');
    item.removeAttribute('id');
    item.removeAttribute('data-testid');
    for (const node of item.querySelectorAll('[id], [data-testid]')) {
      node.removeAttribute('id'); node.removeAttribute('data-testid');
    }
    const tweetId = activeId;
    const text = [...item.querySelectorAll('span')].find(node => node.children.length === 0 && node.textContent.trim());
    if (text) text.textContent = '复制为 Markdown';
    else item.textContent = '复制为 Markdown';
    const icon = item.querySelector('svg');
    if (icon) {
      for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', 'data-lucide': 'clipboard-copy' })) icon.setAttribute(name, value);
      icon.removeAttribute('width'); icon.removeAttribute('height');
      icon.style.fill = 'none';
      icon.innerHTML = '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2"></path><path d="M16 4h2a2 2 0 0 1 2 2v2"></path><path d="M16 19h6"></path><path d="m19 16 3 3-3 3"></path>';
    }
    item.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      const record = tweets.get(tweetId);
      const value = record && Date.now() - record.observedAt < TTL && markdown(record);
      const copied = value && await copy(value);
      toast(copied ? '已复制为 Markdown' : '帖子数据尚未加载');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    template.parentNode.append(item);
  }

  document.addEventListener('click', event => {
    const button = event.target instanceof Element
      && event.target.closest('button[data-testid="share"], button[aria-haspopup="menu"]');
    const root = button?.closest('article[data-testid="tweet"]');
    if (button) activeId = root ? articleTweetId(root) : undefined;
  }, true);

  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.channel !== CHANNEL
      || data.type !== 'tweets' || !Array.isArray(data.tweets) || data.tweets.length > 250) return;
    const now = Date.now();
    for (const record of data.tweets) {
      if (!record || typeof record.id !== 'string' || !/^\d{1,25}$/.test(record.id)
        || typeof record.text !== 'string' || record.text.length > 50000
        || !Number.isFinite(record.observedAt) || record.observedAt > now || now - record.observedAt >= TTL) continue;
      const clean = { id: record.id, text: record.text, observedAt: record.observedAt };
      if (typeof record.authorHandle === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(record.authorHandle)) clean.authorHandle = record.authorHandle;
      if (typeof record.authorName === 'string' && record.authorName.length <= 200) clean.authorName = record.authorName;
      tweets.delete(record.id); tweets.set(record.id, clean);
    }
    while (tweets.size > 5000) tweets.delete(tweets.keys().next().value);
  });

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('[role="menu"]')) inject(node);
      for (const menu of node.querySelectorAll('[role="menu"]')) inject(menu);
    }
  });
  const start = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.postMessage({ channel: CHANNEL, type: 'ready' }, location.origin);
})();
