// ==UserScript==
// @name         githubDiffWhitespace
// @version      1.3
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

    // GitHub's PR header tabs are React Router <Link>s. On a plain left-click,
    // React Router calls preventDefault() and navigates to a target it captured
    // in a closure when it rendered, NOT the href attribute we rewrote. So our
    // rewrite is invisible to left-clicks: React navigates to /changes (no w),
    // the diff flashes, then ensureWhitespaceParam() does a second full reload to
    // add w=1. To avoid that double-load, we intercept the click ourselves in the
    // capture phase (which fires before React's listener on the root container),
    // stop it from reaching React, and do a single clean navigation to the w=1 URL.
    function onDiffLinkClick(event) {
        // Only plain left-clicks. Let the browser handle middle-click, cmd/ctrl-
        // click (new tab), shift-click (new window), etc. natively, where the
        // rewritten href already does the right thing.
        if (event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const anchor = event.target.closest && event.target.closest('a[href]');
        if (!anchor) return;

        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (!isDiffUrl(url)) return;

        // File-tree links on the diff page point at the same page with just a
        // different #hash to scroll to a file (e.g. /pull/809/files#diff-abc).
        // That's a same-document anchor jump, so leave it alone, otherwise we'd
        // force a full reload (and a stray wait cursor) on every file you click.
        // The tell is the hash: a file-tree link keeps the same pathname and
        // only adds a #fragment. We still intercept a same-path click with no
        // hash (e.g. clicking "Files changed" while already on it), since that
        // really does reload and should show the wait cursor.
        if (url.pathname === window.location.pathname && url.hash) return;

        // Respect an explicit w (including w=0); otherwise add w=1.
        if (!url.searchParams.has('w')) url.searchParams.set('w', '1');

        // Stop React Router from handling this click, then navigate ourselves.
        event.preventDefault();
        event.stopImmediatePropagation();

        // window.location.assign is a full navigation, so there's a beat before
        // the new page loads. Force a wait cursor over everything so the click
        // reads as "working" and you don't click a second time. We use a style
        // rule with !important because links/buttons set their own cursor that
        // would otherwise win; setting body.style.cursor alone isn't enough.
        const waitCursorStyle = document.createElement('style');
        waitCursorStyle.id = 'gdw-wait-cursor';
        waitCursorStyle.textContent = '*, *::before, *::after { cursor: wait !important; }';
        document.documentElement.appendChild(waitCursorStyle);

        window.location.assign(url.toString());
    }
    document.addEventListener('click', onDiffLinkClick, true);

    // The wait-cursor style is meant to last only for the beat between click and
    // the new page loading. But a full navigation freezes this page into the
    // back-forward cache with the style still attached, so returning to it (back/
    // forward, or a refresh restored from bfcache) shows the wait cursor with
    // nothing actually loading. Strip the style as we leave and again if we're
    // restored, so it never outlives the navigation it was created for.
    function removeWaitCursorStyle() {
        const style = document.getElementById('gdw-wait-cursor');
        if (style) style.remove();
    }
    window.addEventListener('pagehide', removeWaitCursorStyle);
    window.addEventListener('pageshow', removeWaitCursorStyle);

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
