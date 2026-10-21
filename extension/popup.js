(() => {
  'use strict';
  const controls = [
    { key: 'showFollowerCount', id: 'show-follower-count', label: '粉丝数', defaultValue: true },
    { key: 'showProfileBio', id: 'show-profile-bio', label: '简介', defaultValue: true },
    { key: 'showTweetVelocity', id: 'show-tweet-velocity', label: '帖子流速', defaultValue: true },
    { key: 'hideNotificationCount', id: 'hide-notification-count', label: '通知数字', defaultValue: true },
    { key: 'hideLeftSidebar', id: 'hide-left-sidebar', label: '左侧导航', defaultValue: false },
    { key: 'hideSidebarRecommendations', id: 'hide-sidebar-recommendations', label: '右侧栏', defaultValue: true }
  ];
  const status = document.getElementById('status');
  const rising = document.getElementById('velocity-rising');
  const viral = document.getElementById('velocity-viral');
  chrome.storage.local.get({ velocityRisingThreshold: 1000, velocityViralThreshold: 10000 }, saved => {
    if (chrome.runtime.lastError) return;
    rising.value = saved.velocityRisingThreshold ?? 1000;
    viral.value = saved.velocityViralThreshold ?? 10000;
  });
  document.getElementById('velocity-thresholds').addEventListener('submit', event => {
    event.preventDefault();
    const low = Number(rising.value), high = Number(viral.value);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= low) {
      status.textContent = '请输入正数，爆款阈值必须大于上升阈值'; return;
    }
    chrome.storage.local.set({ velocityRisingThreshold: low, velocityViralThreshold: high }, () => {
      status.textContent = chrome.runtime.lastError ? '阈值未保存，请重试' : '流速阈值已保存';
    });
  });
  const defaults = Object.fromEntries(controls.map(({ key, defaultValue }) => [key, defaultValue]));
  chrome.storage.local.get(defaults, settings => {
    if (chrome.runtime.lastError) { status.textContent = '读取设置失败，请重新打开插件'; return; }
    for (const { key, id, label } of controls) {
      const toggle = document.getElementById(id);
      let saved = typeof settings[key] === 'boolean' ? settings[key] : defaults[key];
      toggle.checked = saved;
      toggle.disabled = false;
      toggle.addEventListener('change', () => {
        const next = toggle.checked;
        toggle.disabled = true;
        chrome.storage.local.set({ [key]: next }, () => {
          if (chrome.runtime.lastError) {
            toggle.checked = saved;
            status.textContent = '设置未保存，请重试';
          } else {
            saved = next;
            status.textContent = key.startsWith('show') ? `${saved ? '已显示' : '已关闭'}${label}` : `${saved ? '已隐藏' : '已恢复显示'}${label}`;
          }
          toggle.disabled = false;
        });
      });
    }
    status.textContent = '设置自动保存，切换后立即生效';
  });
})();
