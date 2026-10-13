// ==UserScript==
// @name         githubWideInlineComments
// @version      1.1
// @description  Widens inline PR review comments by overriding the max-width on GitHub's InlineMarkers comment wrappers to 1000px.
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubWideInlineComments/githubWideInlineComments.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubWideInlineComments/githubWideInlineComments.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const STYLE_ID = 'gh-wide-inline-comments';

    // GitHub hashes its CSS module class names, so the wrapper class has a
    // build-specific suffix (e.g. markersWrapper__QhVNdX). Match on the name plus
    // the trailing `__` so we keep working when that hash changes.
    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '[class*="markersWrapper__"] { max-width: 1000px !important; }';
        (document.head || document.documentElement).appendChild(style);
    }

    injectStyle();

    // At document-start <head> may not exist yet; once the DOM is ready, make sure
    // the style is in place.
    if (!document.head) {
        document.addEventListener('DOMContentLoaded', injectStyle);
    }
})();
