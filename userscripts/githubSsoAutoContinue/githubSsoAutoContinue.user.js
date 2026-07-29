// ==UserScript==
// @name         githubSsoAutoContinue
// @version      1.0
// @description  Automatically clicks Continue on GitHub's organization single sign-on page.
// @match        https://github.com/orgs/*/sso*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubSsoAutoContinue/githubSsoAutoContinue.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubSsoAutoContinue/githubSsoAutoContinue.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const FORM_SELECTOR = 'form[action*="/saml/initiate"]';
    let submitted = false;

    function clickContinue() {
        if (submitted) return;

        const button = document.querySelector(`${FORM_SELECTOR} button[type="submit"]`);
        if (!button) return;

        submitted = true;
        observer.disconnect();
        button.click();
    }

    // The page can render before the SAML form is in the DOM, so watch for it.
    const observer = new MutationObserver(clickContinue);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    clickContinue();
})();
