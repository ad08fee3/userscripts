// ==UserScript==
// @name         githubFileTreeColors
// @version      1.1
// @description  In the GitHub PR sidebar file tree, grays out and italicizes file names whose diffs are collapsed in the main view.
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubFileTreeColors/githubFileTreeColors.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubFileTreeColors/githubFileTreeColors.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // GitHub-internal CSS-module class names and selectors. These are not a public
    // API and will change without warning, so keep them collected here as the single
    // place to update when the script breaks after a GitHub front-end change.
    const SEL = {
        fileLink: 'a[href^="#diff-"]',
        folderLabel: ':scope > div [class*="PRIVATE_TreeView-item-content-text"] > span',
        diffHeader: '[class*="DiffFileHeader-module__diff-file-header__"]',
        folderToggle: ':scope > div [class*="PRIVATE_TreeView-item-toggle"] svg',
    };
    const CLASS = {
        collapsed: 'DiffFileHeader-module__collapsed__',
        viewed: 'MarkAsViewedButton-module__viewed__',
    };

    function getFolderLabel(folder) {
        return folder.querySelector(SEL.folderLabel);
    }

    // files: diffHash -> { collapsed: bool, viewed: bool }
    // No DOM refs stored — links are looked up live at render time since React
    // re-creates child elements when a folder is expanded in the file tree.
    const files = new Map();

    // dirs: folderId -> { childHashes: string[] }
    // No DOM refs stored — folder and label elements are looked up live at render time.
    const dirs = new Map();

    let registryPath = '';

    function getColors() {
        const mode = document.documentElement.getAttribute('data-color-mode');
        const dark = mode === 'dark';
        return {
            collapsed:    dark ? '#888888' : '#AAAAAA',
            strikethrough: dark ? '#006eff' : '#0077ff',
        };
    }

    function applyStyles(el, collapsed, viewed, colors) {
        const color = collapsed || viewed ? colors.collapsed : '';
        el.style.setProperty('color', color, color ? 'important' : '');
        el.style.fontStyle = collapsed ? 'italic' : '';
        el.style.textDecoration = viewed ? 'line-through' : '';
        el.style.setProperty('text-decoration-color', viewed ? colors.strikethrough : '', viewed ? 'important' : '');
    }

    function buildRegistry() {
        files.clear();
        dirs.clear();

        document.querySelectorAll(`#pr-file-tree ${SEL.fileLink}`).forEach(link => {
            const hash = link.getAttribute('href').slice(1);
            files.set(hash, { collapsed: false, viewed: false });
        });

        document.querySelectorAll('#pr-file-tree li[role="treeitem"][aria-expanded]').forEach(folder => {
            const label = getFolderLabel(folder);
            if (!label) return;

            // Collect all descendant file hashes (including those nested in sub-folders)
            const childHashes = Array.from(folder.querySelectorAll(SEL.fileLink))
                .map(a => a.getAttribute('href').slice(1))
                .filter(h => files.has(h));
            if (childHashes.length === 0) return;

            dirs.set(folder.id, { childHashes });
        });

        registryPath = window.location.pathname;
    }

    function needsRebuild() {
        if (files.size === 0) return true;
        // Only rebuild when the PR itself changes (SPA navigation), not on folder expand/collapse
        return window.location.pathname !== registryPath;
    }

    function updateStates() {
        for (const [hash, file] of files) {
            const diffRegion = document.getElementById(hash);
            if (!diffRegion) continue;
            const header = diffRegion.querySelector(SEL.diffHeader);
            if (!header) continue;

            file.collapsed = header.className.split(' ').some(c => c.includes(CLASS.collapsed));
            file.viewed = !!header.querySelector(`[class*="${CLASS.viewed}"]`);
        }
    }

    function syncStyles() {
        const colors = getColors();

        for (const [hash, file] of files) {
            const link = document.querySelector(`#pr-file-tree a[href="#${hash}"]`);
            if (!link) continue;
            applyStyles(link, file.collapsed, file.viewed, colors);
        }

        for (const [id, dir] of dirs) {
            const folder = document.getElementById(id);
            if (!folder) continue;
            const label = getFolderLabel(folder);
            if (!label) continue;

            const childFiles = dir.childHashes.map(h => files.get(h)).filter(Boolean);
            if (childFiles.length === 0) continue;

            const allCollapsed = childFiles.every(f => f.collapsed);
            const allViewed = childFiles.every(f => f.viewed);

            // Always style the label from child states, even if the folder is itself collapsed
            applyStyles(label, allCollapsed, allViewed, colors);
        }
    }

    function sync() {
        if (needsRebuild()) buildRegistry();
        updateStates();
        syncStyles();
    }

    // Covers the diff content area with a spinner while forceRenderAllDiffs scrolls
    // the page around, so the user sees a loading state instead of the page jumping.
    // The overlay is `position: fixed` (viewport-relative, not document-relative) so
    // it stays put over the visible window while the page underneath grows and
    // scrolls, and it's a flex container so the spinner centers itself. GitHub keeps
    // mutating the diff list (syntax highlighting, height recalculation, etc.) for a
    // bit after our own scroll loop finishes, so hiding is debounced until DOM
    // activity in the diff list actually goes quiet — but capped by OVERLAY_MAX_MS so
    // a page that never settles can't leave the overlay stuck up forever.
    const OVERLAY_ID = 'gh-file-tree-colors-loading-overlay';
    const SPINNER_STYLE_ID = 'gh-file-tree-colors-spinner-style';
    const OVERLAY_QUIET_MS = 700;
    const OVERLAY_MAX_MS = 8000;

    let overlayEl = null;
    let hideOverlayTimer = null;
    let overlayDeadline = 0;

    // Aligns the overlay with the content column. Called at show time and on resize,
    // so the overlay keeps tracking the column if the window or sidebar width changes
    // while diffs load.
    function positionOverlay() {
        if (!overlayEl) return;
        const container = document.querySelector('[data-component="PageLayout.Content"]');
        if (!container) return;
        const rect = container.getBoundingClientRect();
        overlayEl.style.left = `${rect.left}px`;
        overlayEl.style.width = `${rect.width}px`;
    }

    function showLoadingOverlay() {
        if (overlayEl) return;

        const container = document.querySelector('[data-component="PageLayout.Content"]');
        if (!container) return;

        if (!document.getElementById(SPINNER_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = SPINNER_STYLE_ID;
            style.textContent = '@keyframes gh-file-tree-colors-spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }

        const dark = document.documentElement.getAttribute('data-color-mode') === 'dark';

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = `
            position: fixed; z-index: 100;
            top: 0; height: 100vh;
            display: flex; align-items: center; justify-content: center;
            background: ${dark ? 'rgba(13,17,23,0.75)' : 'rgba(255,255,255,0.75)'};
        `;

        const ring = document.createElement('div');
        ring.style.cssText = `
            width: 48px; height: 48px; border-radius: 50%;
            border: 5px solid rgba(128,128,128,0.3);
            border-top-color: ${dark ? '#2f81f7' : '#0969da'};
            animation: gh-file-tree-colors-spin 0.8s linear infinite;
        `;
        overlay.appendChild(ring);

        document.body.appendChild(overlay);
        overlayEl = overlay;
        overlayDeadline = performance.now() + OVERLAY_MAX_MS;
        positionOverlay();
        window.addEventListener('resize', positionOverlay);
    }

    function hideLoadingOverlay() {
        clearTimeout(hideOverlayTimer);
        hideOverlayTimer = null;
        window.removeEventListener('resize', positionOverlay);
        overlayEl?.remove();
        overlayEl = null;
    }

    // Postpones hideLoadingOverlay: called once when our own scroll loop finishes,
    // and again on every relevant mutation seen while the overlay is up, so it only
    // actually hides once the diff list has been quiet for OVERLAY_QUIET_MS. The
    // OVERLAY_MAX_MS deadline is a hard ceiling so a page that keeps mutating can't
    // keep re-arming the debounce indefinitely.
    function requestHideOverlay() {
        if (!overlayEl) return;
        clearTimeout(hideOverlayTimer);
        const remaining = overlayDeadline - performance.now();
        if (remaining <= 0) {
            hideLoadingOverlay();
            return;
        }
        hideOverlayTimer = setTimeout(hideLoadingOverlay, Math.min(OVERLAY_QUIET_MS, remaining));
    }

    // GitHub lazy-loads diff content via IntersectionObserver — diffs outside the viewport
    // are never inserted into the DOM until they scroll into view. This scrolls to the bottom
    // in steps (two frames each to let GitHub's observers fire), then restores position.
    // The CSS override handles content-visibility: auto in case GitHub uses that too.
    function forceRenderAllDiffs(onDone) {
        const style = document.createElement('style');
        style.textContent = '[data-testid="progressive-diffs-list"] > * { content-visibility: visible !important; }';
        document.head.appendChild(style);

        const scrollEl = document.scrollingElement || document.documentElement;
        const savedTop = scrollEl.scrollTop;

        function step() {
            const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
            if (atBottom) {
                scrollEl.scrollTop = savedTop;
                requestAnimationFrame(onDone);
                return;
            }
            scrollEl.scrollTop += window.innerHeight;
            // Two frames: one for layout, one for GitHub's IntersectionObserver callbacks
            requestAnimationFrame(() => requestAnimationFrame(step));
        }

        requestAnimationFrame(step);
    }

    // Coalesce the bursts of mutations React fires per interaction into one sync
    // per animation frame, so a large PR runs a single DOM sweep instead of dozens.
    let scheduled = false;
    function scheduleSync(mutations) {
        // Ignore class changes that aren't on diff headers or the file tree — this
        // filters out hover/focus churn on buttons, sidebar items, etc.
        const relevant = mutations.some(m => {
            if (m.type === 'childList') return true;
            if (m.type === 'attributes') {
                // Only care about class changes inside the diff list or file tree
                const diffList = document.querySelector('[data-testid="progressive-diffs-list"]');
                const fileTree = document.getElementById('pr-file-tree');
                return (diffList?.contains(m.target) || fileTree?.contains(m.target)) ?? false;
            }
            return false;
        });
        if (!relevant) {
            return;
        }
        requestHideOverlay();
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            sync();
        });
    }

    // forceRenderAllDiffs scrolls the whole page to force-load lazy diffs, which is
    // only meaningful (and not disruptive) on the PR diff view itself, e.g.
    // https://github.com/owner/repo/pull/123/files or .../pull/123/changes
    function isPRDiffPage() {
        return /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)(\/|$)/.test(window.location.pathname);
    }

    if (isPRDiffPage()) {
        showLoadingOverlay();
        forceRenderAllDiffs(() => {
            sync();
            requestHideOverlay();
        });
    } else {
        sync();
    }

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();
