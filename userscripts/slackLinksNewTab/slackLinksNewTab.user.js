// ==UserScript==
// @name         slackLinksNewTab
// @version      1.0
// @description  Makes links to Slack message archives always open in a new tab
// @match        *://*/*
// @exclude      *://*.slack.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/slackLinksNewTab/slackLinksNewTab.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/slackLinksNewTab/slackLinksNewTab.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const DEBOUNCE_MS = 250;

    function isSlackArchiveLink(anchor) {
        let url;

        try {
            url = new URL(anchor.href);
        } catch (error) {
            return false;
        }

        return (
            url.hostname.endsWith('.slack.com') &&
            url.pathname.startsWith('/archives/')
        );
    }

    function fixLinks() {
        const anchors = document.querySelectorAll(
            'a[href*=".slack.com/archives/"]'
        );

        for (const anchor of anchors) {
            if (anchor.target === '_blank' || !isSlackArchiveLink(anchor)) {
                continue;
            }

            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
        }
    }

    // Pages add and rewrite links after load (lazy loading, SPA navigation),
    // so re-scan on DOM changes, debounced to keep the cost negligible.
    let timer = null;

    function scheduleFix() {
        if (timer !== null) {
            return;
        }

        timer = setTimeout(() => {
            timer = null;
            fixLinks();
        }, DEBOUNCE_MS);
    }

    new MutationObserver(scheduleFix).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'target'],
    });

    fixLinks();
})();
