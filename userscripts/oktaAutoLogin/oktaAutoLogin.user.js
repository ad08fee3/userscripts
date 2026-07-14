// ==UserScript==
// @name         oktaAutoLogin
// @version      1.0
// @description  Automatically check "Remember me" and submit Okta login form if username is pre-filled
// @match        https://*.okta.com/oauth2/v1/authorize*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/oktaAutoLogin/oktaAutoLogin.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/oktaAutoLogin/oktaAutoLogin.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    async function tryAutoLogin() {
        const usernameInput = document.querySelector('input[name="identifier"]');
        const rememberMeCheckbox = document.querySelector('input[name="rememberMe"]');
        const submitButton = document.querySelector('input[type="submit"][data-type="save"]');

        if (!usernameInput || !rememberMeCheckbox || !submitButton) {
            return false;
        }

        // Only proceed if username field has a value
        if (!usernameInput.value.trim()) {
            return true; // Found elements but empty, don't retry
        }

        // Ensure remember me is checked
        if (!rememberMeCheckbox.checked) {
            rememberMeCheckbox.click();

            // Wait a bit and retry if it didn't check
            await new Promise(resolve => setTimeout(resolve, 100));

            if (!rememberMeCheckbox.checked) {
                rememberMeCheckbox.click();
            }
        }

        submitButton.click();
        return true;
    }

    // Retry loop - keep trying until elements are found or username field is found to be empty
    const retryInterval = 500; // milliseconds
    const maxWait = 25000; // milliseconds
    const maxAttempts = Math.ceil(maxWait / retryInterval);
    let attempts = 0;

    const interval = setInterval(async () => {
        attempts++;
        const success = await tryAutoLogin();

        if (success || attempts >= maxAttempts) {
            clearInterval(interval);
        }
    }, retryInterval);
})();
