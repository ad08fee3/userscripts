// ==UserScript==
// @name         githubFileTreeColors
// @version      1.8
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
        // The PR page's sidebar tree has an id; a commit page's has only its
        // aria-label. The legacy PR /files page's tree is a <file-tree> element.
        fileTree: '#pr-file-tree, ul[role="tree"][aria-label="File Tree"], file-tree',
        // Diff list containers, for filtering attribute mutations: the PR page's
        // the commit page's, and the legacy PR /files page's.
        diffList: '[data-testid="progressive-diffs-list"], #diff-content-parent, #files',
        // A commit page's diff entry: the region wrapping a header whose file
        // link points at #diff-<pathDigest> (the entry itself has no such id).
        diffEntryRegion: 'div[role="region"]',
        folderLabel: ':scope > div [class*="PRIVATE_TreeView-item-content-text"] > span, :scope > button .ActionList-item-label',
        // The legacy tree puts aria-expanded on the folder's inner button
        // instead, and marks the folder itself with data-tree-entry-type.
        folder: 'li[role="treeitem"][aria-expanded], li[role="treeitem"][data-tree-entry-type="directory"]',
        // The legacy tree's file name sets its own color, so styling the
        // link alone doesn't reach it.
        legacyFileLabel: '.ActionList-item-label',
        diffHeader: '[class*="diff-file-header__"], .file-header',
        folderToggle: ':scope > div [class*="PRIVATE_TreeView-item-toggle"] svg',
        // The header's collapse chevron points right while the file is collapsed.
        // Used instead of a collapsed CSS-module class, whose hashed name GitHub
        // reships without warning.
        collapsedChevron: 'button[aria-labelledby] svg.octicon-chevron-right',
        // Legacy diff: both chevrons are always in the DOM, so collapsed state
        // is this button's aria-expanded instead.
        legacyCollapseButton: 'button.js-details-target[aria-label="Toggle diff contents"]',
        legacyViewedCheckbox: 'input.js-reviewed-checkbox',
        // The mark-as-viewed toggle, labeled "Viewed" or "Not Viewed". Its
        // aria-pressed attribute is the viewed state, so no hashed class name is
        // needed.
        viewedButton: 'button[aria-pressed][aria-label="Viewed"], button[aria-pressed][aria-label="Not Viewed"]',
    };

    function getFileTree() {
        return document.querySelector(SEL.fileTree);
    }

    // Builds "descendant inside any of ancestors". Any SEL value may be a
    // selector list, and plain concatenation ("A, B a[...]") only qualifies the
    // last alternative, leaving A matching on its own. :is() applies the
    // descendant to every alternative.
    function within(ancestors, descendant) {
        return `:is(${ancestors}) ${descendant}`;
    }

    function getDiffRegion(hash) {
        return document.getElementById(hash) ??
            document.querySelector(within(SEL.diffHeader, `a[href="#${hash}"]`))?.closest(SEL.diffEntryRegion) ??
            null;
    }

    function getFolderLabel(folder) {
        return folder.querySelector(SEL.folderLabel);
    }

    // The React tree derives each folder's id from its path. The legacy tree's
    // folders have no id, so the chain of folder labels down to this one (each
    // label is a path segment, possibly several joined with "/") stands in.
    function getFolderKey(folder) {
        if (folder.id) return folder.id;
        const labels = [];
        for (let f = folder; f; f = f.parentElement?.closest(SEL.folder)) {
            // Strips the "/" syncStyles appends, so the key doesn't change after styling.
            const label = getFolderLabel(f)?.textContent.replace(/\/\s*$/, '').trim();
            if (!label) return '';
            labels.unshift(label);
        }
        return labels.join('/');
    }

    function findFolder(key) {
        return document.getElementById(key) ??
            [...(getFileTree()?.querySelectorAll(SEL.folder) ?? [])].find(f => getFolderKey(f) === key) ??
            null;
    }

    function isFolderOpen(folder) {
        const expanded = folder.getAttribute('aria-expanded') ?? folder.querySelector(':scope > button')?.getAttribute('aria-expanded');
        return expanded === 'true';
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
        const tree = getFileTree();
        if (!tree) return;
        tree.querySelectorAll(SEL.fileLink).forEach(link => {
            const hash = link.getAttribute('href').slice(1);
            if (!files.has(hash)) files.set(hash, { collapsed: false, viewed: false });
        });

        tree.querySelectorAll(SEL.folder).forEach(folder => {
            const label = getFolderLabel(folder);
            if (!label) return;
            const key = getFolderKey(folder);
            if (!key) return;

            // Collect all descendant file hashes (including those nested in sub-folders)
            const childHashes = Array.from(folder.querySelectorAll(SEL.fileLink))
                .map(a => a.getAttribute('href').slice(1))
                .filter(h => files.has(h));
            if (childHashes.length === 0) return;

            // Union with any previously-recorded children rather than
            // overwriting - a folder mounted with fewer visible children now
            // (e.g. collapsed) must not lose children it was known to have.
            const existing = dirs.get(key);
            const merged = existing ? new Set([...existing.childHashes, ...childHashes]) : new Set(childHashes);
            dirs.set(key, { childHashes: [...merged] });
        });
    }

    function wipeRegistry() {
        files.clear();
        dirs.clear();
        cachedEmbeddedStates = null;
    }

    function updateStates() {
        for (const [hash, file] of files) {
            const diffRegion = getDiffRegion(hash);
            if (!diffRegion) continue;
            const header = diffRegion.querySelector(SEL.diffHeader);
            if (!header) continue;

            // The collapse chevron renders even in the lightweight virtualized
            // header described below, so collapsed state is always readable.
            const legacyButton = header.querySelector(SEL.legacyCollapseButton);
            file.collapsed = legacyButton
                ? legacyButton.getAttribute('aria-expanded') === 'false'
                : header.querySelector(SEL.collapsedChevron) !== null;

            const legacyViewed = header.querySelector(SEL.legacyViewedCheckbox);
            if (legacyViewed) {
                file.viewed = legacyViewed.checked;
                continue;
            }

            // GitHub virtualizes the diff list: far-off-screen diffs render a
            // lightweight header (file name + collapse toggle) without the
            // mark-as-viewed button until they scroll near the viewport. Until
            // that button mounts, the DOM can't tell us whether the file is
            // viewed, so keep whatever state we already have (seeded from the
            // embedded JSON) rather than clobbering it with a false negative.
            const viewedButton = header.querySelector(SEL.viewedButton);
            if (!viewedButton) continue;

            file.viewed = viewedButton.getAttribute('aria-pressed') === 'true';
        }
    }

    function syncStyles() {
        const colors = getColors();

        const tree = getFileTree();
        for (const [hash, file] of files) {
            const link = tree?.querySelector(`a[href="#${hash}"]`);
            if (!link) continue;
            applyStyles(link.querySelector(SEL.legacyFileLabel) ?? link, file.collapsed, file.viewed, colors);
        }

        for (const [key, dir] of dirs) {
            const folder = findFolder(key);
            if (!folder) continue;
            const label = getFolderLabel(folder);
            if (!label) continue;

            // Trimmed first: the legacy tree's label text has trailing whitespace,
            // which would otherwise render as "folder /".
            const labelText = label.textContent.trim();
            if (!labelText.endsWith('/')) label.textContent = labelText + '/';

            const childFiles = dir.childHashes.map(h => files.get(h)).filter(Boolean);
            if (childFiles.length === 0) continue;

            const allCollapsed = childFiles.every(f => f.collapsed);
            const allViewed = childFiles.every(f => f.viewed);
            const isOpen = isFolderOpen(folder);

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
                const diffList = document.querySelector(SEL.diffList);
                const fileTree = getFileTree();
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
