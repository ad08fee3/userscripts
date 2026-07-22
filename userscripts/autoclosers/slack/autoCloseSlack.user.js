// ==UserScript==
// @name         autoCloseSlack
// @version      1.1
// @description  Automatically closes Slack redirect pages once the app launches.
// @match        https://*.slack.com/archives/*
// @match        https://*.slack.com/app_redirect*
// @match        https://*.slack.com/ssb/signin_redirect*
// @match        https://*.enterprise.slack.com/?redir=*signin_redirect*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/autoclosers/slack/autoCloseSlack.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/autoclosers/slack/autoCloseSlack.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        window.close
// @run-at       document-idle
// ==/UserScript==

(function () {
    const DEFAULT_COUNTDOWN_SEC = 5;
    const MIN_SEC = 1;
    const MAX_SEC = 60;
    const INTERVAL_MS = 1000;
    const POLL_INTERVAL_MS = 500;
    const POLL_MAX_MS = 30000;
    const STORAGE_KEY = 'acsl_countdown_sec';

    let countdownSec = Number(GM_getValue(STORAGE_KEY, DEFAULT_COUNTDOWN_SEC));
    if (isNaN(countdownSec) || countdownSec < MIN_SEC || countdownSec > MAX_SEC) {
        countdownSec = DEFAULT_COUNTDOWN_SEC;
    }
    let remaining = countdownSec;
    let intervalId;
    let wrapper;

    function isRedirectPageDetected() {
        const pageText = document?.body?.innerText?.toLowerCase() || '';
        if (pageText.includes('redirecting to') ||
            pageText.includes('redirected you') ||
            pageText.includes('launching')) {
            return true;
        }

        const url = window.location.href;
        if (url.includes('redir=') && url.includes('signin_redirect')) {
            return true;
        }

        return false;
    }

    function setupUI() {
        // --- Styles ---
        const style = document.createElement('style');
        style.textContent = `
            .acsl-wrapper {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                margin: auto;
                width: fit-content;
                z-index: 999999;
            }
            .acsl-popup {
                margin-top: 8px;
                padding: 6px 12px;
                text-align: center;
                color: #3a3c3e;
                font-size: 18px;
                font-weight: 400;
                font-family: sans-serif;
                text-shadow: 0 0 2px white, 0 0 4px white, 0 0 6px snow, 0 0 10px snow;
                background: hsla(0, 0%, 100%, 90%);
                box-shadow: 0px 1px 10px 1px rgba(0,0,0,0.67);
                border-radius: 4px;
            }
            .acsl-countdown {
                margin-bottom: 6px;
            }
            .acsl-cancel {
                cursor: pointer;
                font-size: 16px;
                padding: 4px;
                color: #3a3c3e;
                text-decoration: underline;
            }
            .acsl-close-now {
                cursor: pointer;
                font-size: 16px;
                font-weight: bold;
                padding: 4px;
                margin-left: 36px;
                color: #3a3c3e;
                text-decoration: underline;
            }
            .acsl-settings {
                margin-top: 6px;
                padding: 6px 10px;
                text-align: center;
                color: #1e1e1f;
                font-size: 12px;
                font-family: sans-serif;
                background: rgb(255 240 178 / 80%);
                box-shadow: 0px 1px 5px 1px rgba(0,0,0,0.33);
                border-radius: 2px;
            }
            .acsl-settings a {
                cursor: pointer;
                font-size: 12px;
                padding: 1px;
                color: #1e1e1f;
                text-decoration: underline;
            }
        `;
        document.head.appendChild(style);

        // --- DOM ---
        wrapper = document.createElement('div');
        wrapper.className = 'acsl-wrapper';
        wrapper.innerHTML = `
            <div class="acsl-popup">
                <div class="acsl-countdown"></div>
                <a class="acsl-cancel">cancel</a>
                <a class="acsl-close-now">close now</a>
            </div>
        `;
        document.body.appendChild(wrapper);

        const countdownEl = wrapper.querySelector('.acsl-countdown');

        function updateCountdownText() {
            countdownEl.innerText = `Closing tab in ${remaining} second${remaining !== 1 ? 's' : ''}`;
        }

        function renderSettings() {
            wrapper.querySelector('.acsl-settings')?.remove();

            const dec = countdownSec - 1;
            const inc = countdownSec + 1;
            const canDec = dec >= MIN_SEC;
            const canInc = inc <= MAX_SEC;
            if (!canDec && !canInc) return;

            const settingsEl = document.createElement('div');
            settingsEl.className = 'acsl-settings';

            let html = `${countdownSec} second${countdownSec !== 1 ? 's' : ''} not your speed? Try `;
            if (canDec) html += `<a data-sec="${dec}">${dec}s</a>`;
            if (canDec && canInc) html += ` or `;
            if (canInc) html += `<a data-sec="${inc}">${inc}s</a>`;
            settingsEl.innerHTML = html;

            settingsEl.querySelectorAll('a').forEach(a => {
                a.onclick = () => {
                    countdownSec = Number(a.dataset.sec);
                    GM_setValue(STORAGE_KEY, countdownSec);
                    remaining = countdownSec;
                    clearInterval(intervalId);
                    startCountdown();
                    renderSettings();
                };
            });

            wrapper.appendChild(settingsEl);
        }

        function startCountdown() {
            updateCountdownText();
            intervalId = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    clearInterval(intervalId);
                    window.close();
                    return;
                }
                updateCountdownText();
            }, INTERVAL_MS);
        }

        wrapper.querySelector('.acsl-close-now').onclick = () => {
            clearInterval(intervalId);
            window.close();
        };

        wrapper.querySelector('.acsl-cancel').onclick = () => {
            clearInterval(intervalId);
            wrapper.remove();
        };

        startCountdown();
        renderSettings();
    }

    // Poll until redirect page is detected
    let pollTime = 0;
    const pollInterval = setInterval(() => {
        pollTime += POLL_INTERVAL_MS;

        if (isRedirectPageDetected()) {
            clearInterval(pollInterval);
            setupUI();
            return;
        }

        if (pollTime >= POLL_MAX_MS) {
            clearInterval(pollInterval);
        }
    }, POLL_INTERVAL_MS);
})();
