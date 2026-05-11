// ==UserScript==
// @name         githubAutoSso
// @version      1.1
// @description  Automatically opens the GitHub SSO banner link in a background tab, then closes it after auth completes.
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubAutoSso/githubAutoSso.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubAutoSso/githubAutoSso.user.js
// @grant        GM_openInTab
// @grant        window.close
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const HANDLED_ATTR = 'data-ghas-handled';
    const CLOSE_PATH = '/auto_close_this_tab';
    const openedOrgs = new Set();

    // After SSO completes, GitHub redirects to return_to. Close if that's us.
    if (window.location.pathname === CLOSE_PATH) {
        window.close();
        return;
    }

    function buildSsoUrl(originalHref) {
        const url = new URL(originalHref, window.location.origin);
        url.searchParams.set('return_to', CLOSE_PATH);
        return url.toString();
    }

    // Returns [{login, name}, ...] from page-embedded JSON, or null if not found.
    function getSsoOrgs() {
        const partialScript = document.querySelector(
            'react-partial[partial-name="global-sso-banner"] script[data-target="react-partial.embeddedData"]'
        );
        if (partialScript) {
            try {
                const orgs = JSON.parse(partialScript.textContent)?.props?.ssoOrgs;
                if (Array.isArray(orgs) && orgs.length > 0) return orgs;
            } catch (e) {}
        }

        for (const script of document.querySelectorAll('react-app script[data-target="react-app.embeddedData"]')) {
            try {
                const data = JSON.parse(script.textContent);
                const orgs = data?.payload?.pullsDashboardSurfaceLayoutRoute?.sso?.sso_organizations
                    || data?.appPayload?.sso_organizations;
                if (Array.isArray(orgs) && orgs.length > 0) return orgs;
            } catch (e) {}
        }

        return null;
    }

    function handleBanner(banner) {
        if (banner.hasAttribute(HANDLED_ATTR)) return;
        banner.setAttribute(HANDLED_ATTR, '1');

        const orgs = getSsoOrgs();
        if (orgs) {
            const description = banner.querySelector('[data-component="Banner.Description"]');
            const bannerText = description ? description.textContent : banner.textContent;

            for (const org of orgs) {
                if (bannerText.includes(org.name) && !openedOrgs.has(org.login)) {
                    openedOrgs.add(org.login);
                    const url = `${window.location.origin}/orgs/${org.login}/sso?return_to=${encodeURIComponent(CLOSE_PATH)}`;
                    GM_openInTab(url, { active: false, insert: true });
                }
            }
            return;
        }

        // Fallback for single-link banner with no embedded org data.
        const link = banner.querySelector('a[href*="/sso"]');
        if (!link) return;

        openBackground(buildSsoUrl(link.href), { active: false, insert: true });
    }

    function checkForBanner() {
        const banner = document.querySelector('[data-testid="global-sso-banner"]');
        if (banner) handleBanner(banner);
    }

    checkForBanner();

    new MutationObserver(checkForBanner).observe(document.body, {
        childList: true,
        subtree: true,
    });
})();
