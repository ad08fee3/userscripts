// ==UserScript==
// @name         autoCloseZoom
// @version      1.0
// @description  Automatically closes Zoom meeting launch tabs once the app launches.
// @match        https://*.zoom.us/j/*
// @match        https://*.zoom.us/wc/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/autoclosers/zoom/autoCloseZoom.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/autoclosers/zoom/autoCloseZoom.user.js
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
    const STORAGE_KEY = 'acz_countdown_sec';

    let countdownSec = Number(GM_getValue(STORAGE_KEY, DEFAULT_COUNTDOWN_SEC));
    if (isNaN(countdownSec) || countdownSec < MIN_SEC || countdownSec > MAX_SEC) {
        countdownSec = DEFAULT_COUNTDOWN_SEC;
    }
    let remaining = countdownSec;
    let intervalId;
    let wrapper;

    function isMeetingLaunched() {
        // Check if the `#success` hash is present (primary signal)
        if (window.location.href.toLowerCase().includes('success')) {
            return true;
        }
        // Check for web client leave page
        if (window.location.pathname.startsWith('/wc/leave')) {
            return true;
        }
        // Check for postattendee page
        if (window.location.pathname.startsWith('/postattendee')) {
            return true;
        }
        // Check for specific page text
        const pageText = document?.body?.innerText?.toLowerCase() || '';
        if (pageText.includes('click open zoom.') ||
            pageText.includes('click launch meeting below') ||
            pageText.includes('meeting has been launched') ||
            pageText.includes('having issues with zoom')) {
            return true;
        }
        return false;
    }

    function setupUI() {
        // --- Styles ---
        const style = document.createElement('style');
        style.textContent = `
            .acz-wrapper {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                margin: auto;
                width: fit-content;
                z-index: 999999;
            }
            .acz-popup {
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
            .acz-countdown {
                margin-bottom: 6px;
            }
            .acz-cancel {
                cursor: pointer;
                font-size: 16px;
                padding: 4px;
                color: #3a3c3e;
                text-decoration: underline;
            }
            .acz-close-now {
                cursor: pointer;
                font-size: 16px;
                font-weight: bold;
                padding: 4px;
                margin-left: 36px;
                color: #3a3c3e;
                text-decoration: underline;
            }
            .acz-settings {
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
            .acz-settings a {
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
        wrapper.className = 'acz-wrapper';
        wrapper.innerHTML = `
            <div class="acz-popup">
                <div class="acz-countdown"></div>
                <a class="acz-cancel">cancel</a>
                <a class="acz-close-now">close now</a>
            </div>
        `;
        document.body.appendChild(wrapper);

        const countdownEl = wrapper.querySelector('.acz-countdown');

        function updateCountdownText() {
            countdownEl.innerText = `Closing tab in ${remaining} second${remaining !== 1 ? 's' : ''}`;
        }

        function renderSettings() {
            wrapper.querySelector('.acz-settings')?.remove();

            const dec = countdownSec - 1;
            const inc = countdownSec + 1;
            const canDec = dec >= MIN_SEC;
            const canInc = inc <= MAX_SEC;
            if (!canDec && !canInc) return;

            const settingsEl = document.createElement('div');
            settingsEl.className = 'acz-settings';

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

        wrapper.querySelector('.acz-close-now').onclick = () => {
            clearInterval(intervalId);
            window.close();
        };

        wrapper.querySelector('.acz-cancel').onclick = () => {
            clearInterval(intervalId);
            wrapper.remove();
        };

        startCountdown();
        renderSettings();
    }

    // Poll until meeting is launched
    let pollTime = 0;
    const pollInterval = setInterval(() => {
        pollTime += POLL_INTERVAL_MS;

        if (isMeetingLaunched()) {
            clearInterval(pollInterval);
            setupUI();
            return;
        }

        if (pollTime >= POLL_MAX_MS) {
            clearInterval(pollInterval);
        }
    }, POLL_INTERVAL_MS);
})();
