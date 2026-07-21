// ==UserScript==
// @name         autoCloseAwsSso
// @version      1.2
// @description  Automatically closes AWS SSO tabs after login.
// @match        http://127.0.0.1/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/autoclosers/awsSso/autoCloseAwsSso.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/autoclosers/awsSso/autoCloseAwsSso.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        window.close
// @run-at       document-idle
// ==/UserScript==

(function () {
    const TARGET_TEXT = 'Your credentials have been shared successfully and can be used until your session expires. You can now close this tab.';
    const DEFAULT_COUNTDOWN_SEC = 5;
    const MIN_SEC = 1;
    const MAX_SEC = 60;
    const INTERVAL_MS = 1000;
    const STORAGE_KEY = 'acas_countdown_sec';

    if (!document.body || !document.body.innerText.includes(TARGET_TEXT)) return;

    let countdownSec = Number(GM_getValue(STORAGE_KEY, DEFAULT_COUNTDOWN_SEC));
    if (isNaN(countdownSec) || countdownSec < MIN_SEC || countdownSec > MAX_SEC) {
        countdownSec = DEFAULT_COUNTDOWN_SEC;
    }
    let remaining = countdownSec;
    let intervalId;

    // --- Styles ---
    const style = document.createElement('style');
    style.textContent = `
        .acas-wrapper {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            margin: auto;
            width: fit-content;
            z-index: 999999;
        }
        .acas-popup {
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
        .acas-countdown {
            margin-bottom: 6px;
        }
        .acas-cancel {
            cursor: pointer;
            font-size: 16px;
            padding: 4px;
            color: #3a3c3e;
            text-decoration: underline;
        }
        .acas-close-now {
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            padding: 4px;
            margin-left: 36px;
            color: #3a3c3e;
            text-decoration: underline;
        }
        .acas-settings {
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
        .acas-settings a {
            cursor: pointer;
            font-size: 12px;
            padding: 1px;
            color: #1e1e1f;
            text-decoration: underline;
        }
    `;
    document.head.appendChild(style);

    // --- DOM ---
    const wrapper = document.createElement('div');
    wrapper.className = 'acas-wrapper';
    wrapper.innerHTML = `
        <div class="acas-popup">
            <div class="acas-countdown"></div>
            <a class="acas-cancel">cancel</a>
            <a class="acas-close-now">close now</a>
        </div>
    `;
    document.body.appendChild(wrapper);

    const countdownEl = wrapper.querySelector('.acas-countdown');

    function updateCountdownText() {
        countdownEl.innerText = `Closing tab in ${remaining} second${remaining !== 1 ? 's' : ''}`;
    }

    function renderSettings() {
        wrapper.querySelector('.acas-settings')?.remove();

        const dec = countdownSec - 1;
        const inc = countdownSec + 1;
        const canDec = dec >= MIN_SEC;
        const canInc = inc <= MAX_SEC;
        if (!canDec && !canInc) return;

        const settingsEl = document.createElement('div');
        settingsEl.className = 'acas-settings';

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

    wrapper.querySelector('.acas-close-now').onclick = () => {
        clearInterval(intervalId);
        window.close();
    };

    wrapper.querySelector('.acas-cancel').onclick = () => {
        clearInterval(intervalId);
        wrapper.remove();
    };

    startCountdown();
    renderSettings();
})();
