// ==UserScript==
// @name         oktaBackgroundLogin
// @version      1.0
// @description  Okta doesn't like to log in unless the tab is focused. This makes it log in even if it's in the background.
// @match        https://*.okta.com/app/bookmark/*/login
// @match        https://*.okta.com/oauth2/*/*
// @match        https://*.okta.com/app/*/*/sso/saml
// @match        https://*.okta.com/app/*/*/sso/saml?*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/oktaBackgroundLogin/oktaBackgroundLogin.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/oktaBackgroundLogin/oktaBackgroundLogin.user.js
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    function inject() {
        const code = `
            (() => {
                const override = (obj, prop, value) => {
                    try {
                        Object.defineProperty(obj, prop, {
                            get: () => value,
                            configurable: true
                        });
                    } catch (e) {
                        console.debug('override failed', prop, e);
                    }
                };

                override(Document.prototype, 'hidden', false);
                override(Document.prototype, 'visibilityState', 'visible');
                override(Document.prototype, 'webkitHidden', false);
                override(Document.prototype, 'webkitVisibilityState', 'visible');

                try {
                    document.hasFocus = () => true;
                } catch (e) {}

                try {
                    window.hasFocus = () => true;
                } catch (e) {}

                const origAdd = EventTarget.prototype.addEventListener;
                EventTarget.prototype.addEventListener = function(type, listener, options) {
                    if (this === document && /visibilitychange/i.test(type)) {
                        console.debug('[tm] blocked', type);
                        return;
                    }
                    if (this === window && /blur/i.test(type)) {
                        console.debug('[tm] blocked', type);
                        return;
                    }
                    return origAdd.call(this, type, listener, options);
                };

                try {
                    Object.defineProperty(document, 'onvisibilitychange', {
                        get: () => null,
                        set: () => {},
                        configurable: true
                    });
                } catch (e) {}

                try {
                    Object.defineProperty(window, 'onblur', {
                        get: () => null,
                        set: () => {},
                        configurable: true
                    });
                } catch (e) {}

                setTimeout(() => {
                    try { window.dispatchEvent(new Event('focus')); } catch (e) {}
                    try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
                }, 50);

                console.debug('[tm] visibility spoof installed');
            })();
        `;

        const s = document.createElement('script');

        const nonceScript = document.querySelector('script[nonce]');
        if (nonceScript) {
            s.setAttribute('nonce', nonceScript.nonce || nonceScript.getAttribute('nonce'));
        }

        s.textContent = code;
        (document.documentElement || document.head || document).appendChild(s);
        s.remove();
    }

    if (document.documentElement) {
        inject();
    } else {
        new MutationObserver((_, obs) => {
            if (document.documentElement) {
                obs.disconnect();
                inject();
            }
        }).observe(document, { childList: true, subtree: true });
    }
})();
