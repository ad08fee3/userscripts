// ==UserScript==
// @name         githubAutoSso
// @version      1.0
// @description  Automatically opens the GitHub SSO banner link in a background tab, then closes it after auth completes.
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubAutoSso/githubAutoSso.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubAutoSso/githubAutoSso.user.js
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const HANDLED_ATTR = 'data-ghas-handled';
    const CLOSE_PATH = '/auto_close_this_tab';

    // After SSO completes, GitHub redirects to return_to. Close if that's us.
    if (window.location.pathname === CLOSE_PATH) {
        window.close();
        return;
    }

    function buildSsoUrl(originalHref) {
        const url = new URL(originalHref, window.location.origin);
        url.searchParams.set('return_to', CLOSE_PATH);
        return url.toString();
    }

    function handleBanner(banner) {
        if (banner.hasAttribute(HANDLED_ATTR)) return;
        banner.setAttribute(HANDLED_ATTR, '1');

        const link = banner.querySelector('a[href*="/sso"]');
        if (!link) return;

        GM_openInTab(buildSsoUrl(link.href), { active: false, insert: true });
    }

    function checkForBanner() {
        const banner = document.querySelector('[data-testid="global-sso-banner"]');
        if (banner) handleBanner(banner);
    }

    checkForBanner();

    new MutationObserver(checkForBanner).observe(document.body, {
        childList: true,
        subtree: true,
    });
})();
