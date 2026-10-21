(() => {
  'use strict';
  const defaults = { showFollowerCount: true, showProfileBio: true, hideNotificationCount: true, hideSidebarRecommendations: true, hideLeftSidebar: false };
  const settings = { ...defaults };
  const attributes = {
    showFollowerCount: 'data-xfc-show-follower-count',
    showProfileBio: 'data-xfc-show-profile-bio',
    hideNotificationCount: 'data-xfc-hide-notification-count',
    hideSidebarRecommendations: 'data-xfc-hide-sidebar-recommendations',
    hideLeftSidebar: 'data-xfc-hide-left-sidebar'
  };
  const changedSinceLoad = new Set();
  const apply = () => {
    for (const [key, attribute] of Object.entries(attributes)) {
      document.documentElement?.setAttribute(attribute, String(settings[key]));
    }
    window.dispatchEvent(new Event('xpandmax:settings'));
  };
  apply();
  if (!document.documentElement) {
    const observer = new MutationObserver(() => {
      if (document.documentElement) { apply(); observer.disconnect(); }
    });
    observer.observe(document, { childList: true, subtree: true });
  }
  if (!globalThis.chrome?.storage?.local) return;
  chrome.storage.local.get(defaults, saved => {
    if (chrome.runtime.lastError) return;
    for (const key of Object.keys(settings)) {
      if (!changedSinceLoad.has(key)) {
        settings[key] = typeof saved[key] === 'boolean' ? saved[key] : defaults[key];
      }
    }
    apply();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(settings)) {
      if (!Object.hasOwn(changes, key)) continue;
      changedSinceLoad.add(key);
      const value = changes[key].newValue;
      settings[key] = typeof value === 'boolean' ? value : defaults[key];
    }
    apply();
  });
})();
