// ==UserScript==
// @name         githubDiffWhitespace
// @version      1.5
// @description  Adds the whitespace param (w=1) to links pointing at GitHub compare pages when it's missing. Leaves w=0 alone so you can still opt back in to seeing whitespace.
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubDiffWhitespace/githubDiffWhitespace.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubDiffWhitespace/githubDiffWhitespace.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // GitHub hides whitespace by default on PR diffs now, but links to compare
    // pages (e.g. /owner/repo/compare/abc123..def456) still open with whitespace
    // shown. Rewrite those links to add w=1, unless they already have a w param
    // (an existing w=0 is an explicit choice, so we never overwrite it).
    const comparePath = /^\/[^/]+\/[^/]+\/compare\//;

    function injectWhitespaceParamOnCompareLinks() {
        for (const anchor of document.querySelectorAll('a[href]')) {
            const url = new URL(anchor.href, window.location.origin);
            if (url.origin !== window.location.origin) continue;
            if (!comparePath.test(url.pathname)) continue;
            if (url.searchParams.has('w')) continue;

            url.searchParams.set('w', '1');
            anchor.href = url.toString();
        }
    }

    // Links can be added after the initial load (Turbo navigations, lazy rendering),
    // so re-run the rewrite whenever the DOM changes.
    const linkObserver = new MutationObserver(injectWhitespaceParamOnCompareLinks);
    function startObservingLinks() {
        injectWhitespaceParamOnCompareLinks();
        linkObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (document.body) {
        startObservingLinks();
    } else {
        document.addEventListener('DOMContentLoaded', startObservingLinks);
    }
})();
