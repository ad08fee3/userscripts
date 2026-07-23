// ==UserScript==
// @name         redditCollapseAutomod
// @version      1.0
// @description  Automatically collapses Automod comments (only old.reddit.com)
// @match        https://*.reddit.com/r/*/comments/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/redditCollapseAutomod/redditCollapseAutomod.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/redditCollapseAutomod/redditCollapseAutomod.user.js
// ==/UserScript==

// Inspired by https://update.greasyfork.org/scripts/474910/Reddit%20Collapse%20Automod%20%F0%9F%9B%A1%EF%B8%8F.user.js


(function() {
    let comments = document.querySelectorAll('.comment');
    for (const comment of comments) {
        if (comment.classList.contains('stickied')) {
            comment.classList.add('collapsed');
            comment.classList.remove('noncollapsed');
        }
    }
})();