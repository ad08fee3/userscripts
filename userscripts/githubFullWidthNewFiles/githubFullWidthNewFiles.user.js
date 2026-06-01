// ==UserScript==
// @name         githubFullWidthNewFiles
// @version      1.0
// @description  On PR/commit diffs, makes wholly-added or wholly-deleted files use the full portal width.
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubFullWidthNewFiles/githubFullWidthNewFiles.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubFullWidthNewFiles/githubFullWidthNewFiles.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STYLE_ID = 'gh-full-width-new-files';

    // Only act on pages that actually carry a diff: a PR's Files changed/changes
    // tab, or a single commit page.
    function isDiffPage() {
        const path = window.location.pathname;
        return /\/pull\/\d+\/(files|changes)/.test(path) || /\/commit\/[0-9a-f]+/.test(path);
    }

    // GitHub ships the diff metadata as a big JSON blob in the page. Each entry in
    // "diffSummaries" describes one file. Wholly-added files have
    // changeType === "ADDED" (no original side); wholly-deleted files have
    // changeType === "REMOVED" (no new side). We collect both sets of paths so we
    // know which diff tables to widen, and which side to collapse for each.
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

    // Each diff table is identified by aria-label="Diff for: <path>". Escape the
    // bits that would break a double-quoted CSS attribute selector (backslashes
    // and double quotes); real file paths basically never contain these, but it's
    // cheap insurance.
    function cssEscapeAttrValue(value) {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    // Build (or rebuild) a single <style> element that, for each one-sided file's
    // table, collapses the empty side's two columns to a sliver. With
    // table-layout: fixed, shrinking those <col>s lets the populated side expand
    // to fill the portal width. The four <col>s are, in order:
    //   1 = original line number, 2 = original content (left / base side),
    //   3 = new line number,      4 = new content      (right / head side).
    // ADDED files have no original side, so we squeeze cols 1+2. REMOVED files
    // have no new side, so we squeeze cols 3+4.
    function applyStyles({ added, removed }) {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            document.head.appendChild(style);
        }

        if (added.size === 0 && removed.size === 0) {
            style.textContent = '';
            return;
        }

        const rules = [];
        const collapse = (path, cols) => {
            const sel = `table[aria-label="Diff for: ${cssEscapeAttrValue(path)}"]`;
            for (const n of cols) {
                rules.push(`${sel} > colgroup > col:nth-child(${n}) { width: 1px !important; }`);
            }
        };
        for (const path of added) collapse(path, [1, 2]);
        for (const path of removed) collapse(path, [3, 4]);
        style.textContent = rules.join('\n');
    }

    function run() {
        if (!isDiffPage()) {
            // Clear any rules we left behind after navigating away from a diff.
            const style = document.getElementById(STYLE_ID);
            if (style) style.textContent = '';
            return;
        }
        applyStyles(getOneSidedPaths());
    }

    run();

    // The diff payload and tables can show up after the initial load (lazy
    // rendering, Turbo navigations), so re-run when the DOM changes. Our CSS is
    // keyed off aria-label, so it "just works" for tables that appear later; the
    // re-run is really about catching the JSON once it's present.
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
