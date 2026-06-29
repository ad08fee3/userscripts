// ==UserScript==
// @name         githubFileTreeColors
// @version      1.0
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
        if (!relevant || scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            sync();
        });
    }

    forceRenderAllDiffs(sync);

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();
