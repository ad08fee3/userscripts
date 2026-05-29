// ==UserScript==
// @name         githubDiffWhitespace
// @version      1.0
// @description  Adds the whitespace param (w=1) to GitHub diff/review URLs when it's missing. Leaves w=0 alone so you can still opt back in to seeing whitespace.
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubDiffWhitespace/githubDiffWhitespace.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubDiffWhitespace/githubDiffWhitespace.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Only touch diff/review pages (PR "Files changed", etc).
    function isDiffUrl(url) {
        return url.pathname.includes('/changes') || url.pathname.includes('/files');
    }

    // Redirect to add w=1 only when no w param exists. An existing w (including
    // w=0) is an explicit choice, so we never overwrite it.
    function ensureWhitespaceParam() {
        const url = new URL(window.location.href);
        if (!isDiffUrl(url)) return;
        if (url.searchParams.has('w')) return;

        url.searchParams.set('w', '1');
        // replace() so we don't add an extra entry to the back/forward history.
        window.location.replace(url.toString());
    }

    ensureWhitespaceParam();

    // GitHub is a single-page app (Turbo), so navigating between pages often
    // updates the URL without a full reload. Re-check whenever the URL changes.
    let lastHref = window.location.href;
    function onUrlMaybeChanged() {
        if (window.location.href === lastHref) return;
        lastHref = window.location.href;
        ensureWhitespaceParam();
    }

    // Hook the history API so we catch programmatic (SPA) navigations.
    for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function () {
            const result = original.apply(this, arguments);
            onUrlMaybeChanged();
            return result;
        };
    }
    window.addEventListener('popstate', onUrlMaybeChanged);

    // Turbo's own navigation event, as a backstop for the history hooks.
    document.addEventListener('turbo:load', onUrlMaybeChanged);
})();
