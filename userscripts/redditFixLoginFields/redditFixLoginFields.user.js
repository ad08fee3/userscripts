// ==UserScript==
// @name         Reddit Login Autofill Fix
// @version      1.0
// @description  Restore Firefox username autofill on Reddit's broken login page.
// @match        https://old.reddit.com/login*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/redditFixLoginFields/redditFixLoginFields.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/redditFixLoginFields/redditFixLoginFields.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const BRIDGE_ID = 'reddit-autofill-bridge';

    // ------------------------------------------------------------
    // 1. Stop Reddit's modal manager stealing focus.
    //
    // Reddit calls focus() on its reddit.com link from focusFirst().
    // Block only that specific target on the login page.
    // ------------------------------------------------------------

    if (!HTMLElement.prototype.__redditFocusPatch) {
        const originalFocus = HTMLElement.prototype.focus;

        HTMLElement.prototype.focus = function (...args) {
            if (
                location.pathname.startsWith('/login') &&
                this instanceof HTMLAnchorElement &&
                this.getAttribute('href') === 'https://www.reddit.com' &&
                this.classList.contains('a')
            ) {
                return;
            }

            return originalFocus.apply(this, args);
        };

        Object.defineProperty(
            HTMLElement.prototype,
            '__redditFocusPatch',
            { value: true }
        );
    }

    // ------------------------------------------------------------
    // 2. Search through open Shadow DOM trees.
    // ------------------------------------------------------------

    function findDeep(root, selector) {
        for (const el of root.querySelectorAll('*')) {
            if (el.matches(selector)) {
                return el;
            }

            if (el.shadowRoot) {
                const found = findDeep(el.shadowRoot, selector);
                if (found) return found;
            }
        }

        return null;
    }

    function findAllDeep(root, selector, results = []) {
        for (const el of root.querySelectorAll('*')) {
            if (el.matches(selector)) {
                results.push(el);
            }

            if (el.shadowRoot) {
                findAllDeep(el.shadowRoot, selector, results);
            }
        }

        return results;
    }

    // ------------------------------------------------------------
    // 3. Create the ordinary HTML form Firefox can recognize.
    // ------------------------------------------------------------

    function createBridge() {
        const form = document.createElement('form');

        form.id = BRIDGE_ID;
        form.autocomplete = 'on';

        form.innerHTML = `
            <div class="reddit-bridge-title">
                Firefox Login Autofill
            </div>

            <label>
                Username
                <input
                    type="text"
                    autocomplete="username"
                    autocapitalize="none"
                    spellcheck="false"
                >
            </label>

            <label>
                Password
                <input
                    type="password"
                    autocomplete="current-password"
                >
            </label>
            <button type="button" class="reddit-bridge-login">
                Log in
            </button>
        `;

        const style = document.createElement('style');

        style.textContent = `
            #${BRIDGE_ID} {
                position: fixed !important;
                top: 12px !important;
                left: 50% !important;
                right: auto !important;
                transform: translateX(-50%) !important;
                z-index: 2147483647 !important;
                width: 270px !important;
                box-sizing: border-box !important;
                padding: 14px !important;
                background: #fff4dc !important;
                color: #222 !important;
                border: 2px solid #d97706 !important;
                border-radius: 8px !important;
                box-shadow: 0 3px 14px #0005 !important;
                font: 14px/1.4 sans-serif !important;
            }

            #${BRIDGE_ID} .reddit-bridge-title {
                font-weight: bold !important;
                margin-bottom: 10px !important;
            }

            #${BRIDGE_ID} label {
                display: block !important;
                margin: 8px 0 !important;
                color: #222 !important;
            }

            #${BRIDGE_ID} input {
                display: block !important;
                box-sizing: border-box !important;
                width: 100% !important;
                height: 32px !important;
                margin-top: 3px !important;
                padding: 5px 7px !important;
                color: #111 !important;
                background: white !important;
                border: 1px solid #888 !important;
                border-radius: 3px !important;
                font: 14px sans-serif !important;
                pointer-events: auto !important;
                user-select: text !important;
            }

            #${BRIDGE_ID} input:focus {
                outline: 2px solid #2563eb !important;
                outline-offset: 1px !important;
            }

            #reddit-autofill-bridge .reddit-bridge-login {
                display: block !important;
                width: 100% !important;
                margin-top: 12px !important;
                padding: 9px !important;
                border: 0 !important;
                border-radius: 4px !important;
                background: #d97706 !important;
                color: white !important;
                font: bold 14px sans-serif !important;
                cursor: pointer !important;
            }

            #reddit-autofill-bridge .reddit-bridge-login:hover {
                background: #b45309 !important;
            }
        `;

        document.documentElement.appendChild(style);

        form.addEventListener('submit', event => {
            event.preventDefault();
        });

        return form;
    }

    // ------------------------------------------------------------
    // 4. Synchronize bridge inputs and Reddit's real inputs.
    // ------------------------------------------------------------

    const boundInputs = new WeakSet();
    let syncing = false;

    function syncValue(source, destination) {
        if (!source || !destination || syncing) return;
        if (destination.value === source.value) return;

        syncing = true;

        destination.value = source.value;

        destination.dispatchEvent(new Event('input', {
            bubbles: true,
            composed: true
        }));

        destination.dispatchEvent(new Event('change', {
            bubbles: true,
            composed: true
        }));

        syncing = false;
    }

    function bindPair(bridgeInput, realInput) {
        if (!bridgeInput || !realInput) return;

        if (!boundInputs.has(realInput)) {
            boundInputs.add(realInput);

            realInput.addEventListener('input', () => {
                syncValue(realInput, bridgeInput);
            });

            realInput.addEventListener('change', () => {
                syncValue(realInput, bridgeInput);
            });
        }

        if (!boundInputs.has(bridgeInput)) {
            boundInputs.add(bridgeInput);

            bridgeInput.addEventListener('input', () => {
                syncValue(bridgeInput, realInput);
            });

            bridgeInput.addEventListener('change', () => {
                syncValue(bridgeInput, realInput);
            });
        }

        // Keep an already populated Reddit field.
        // Otherwise, preserve a value already entered in the bridge.
        if (realInput.value) {
            bridgeInput.value = realInput.value;
        } else if (bridgeInput.value) {
            syncValue(bridgeInput, realInput);
        }
    }

    // ------------------------------------------------------------
    // 5. Locate Reddit's login component and attach the bridge.
    // ------------------------------------------------------------

    function setup() {
        const login = findDeep(document, 'faceplate-form#login');

        if (!login) return;

        let bridge = document.getElementById(BRIDGE_ID);

        if (!bridge) {
            bridge = createBridge();
        }

        // Keep it inside Reddit's login component's light DOM.
        if (bridge.parentElement !== login) {
            login.appendChild(bridge);
        }

        const bridgeUsername =
            bridge.querySelector('input[autocomplete="username"]');

        const bridgePassword =
            bridge.querySelector('input[autocomplete="current-password"]');

        const realUsername = findAllDeep(
            document,
            'input[name="username"]'
        ).find(el => !bridge.contains(el));

        const realPassword = findAllDeep(
            document,
            'input[name="password"]'
        ).find(el => !bridge.contains(el));

        bindPair(bridgeUsername, realUsername);
        bindPair(bridgePassword, realPassword);
        const loginButton =
            bridge.querySelector('.reddit-bridge-login');

        if (!loginButton.dataset.bound) {
            loginButton.dataset.bound = 'true';

            loginButton.addEventListener('click', () => {
                // Find Reddit's actual login button, not the mirror.
                const realLoginButton = findAllDeep(
                    login,
                    'button.login'
                ).find(button =>
                    button.textContent.trim() === 'Log In' &&
                    !button.classList.contains('login-with-oidc')
                );

                if (!realLoginButton) {
                    console.error(
                        '[Reddit Autofill] Actual Reddit Log In button not found'
                    );
                    return;
                }

                // Make sure the latest mirror values are synchronized.
                syncValue(
                    bridgeUsername,
                    realUsername
                );

                syncValue(
                    bridgePassword,
                    realPassword
                );

                realLoginButton.click();
            });
        }
        [bridgeUsername, bridgePassword].forEach(input => {
            if (!input.dataset.enterBound) {
                input.dataset.enterBound = 'true';

                input.addEventListener('keydown', event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        loginButton.click();
                    }
                });
            }
        });
    }

    // Reddit renders its login UI asynchronously.
    // Recheck periodically in case its components are replaced.
    const observer = new MutationObserver(setup);

    observer.observe(document, {
        childList: true,
        subtree: true
    });

    const interval = setInterval(setup, 500);

    setup();

})();
