// ==UserScript==
// @name         githubDiffWhitespace
// @version      1.1
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

    // On a PR page (e.g. /owner/repo/pull/809 or /pull/809/commits), GitHub links
    // off to the "Files changed" tab at /pull/809/changes without a w param. Rewrite
    // those links so clicking them lands on the diff with whitespace already hidden.
    // Returns the PR number if we're on a pull request page, otherwise null.
    function currentPrNumber() {
        const match = window.location.pathname.match(/^\/[^/]+\/[^/]+\/pull\/(\d+)(?:\/|$)/);
        return match ? match[1] : null;
    }

    function injectWhitespaceParamOnPrLinks() {
        const prNumber = currentPrNumber();
        if (!prNumber) return;

        // Only links pointing at this PR's /changes page, and only when they don't
        // already carry a w param (an existing w=0 is an explicit opt-in we respect).
        const changesPath = new RegExp(`/pull/${prNumber}/changes$`);
        for (const anchor of document.querySelectorAll('a[href]')) {
            const url = new URL(anchor.href, window.location.origin);
            if (!changesPath.test(url.pathname)) continue;
            if (url.searchParams.has('w')) continue;

            url.searchParams.set('w', '1');
            anchor.href = url.toString();
        }
    }

    injectWhitespaceParamOnPrLinks();

    // Links can be added after the initial load (Turbo navigations, lazy rendering),
    // so re-run the rewrite whenever the DOM changes. Guarded so we only observe once.
    const linkObserver = new MutationObserver(injectWhitespaceParamOnPrLinks);
    function startObservingLinks() {
        if (!document.body) return;
        linkObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (document.body) {
        startObservingLinks();
    } else {
        document.addEventListener('DOMContentLoaded', startObservingLinks);
    }

    // GitHub is a single-page app (Turbo), so navigating between pages often
    // updates the URL without a full reload. Re-check whenever the URL changes.
    let lastHref = window.location.href;
    function onUrlMaybeChanged() {
        if (window.location.href === lastHref) return;
        lastHref = window.location.href;
        ensureWhitespaceParam();
        injectWhitespaceParamOnPrLinks();
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
