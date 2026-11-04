(() => {
  'use strict';
  const states = new Map();
  let active = false;

  function update(handle, status, message = '') {
    states.delete(handle);
    states.set(handle, { status, message, at: Date.now() });
    while (states.size > 100) states.delete(states.keys().next().value);
    window.dispatchEvent(new Event('xpandmax:followstate'));
  }

  function belongsTo(header, handle) {
    if (!header?.isConnected) return false;
    return [...header.querySelectorAll('a[href], span')].some(node => {
      if (node.closest('[data-xfc-inline-profile]')) return false;
      if (node.tagName === 'A') {
        try {
          const url = new URL(node.getAttribute('href'), location.href);
          return url.origin === location.origin && url.pathname.replace(/^\//, '').replace(/\/$/, '').toLowerCase() === handle;
        } catch { return false; }
      }
      return node.textContent.trim().toLowerCase() === `@${handle}`;
    });
  }

  function waitFor(check, timeout, signal, eventName) {
    return new Promise((resolve, reject) => {
      let observer;
      let timer;
      const cleanup = () => {
        observer?.disconnect();
        clearTimeout(timer);
        window.removeEventListener(eventName, inspect);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => { cleanup(); reject(new Error('操作已取消')); };
      const inspect = () => {
        try {
          const result = check();
          if (result) { cleanup(); resolve(result); }
        } catch (error) { cleanup(); reject(error); }
      };
      observer = new MutationObserver(inspect);
      observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid', 'href'] });
      window.addEventListener(eventName, inspect);
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { cleanup(); reject(new Error('未确认关注结果，请稍后重试')); }, timeout);
      inspect();
    });
  }

  async function start({ button, details, handle, getProfile }) {
    if (active || !/^[a-zA-Z0-9_]{1,15}$/.test(handle) || button?.disabled) return;
    handle = handle.toLowerCase();
    const header = details?.closest('[data-testid="User-Name"], [data-testid="UserName"]');
    const article = header?.closest('article');
    const caret = article?.querySelector('[data-testid="caret"]');
    const original = getProfile(handle);
    if (!article || !belongsTo(header, handle) || article.querySelector('[data-testid="User-Name"], [data-testid="UserName"]') !== header
      || !caret || original.following !== false || original.followRequestSent || original.followBlocked) return;
    if (document.querySelector('[role="menu"], [role="dialog"]')) {
      update(handle, 'error', '请先关闭打开的菜单或弹窗，再点击关注');
      return;
    }

    active = true;
    const aborter = new AbortController();
    let ownedMenu;
    const stillSameAuthor = () => {
      if (!button.isConnected || !belongsTo(header, handle) || details.dataset.xfcHandle !== handle) {
        throw new Error('页面中的作者已变化，请重新点击关注');
      }
    };
    const cancelOnLeave = () => aborter.abort();
    window.addEventListener('pagehide', cancelOnLeave, { once: true });
    update(handle, 'pending');
    try {
      // 复用 X 原生菜单的关注动作，不保存登录信息，不自己构造写入请求。
      document.documentElement.setAttribute('data-xfc-follow-menu', '');
      caret.click();
      ownedMenu = await waitFor(() => {
        stillSameAuthor();
        if (caret.getAttribute('aria-expanded') !== 'true') return false;
        return document.querySelector('[role="menu"]');
      }, 2000, aborter.signal, 'xpandmax:profiles');
      stillSameAuthor();
      const suffix = `@${handle}`;
      const items = [...ownedMenu.querySelectorAll('[role="menuitem"]')];
      const textOf = node => node.textContent.trim().replace(/\s+/g, ' ').toLowerCase();
      const match = items.find(node => [`关注 ${suffix}`, `關注 ${suffix}`, `跟隨 ${suffix}`, `追蹤 ${suffix}`, `follow ${suffix}`].includes(textOf(node)));
      if (!match) {
        const already = items.some(node => [`取消关注 ${suffix}`, `取消關注 ${suffix}`, `取消跟隨 ${suffix}`, `取消追蹤 ${suffix}`, `unfollow ${suffix}`].includes(textOf(node)));
        if (already) { update(handle, 'success'); return; }
        throw new Error('X 当前没有提供关注入口，请打开作者主页查看');
      }
      match.click();
      if (caret.getAttribute('aria-expanded') === 'true' && ownedMenu.isConnected) caret.click();
      document.documentElement.removeAttribute('data-xfc-follow-menu');
      const result = await waitFor(() => {
        stillSameAuthor();
        const profile = getProfile(handle);
        return profile.followRequestSent ? 'requested' : profile.following === true ? 'success' : false;
      }, 10000, aborter.signal, 'xpandmax:profiles');
      update(handle, result);
    } catch (error) {
      update(handle, 'error', error.message);
    } finally {
      aborter.abort();
      if (ownedMenu?.isConnected && caret?.isConnected && caret.getAttribute('aria-expanded') === 'true') caret.click();
      document.documentElement.removeAttribute('data-xfc-follow-menu');
      window.removeEventListener('pagehide', cancelOnLeave);
      active = false;
    }
  }

  function sync(handle, fields) {
    const state = states.get(handle);
    if (!state || state.status === 'pending') return;
    const fresh = (key, value) => fields[key]?.at >= state.at && fields[key].value === value;
    if ((state.status === 'success' && fresh('following', false))
      || (state.status === 'requested' && (fresh('followRequestSent', false) || fresh('following', true)))
      || (state.status === 'error' && (fresh('following', true) || fresh('followRequestSent', true)))
      || fresh('followBlocked', true)) {
      states.delete(handle);
    }
  }

  window.xpandmaxFollow = { start, sync, state: handle => states.get(handle) };
})();
