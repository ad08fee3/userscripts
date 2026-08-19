// ==UserScript==
// @name         hideSignInWithGoogle
// @version      1.0
// @description  Automatically closes Google's "Sign in with Google" popup
// @match        https://accounts.google.com/gsi/iframe/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/hideSignInWithGoogle/hideSignInWithGoogle.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/hideSignInWithGoogle/hideSignInWithGoogle.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SEARCH_INTERVAL_MS = 1000;
    const SEARCH_TIMEOUT_MS = 45000;

    const CLOSE_INTERVAL_MS = 250;
    const CLOSE_TIMEOUT_MS = 5000;

    const LOG_PREFIX = '[Google Popup Auto-Close]';

    let finished = false;

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    function elapsed(startTime) {
        return `${Date.now() - startTime}ms`;
    }

    // -------------------------------------------------------------------------
    // Find a Google "Sign in with Google" popup.
    // -------------------------------------------------------------------------

    function findGooglePopup() {
        const dialogs = document.querySelectorAll(
            '[role="dialog"][aria-label="Sign in with Google"]'
        );

        log(`Found ${dialogs.length} candidate dialog(s).`);

        for (const dialog of dialogs) {
            const elements = dialog.querySelectorAll('*');

            for (const element of elements) {
                const text = (element.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (/^Sign in to .+ with Google$/i.test(text)) {
                    log(`Found Google sign-in popup: "${text}"`);
                    return dialog;
                }
            }
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Find the popup's Close button.
    // -------------------------------------------------------------------------

    function findCloseButton(dialog) {
        if (!dialog || !dialog.isConnected) {
            return null;
        }

        return dialog.querySelector(
            '[role="button"][aria-label="Close"]'
        );
    }

    // -------------------------------------------------------------------------
    // Check whether the popup has disappeared.
    // -------------------------------------------------------------------------

    function popupIsGone(dialog) {
        if (!dialog || !dialog.isConnected) {
            return true;
        }

        const style = getComputedStyle(dialog);

        return (
            dialog.hidden ||
            dialog.getAttribute('aria-hidden') === 'true' ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
        );
    }

    // -------------------------------------------------------------------------
    // Click Close repeatedly until the popup disappears or timeout occurs.
    // -------------------------------------------------------------------------

    function closePopup(dialog) {
        const startTime = Date.now();
        let clickCount = 0;

        log('Popup found. Starting close attempts.');

        function attempt() {
            if (finished) {
                return;
            }

            if (popupIsGone(dialog)) {
                log(
                    `Popup closed successfully after ${clickCount} click(s).`
                );
                finished = true;
                return;
            }

            if (Date.now() - startTime >= CLOSE_TIMEOUT_MS) {
                warn(
                    `Popup did not close after ${elapsed(startTime)}. ` +
                    'Giving up.'
                );
                finished = true;
                return;
            }

            const closeButton = findCloseButton(dialog);

            if (closeButton) {
                clickCount++;

                log(`Clicking Close (#${clickCount}).`);

                try {
                    closeButton.click();
                } catch (error) {
                    warn('Error clicking Close:', error);
                }
            } else {
                log('Close button not found yet; will retry.');
            }

            setTimeout(attempt, CLOSE_INTERVAL_MS);
        }

        attempt();
    }

    // -------------------------------------------------------------------------
    // Search for the popup for up to 15 seconds.
    // -------------------------------------------------------------------------

    function searchForPopup() {
        const startTime = Date.now();
        let checkCount = 0;

        log('Started in Google iframe:', location.href);

        function check() {
            if (finished) {
                return;
            }

            checkCount++;

            const popup = findGooglePopup();

            if (popup) {
                log(
                    `Popup detected after ${elapsed(startTime)} ` +
                    `(${checkCount} searches).`
                );

                // We are done searching forever. From here on out, this
                // instance only deals with this popup.
                closePopup(popup);
                return;
            }

            if (Date.now() - startTime >= SEARCH_TIMEOUT_MS) {
                log(
                    `No popup found after ${elapsed(startTime)}. ` +
                    'Stopping permanently.'
                );
                finished = true;
                return;
            }

            setTimeout(check, SEARCH_INTERVAL_MS);
        }

        check();
    }

    searchForPopup();
})();