const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const settingsScript = fs.readFileSync('extension/settings.js', 'utf8');
const popupScript = fs.readFileSync('extension/popup.js', 'utf8');
const css = fs.readFileSync('extension/content.css', 'utf8');

function setupSettings(saved = {}, deferred = false) {
  const dom = new JSDOM(`<style>${css}</style><title>(2) X</title><nav>
    <a href="/notifications" data-testid="AppTabBar_Notifications_Link"><svg id="bell"></svg><span aria-live="polite" id="unread">2</span><span>通知</span></a>
    <a href="/messages" data-testid="AppTabBar_DirectMessage_Link"><span aria-live="polite" id="messages">5</span></a>
  </nav><main>通知内容</main>`, { url: 'https://x.com/home', runScripts: 'outside-only' });
  const w = dom.window;
  let listener;
  let finishLoad;
  w.chrome = { runtime: {}, storage: {
    local: { get(defaults, callback) { finishLoad = () => callback({ ...defaults, ...saved }); if (!deferred) finishLoad(); } },
    onChanged: { addListener(callback) { listener = callback; } }
  } };
  w.eval(settingsScript);
  return { dom, w, change(value, area = 'local', key = 'hideNotificationCount') { listener({ [key]: { newValue: value } }, area); }, finishLoad: () => finishLoad() };
}

test('粉丝数和简介默认显示，保存的开关会立即更新页面状态', () => {
  const { dom, w, change } = setupSettings();
  try {
    assert.equal(w.document.documentElement.dataset.xfcShowFollowerCount, 'true');
    assert.equal(w.document.documentElement.dataset.xfcShowProfileBio, 'true');
    change(false, 'local', 'showFollowerCount');
    change(false, 'local', 'showProfileBio');
    assert.equal(w.document.documentElement.dataset.xfcShowFollowerCount, 'false');
    assert.equal(w.document.documentElement.dataset.xfcShowProfileBio, 'false');
  } finally { dom.window.close(); }
});

test('默认只隐藏通知数字，铃铛、通知入口、其他角标和通知内容保留', () => {
  const { dom, w } = setupSettings();
  try {
    assert.equal(w.getComputedStyle(w.document.querySelector('#unread')).display, 'none');
    assert.notEqual(w.getComputedStyle(w.document.querySelector('#bell')).display, 'none');
    assert.notEqual(w.getComputedStyle(w.document.querySelector('#messages')).display, 'none');
    assert.equal(w.document.querySelector('a').getAttribute('href'), '/notifications');
    assert.match(w.document.querySelector('a').textContent, /通知/);
    assert.equal(w.document.querySelector('main').textContent, '通知内容');
    assert.equal(w.document.title, '(2) X');
    const fresh = w.document.createElement('span');
    fresh.setAttribute('aria-live', 'polite'); fresh.textContent = '7';
    w.document.querySelector('#unread').replaceWith(fresh);
    assert.equal(w.getComputedStyle(fresh).display, 'none');
    assert.equal(fresh.textContent, '7');
  } finally { dom.window.close(); }
});

test('保存的开关和跨标签页设置变更即时生效，关闭后恢复原角标', () => {
  const { dom, w, change } = setupSettings({ hideNotificationCount: false });
  const badge = w.document.querySelector('#unread');
  try {
    assert.notEqual(w.getComputedStyle(badge).display, 'none');
    change(true, 'sync');
    assert.notEqual(w.getComputedStyle(badge).display, 'none');
    change(true);
    assert.equal(w.getComputedStyle(badge).display, 'none');
    change(false);
    assert.notEqual(w.getComputedStyle(badge).display, 'none');
    assert.equal(badge.textContent, '2');
  } finally { dom.window.close(); }
});

test('较晚返回的初始设置不覆盖最新开关操作', () => {
  const { dom, w, change, finishLoad } = setupSettings({ hideNotificationCount: false }, true);
  try {
    change(true); finishLoad();
    assert.equal(w.document.documentElement.getAttribute('data-xfc-hide-notification-count'), 'true');
  } finally { dom.window.close(); }
});

test('插件设置只保存布尔开关，保存失败时恢复原状态', () => {
  const dom = new JSDOM(fs.readFileSync('extension/popup.html', 'utf8'), { runScripts: 'outside-only' });
  const w = dom.window;
  const writes = [];
  let fail = false;
  w.chrome = { runtime: {}, storage: { local: {
    get(defaults, callback) { callback({ hideNotificationCount: true }); },
    set(value, callback) {
      writes.push(value);
      if (fail) w.chrome.runtime.lastError = { message: 'write failed' };
      callback();
      delete w.chrome.runtime.lastError;
    }
  } } };
  try {
    w.eval(popupScript);
    const toggle = w.document.querySelector('input');
    assert.equal(toggle.disabled, false);
    assert.equal(toggle.checked, true);
    assert.equal(w.document.querySelector('#show-follower-count').checked, true);
    assert.equal(w.document.querySelector('#show-profile-bio').checked, true);
    toggle.checked = false;
    toggle.dispatchEvent(new w.Event('change'));
    assert.equal(JSON.stringify(writes[0]), '{"hideNotificationCount":false}');
    assert.match(w.document.querySelector('#status').textContent, /恢复显示/);
    fail = true; toggle.checked = true;
    toggle.dispatchEvent(new w.Event('change'));
    assert.equal(toggle.checked, false);
    assert.match(w.document.querySelector('#status').textContent, /未保存/);
    assert.equal(toggle.disabled, false);
    fail = false;
    const bio = w.document.querySelector('#show-profile-bio');
    bio.checked = false;
    bio.dispatchEvent(new w.Event('change'));
    assert.equal(JSON.stringify(writes.at(-1)), '{"showProfileBio":false}');
    assert.match(w.document.querySelector('#status').textContent, /已关闭简介/);
  } finally { dom.window.close(); }
});
