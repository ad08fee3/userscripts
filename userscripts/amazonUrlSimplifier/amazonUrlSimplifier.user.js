// ==UserScript==
// @name         amazonUrlSimplifier
// @version      1.0
// @description  Simplifies Amazon product URLs to https://www.amazon.*/dp/[ASIN]
// @match        https://www.amazon.com/*/dp/*
// @match        https://www.amazon.com/dp/*
// @match        https://www.amazon.com/gp/product/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/amazonUrlSimplifier/amazonUrlSimplifier.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/amazonUrlSimplifier/amazonUrlSimplifier.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function getCleanUrl() {
        var url = new URL(window.location.href);

        // Match /dp/ASIN or /gp/product/ASIN
        var match = url.pathname.match(/\/dp\/([A-Za-z0-9]+)/);

        if (!match) {
            match = url.pathname.match(/\/gp\/product\/([A-Za-z0-9]+)/);
        }

        if (!match) {
            return null;
        }

        return 'https://' + url.host + '/dp/' + match[1];
    }

    function simplifyUrl() {
        var cleanUrl = getCleanUrl();

        if (cleanUrl && window.location.href !== cleanUrl) {
            console.log('Simplifying Amazon URL:', cleanUrl);
            history.replaceState(history.state, '', cleanUrl);
            return cleanUrl;
        }
    }

    // Clean the URL immediately.
    var cleanUrl = simplifyUrl();

    // Amazon may change the URL using pushState/replaceState.
    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;

    history.pushState = function() {
        originalPushState.apply(this, arguments);
        simplifyUrl();
    };

    history.replaceState = function() {
        originalReplaceState.apply(this, arguments);
        simplifyUrl();
    };

    // Handle browser back/forward navigation.
    window.addEventListener('popstate', simplifyUrl);

    // Amazon may also modify location without using the History API.
    // Watch for those changes without constantly polling.
    var lastUrl = cleanUrl;

    setInterval(function() {
        var currentUrl = window.location.href;

        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            simplifyUrl();
        }
    }, 500);

})();
