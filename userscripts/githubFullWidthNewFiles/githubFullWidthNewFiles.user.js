// ==UserScript==
// @name         githubFullWidthNewFiles
// @version      1.1
// @description  On PR/commit/compare diffs (new React UI and classic UI), makes wholly-added or wholly-deleted files use the full portal width.
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubFullWidthNewFiles/githubFullWidthNewFiles.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubFullWidthNewFiles/githubFullWidthNewFiles.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // We mark each wholly one-sided diff table with this attribute (value
    // "added" or "removed"), then a single static stylesheet does the widening.
    // Both diff UIs share the attribute; the stylesheet's selectors are scoped so
    // each rule family only bites the UI it was written for (see ensureStyle).
    const STYLE_ID = 'gh-full-width-new-files';
    const TAG = 'data-gh-fw-onesided';

    // Only act on pages that actually carry a diff: a PR's Files changed/changes
    // tab, a single commit page, or a branch/ref compare page (.../compare/...).
    function isDiffPage() {
        const path = window.location.pathname;
        return /\/pull\/\d+\/(files|changes)/.test(path) ||
            /\/commit\/[0-9a-f]+/.test(path) ||
            /\/compare\//.test(path);
    }

    // GitHub ships the diff metadata as a big JSON blob in the page. Each entry in
    // "diffSummaries" describes one file. Wholly-added files have
    // changeType === "ADDED" (no original side); wholly-deleted files have
    // changeType === "REMOVED" (no new side). We collect both sets of paths so the
    // tagger knows which tables to widen, and which side to collapse for each.
    // This is the only source that works for collapsed/large diffs whose rows
    // haven't rendered yet, so it's preferred over scraping cells.
    function getOneSidedPaths() {
        const added = new Set();
        const removed = new Set();

        // Preferred path: parse the embedded JSON data islands properly.
        for (const script of document.querySelectorAll('script[type="application/json"]')) {
            let data;
            try {
                data = JSON.parse(script.textContent);
            } catch (e) {
                continue;
            }
            collectFromJson(data, added, removed);
        }

        // Fallback: if the structure ever moves and the JSON walk finds nothing,
        // scrape the raw markup for the same changeType/path pairing. The lazy
        // match stops at the first "path" after a "changeType", which keeps us
        // inside the same object.
        if (added.size === 0 && removed.size === 0) {
            const html = document.documentElement.outerHTML;
            const re = /"changeType":\s*"(ADDED|REMOVED)"[\s\S]*?"path":\s*"([^"]+)"/g;
            let match;
            while ((match = re.exec(html)) !== null) {
                (match[1] === 'ADDED' ? added : removed).add(match[2]);
            }
        }

        return { added, removed };
    }

    // Recursively walk a parsed JSON value looking for "diffSummaries" arrays and
    // bucket each one-sided file's path by changeType. We don't assume where in
    // the payload diffSummaries lives, so we just search the whole tree.
    function collectFromJson(value, added, removed) {
        if (Array.isArray(value)) {
            for (const item of value) {
                collectFromJson(item, added, removed);
            }
            return;
        }
        if (value && typeof value === 'object') {
            if (Array.isArray(value.diffSummaries)) {
                for (const summary of value.diffSummaries) {
                    if (!summary || !summary.path) continue;
                    if (summary.changeType === 'ADDED') {
                        added.add(summary.path);
                    } else if (summary.changeType === 'REMOVED') {
                        removed.add(summary.path);
                    }
                }
            }
            for (const key of Object.keys(value)) {
                collectFromJson(value[key], added, removed);
            }
        }
    }

    // Inject the single stylesheet once. It carries two rule families, one per
    // diff UI, distinguished entirely by selector so they never collide:
    //
    //   New React UI: the table has a 4-col <colgroup> with table-layout: fixed,
    //   so shrinking the empty side's two <col>s lets the populated side expand
    //   to fill the portal. Cols are 1 = original line number, 2 = original
    //   content (left/base), 3 = new line number, 4 = new content (right/head).
    //   ADDED files have no original side (squeeze 1+2); REMOVED files have no new
    //   side (squeeze 3+4). Classic tables have no <colgroup>, so these never hit
    //   them.
    //
    //   Classic / legacy UI (commit, compare, Enterprise): <table
    //   class="...file-diff-split"> with table-layout: fixed and no <colgroup>, so
    //   hiding the empty cells alone frees no space. We flip the table to
    //   table-layout: auto, hide the empty side's cells, and give the populated
    //   content column width: 100% to absorb the slack. Scoping to .file-diff-split
    //   keeps the table-layout flip off the React tables. We hide the empty CELLS
    //   (not whole nth-child columns) so hunk-expander rows are untouched; the
    //   header <th> row is the table's first row, so tr:first-child > th never
    //   matches a code/expander row.
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            // React colgroup squeeze.
            `table[${TAG}="added"] > colgroup > col:nth-child(1),`,
            `table[${TAG}="added"] > colgroup > col:nth-child(2) { width: 1px !important; }`,
            `table[${TAG}="removed"] > colgroup > col:nth-child(3),`,
            `table[${TAG}="removed"] > colgroup > col:nth-child(4) { width: 1px !important; }`,
            // Classic cell-hide.
            `table[${TAG}].file-diff-split { table-layout: auto !important; }`,
            `table[${TAG}].file-diff-split td.blob-num-empty,`,
            `table[${TAG}].file-diff-split td.blob-code-empty { display: none !important; }`,
            `table[${TAG}="added"].file-diff-split tr:first-child > th:nth-child(1),`,
            `table[${TAG}="added"].file-diff-split tr:first-child > th:nth-child(2) { display: none !important; }`,
            `table[${TAG}="removed"].file-diff-split tr:first-child > th:nth-child(3),`,
            `table[${TAG}="removed"].file-diff-split tr:first-child > th:nth-child(4) { display: none !important; }`,
            `table[${TAG}="added"].file-diff-split td.blob-code-addition { width: 100% !important; }`,
            `table[${TAG}="removed"].file-diff-split td.blob-code-deletion { width: 100% !important; }`,
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    // Mark each one-sided diff table with the TAG attribute. Idempotent: re-tagging
    // an already-correct table is a no-op, and a table that gains context lines
    // later (lazy "expand" clicks) gets untagged.
    function tagTables({ added, removed }) {
        // New React tables (colgroup-based). Prefer the JSON-derived side, which
        // works even before rows render; fall back to scraping the rendered cells
        // for surfaces (e.g. the commit page) whose metadata ships as
        // "diffEntryData" rather than "diffSummaries", so the JSON walk found
        // nothing. Each text cell is tagged left-side-diff-cell or
        // right-side-diff-cell, and the blank side's cells carry empty-diff-line.
        for (const table of document.querySelectorAll('table[aria-label^="Diff for: "]')) {
            const path = table.getAttribute('aria-label').replace(/^Diff for: /, '');
            let side = added.has(path) ? 'added' : removed.has(path) ? 'removed' : null;
            if (!side) {
                const hasLeft = !!table.querySelector('td.left-side-diff-cell:not(.empty-diff-line)');
                const hasRight = !!table.querySelector('td.right-side-diff-cell:not(.empty-diff-line)');
                if (hasRight && !hasLeft) side = 'added';
                else if (hasLeft && !hasRight) side = 'removed';
            }
            setTag(table, side);
        }

        // Classic split diff tables. No <colgroup> and no diffSummaries JSON, so
        // detect one-sidedness structurally: a wholly-added or wholly-deleted file
        // has NO context lines (nothing on the opposite side to show), so it's
        // one-sided iff it has additions xor deletions and no context.
        for (const table of document.querySelectorAll('table.js-diff-table.file-diff-split')) {
            const hasAddition = !!table.querySelector('.blob-code-addition');
            const hasDeletion = !!table.querySelector('.blob-code-deletion');
            const hasContext = !!table.querySelector('.blob-code-context');
            const oneSided = !hasContext && (hasAddition !== hasDeletion);
            setTag(table, oneSided ? (hasAddition ? 'added' : 'removed') : null);
        }
    }

    function setTag(table, side) {
        if (side) table.setAttribute(TAG, side);
        else table.removeAttribute(TAG);
    }

    function run() {
        // Off a diff page there's nothing to do: the stylesheet's rules are inert
        // without tagged tables, and tagged tables only exist on diff pages.
        if (!isDiffPage()) return;
        ensureStyle();
        tagTables(getOneSidedPaths());
    }

    run();

    // The diff payload and tables can show up after the initial load (lazy
    // rendering, Turbo navigations), so re-run when the DOM changes to catch the
    // JSON and tables once they're present.
    const observer = new MutationObserver(run);
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // GitHub is a Turbo single-page app, so URLs often change without a full
    // reload. Re-check on history changes and Turbo's own load event.
    let lastHref = window.location.href;
    function onUrlMaybeChanged() {
        if (window.location.href === lastHref) return;
        lastHref = window.location.href;
        run();
    }
    for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function () {
            const result = original.apply(this, arguments);
            onUrlMaybeChanged();
            return result;
        };
    }
    window.addEventListener('popstate', onUrlMaybeChanged);
    document.addEventListener('turbo:load', onUrlMaybeChanged);
})();
