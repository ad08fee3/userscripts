// ==UserScript==
// @name         githubFileTreeColors
// @version      1.4
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
        viewedButton: '[class*="MarkAsViewedButton-module__"]',
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

    // owner/repo#number for the PR the current pathname points at, or null off
    // a PR page. Tab switches within the same PR (changes <-> overview <->
    // commits) each have a distinct pathname but share a slug - wiping on
    // every pathname change would throw away the registry on every tab
    // switch, re-triggering the exact partial-mount race mergeRegistry exists
    // to avoid, and losing any styling state (like a collapsed file) that was
    // never going to reappear in a fresh embedded-JSON snapshot anyway.
    function getPrSlug() {
        const match = window.location.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)/);
        return match ? `${match[1]}#${match[2]}` : null;
    }

    let currentPrSlug = null;

    // getEmbeddedFileStates() parses every JSON script tag on the page - cheap
    // once, wasteful if repeated on every mergeRegistry() pass (mergeRegistry
    // runs on every sync(), which can fire many times per second during a
    // mutation burst). The embedded JSON is fixed for the life of a
    // navigation, so cache it once per PR and invalidate on wipe.
    let cachedEmbeddedStates = null;

    function getColors() {
        const mode = document.documentElement.getAttribute('data-color-mode');
        const dark = mode === 'dark';
        return {
            collapsed:    dark ? '#888888' : '#AAAAAA',
            strikethrough: dark ? '#006eff' : '#0077ff',
        };
    }

    function applyStyles(el, collapsed, viewed, colors, italic = collapsed) {
        const color = collapsed || viewed ? colors.collapsed : '';
        el.style.setProperty('color', color, color ? 'important' : '');
        el.style.fontStyle = italic ? 'italic' : '';
        el.style.textDecoration = viewed ? 'line-through' : '';
        el.style.setProperty('text-decoration-color', viewed ? colors.strikethrough : '', viewed ? 'important' : '');
    }

    // GitHub embeds the PR's diff summary (including a markedAsViewed flag per file)
    // as JSON data islands in the page on load. On a fresh load GitHub only
    // auto-collapses diffs that are already marked viewed, so viewed and collapsed
    // start in lockstep — reading this lets us seed accurate initial state without
    // forcing every lazy diff to render just to inspect its DOM.
    function getEmbeddedFileStates() {
        const states = new Map();
        for (const script of document.querySelectorAll('script[type="application/json"]')) {
            let data;
            try {
                data = JSON.parse(script.textContent);
            } catch {
                continue;
            }
            collectFileStates(data, states);
        }
        return states;
    }

    // Recursively walk a parsed JSON value looking for "diffSummaries" arrays,
    // since the payload key that holds them varies by page (PR files/changes tab,
    // commit page, etc). We don't assume where in the tree it lives.
    function collectFileStates(value, states) {
        if (Array.isArray(value)) {
            for (const item of value) {
                collectFileStates(item, states);
            }
            return;
        }
        if (value && typeof value === 'object') {
            if (Array.isArray(value.diffSummaries)) {
                for (const summary of value.diffSummaries) {
                    if (!summary?.pathDigest) continue;
                    states.set(`diff-${summary.pathDigest}`, { collapsed: !!summary.markedAsViewed, viewed: !!summary.markedAsViewed });
                }
            }
            for (const key of Object.keys(value)) {
                collectFileStates(value[key], states);
            }
        }
    }

    // Merges whatever's currently mounted into files/dirs without ever
    // removing an entry. A rebuild can run against a sidebar that's only
    // partially mounted - e.g. right after Turbo swaps back to an
    // already-visited changes tab, before GitHub finishes re-rendering the
    // tree, or simply because a folder is collapsed and its children aren't
    // in the DOM at that instant - so treating "not currently found" as
    // "doesn't exist" would permanently forget a folder/file the moment it's
    // not visible, and nothing afterward would ever re-add it. Once a file or
    // folder is known, it stays known for the life of this PR; only
    // wipeRegistry (a real navigation to a different PR) is allowed to drop
    // entries.
    function mergeRegistry() {
        if (!cachedEmbeddedStates) cachedEmbeddedStates = getEmbeddedFileStates();
        for (const [hash, state] of cachedEmbeddedStates) {
            if (!files.has(hash)) files.set(hash, state);
        }
        document.querySelectorAll(`#pr-file-tree ${SEL.fileLink}`).forEach(link => {
            const hash = link.getAttribute('href').slice(1);
            if (!files.has(hash)) files.set(hash, { collapsed: false, viewed: false });
        });

        document.querySelectorAll('#pr-file-tree li[role="treeitem"][aria-expanded]').forEach(folder => {
            const label = getFolderLabel(folder);
            if (!label) return;

            // Collect all descendant file hashes (including those nested in sub-folders)
            const childHashes = Array.from(folder.querySelectorAll(SEL.fileLink))
                .map(a => a.getAttribute('href').slice(1))
                .filter(h => files.has(h));
            if (childHashes.length === 0) return;

            // Union with any previously-recorded children rather than
            // overwriting - a folder mounted with fewer visible children now
            // (e.g. collapsed) must not lose children it was known to have.
            const existing = dirs.get(folder.id);
            const merged = existing ? new Set([...existing.childHashes, ...childHashes]) : new Set(childHashes);
            dirs.set(folder.id, { childHashes: [...merged] });
        });
    }

    function wipeRegistry() {
        files.clear();
        dirs.clear();
        cachedEmbeddedStates = null;
    }

    function updateStates() {
        for (const [hash, file] of files) {
            const diffRegion = document.getElementById(hash);
            if (!diffRegion) continue;
            const header = diffRegion.querySelector(SEL.diffHeader);
            if (!header) continue;

            // GitHub virtualizes the diff list: far-off-screen diffs render a
            // lightweight header (file name + collapse toggle) without the
            // mark-as-viewed button until they scroll near the viewport. Until
            // that button mounts, the DOM can't tell us whether the file is
            // viewed, so keep whatever state we already have (seeded from the
            // embedded JSON) rather than clobbering it with a false negative.
            const viewedButton = header.querySelector(SEL.viewedButton);
            if (!viewedButton) continue;

            file.collapsed = header.className.split(' ').some(c => c.includes(CLASS.collapsed));
            file.viewed = viewedButton.className.split(' ').some(c => c.includes(CLASS.viewed));
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

            if (!label.textContent.endsWith('/')) label.textContent += '/';

            const childFiles = dir.childHashes.map(h => files.get(h)).filter(Boolean);
            if (childFiles.length === 0) continue;

            const allCollapsed = childFiles.every(f => f.collapsed);
            const allViewed = childFiles.every(f => f.viewed);
            const isOpen = folder.getAttribute('aria-expanded') === 'true';

            // Always style the label from child states, even if the folder is itself collapsed.
            // Italics reflect the folder's own open/closed state, not its children's collapsed state.
            applyStyles(label, allCollapsed, allViewed, colors, !isOpen);
        }
    }

    function sync() {
        const slug = getPrSlug();
        if (slug && slug !== currentPrSlug) {
            wipeRegistry();
            currentPrSlug = slug;
        }
        // Merged every pass, not just on navigation: it's non-destructive, so
        // running it whenever more of the sidebar has mounted since the last
        // pass (a folder just opened, a virtualized diff scrolled into view,
        // Turbo finished a delayed re-render) lets a file/folder that missed
        // the first snapshot still get picked up later, without ever losing
        // one that was already known.
        mergeRegistry();
        updateStates();
        syncStyles();
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
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            sync();
        });
    }

    sync();

    // Observe documentElement, not body: Turbo Drive navigations (e.g.
    // navigating away to another PR tab and back to the changes tab) can
    // replace document.body wholesale rather than mutating its children,
    // which would silently detach an observer bound to the old body and
    // leave it never firing again for the rest of the page's life.
    // documentElement is never swapped.
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // GitHub is a single-page app (Turbo): switching tabs within a PR (changes
    // <-> overview <-> commits) updates the URL and morphs the DOM, but that
    // morph can rewrite inline styles Turbo doesn't recognize as "ours"
    // without ever touching a class attribute - the mutation observer above
    // only watches class changes, so it can silently miss the exact moment
    // our styling needs reapplying after a tab switch. Hook the history API
    // and Turbo's own navigation event so a landing back on the changes tab
    // always re-triggers sync(), even when the mutation observer alone misses it.
    for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function () {
            const result = original.apply(this, arguments);
            sync();
            return result;
        };
    }
    window.addEventListener('popstate', sync);
    document.addEventListener('turbo:load', sync);
})();
