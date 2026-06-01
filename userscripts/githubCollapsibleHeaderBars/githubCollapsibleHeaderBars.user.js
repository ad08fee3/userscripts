// ==UserScript==
// @name         githubCollapsibleHeaderBars
// @version      1.2
// @description  Makes GitHub header bars fully clickable to collapse content (PR file headers, comment threads, etc).
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubCollapsibleHeaderBars/githubCollapsibleHeaderBars.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubCollapsibleHeaderBars/githubCollapsibleHeaderBars.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const HANDLED_ATTR = 'data-collapsible-handled';

    const diffFileHandlers = [
        // File diff headers (new React diff UI; class carries a build hash)
        {
            selector: '[class*="DiffFileHeader-module__diff-file-header__"]',
            getButton: (header) => {
                const chevronButton = header.querySelector('button[aria-labelledby] svg.octicon-chevron-down, button[aria-labelledby] svg.octicon-chevron-right');
                return chevronButton ? chevronButton.closest('button') : null;
            }
        },
        // File diff headers (classic/legacy diff UI, still served on commit and
        // compare pages, especially on GitHub Enterprise). The whole bar is
        // .file-header / .js-file-header; the collapse toggle is the
        // "Toggle diff contents" chevron button (button.js-details-target).
        {
            selector: '.js-file-header',
            getButton: (header) => header.querySelector('button.js-details-target')
        },
        // Inline comment thread headers
        {
            selector: '.InlineReviewThread-module__ReviewThreadContainer__iFcNZ',
            getButton: (header) => {
                return header.querySelector('button[data-is-first-collapse-button="true"]');
            }
        }
    ];

    // Map of URL patterns to arrays of handlers
    // Each handler: { selector: string, getButton: function }
    const pageHandlers = new Map([
        // PR Files/Changes page
        [/\/pull\/\d+\/(files|changes)/, diffFileHandlers],
        // Commit page
        [/\/commit\/[0-9a-f]+$/, diffFileHandlers],
        // Branch/ref compare page (.../compare/main...feature)
        [/\/compare\//, diffFileHandlers],
        // PR Overview/Discussion page
        [/\/pull\/\d+\/?$/, [
            // Comment thread headers
            {
                selector: '.d-flex.flex-items-center.p-2.rounded-top-2.bgColor-muted',
                getButton: (header) => {
                    return header.querySelector('button[data-target="review-thread-collapsible.button"]');
                }
            }
        ]]
    ]);

    function makeHeaderCollapsible(header, getButton) {
        if (header.hasAttribute(HANDLED_ATTR)) return;
        header.setAttribute(HANDLED_ATTR, '1');

        const button = getButton(header);
        if (!button) return;

        // Make header cursor a pointer
        header.style.cursor = 'pointer';

        // Click handler for the entire header
        header.addEventListener('click', (e) => {
            // Don't trigger if clicking on interactive elements
            const target = e.target;
            if (target.closest('button') || target.closest('a') || target.closest('input')) {
                return;
            }

            // Click the collapse button
            button.click();
        });
    }

    function processHeaders() {
        const currentPath = window.location.pathname;

        // Find matching URL pattern(s) and process all handlers for that pattern
        for (const [urlPattern, handlers] of pageHandlers) {
            if (urlPattern.test(currentPath)) {
                for (const handler of handlers) {
                    const headers = document.querySelectorAll(handler.selector);
                    headers.forEach(header => makeHeaderCollapsible(header, handler.getButton));
                }
            }
        }
    }

    // Initial processing
    processHeaders();

    // Watch for new headers (handles dynamic loading and URL changes)
    const observer = new MutationObserver(() => {
        processHeaders();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
})();
