// ==UserScript==
// @name         githubCollapseJunk
// @version      1.2
// @description  Auto-collapses low-value "junk" files (tests, lock files, binaries, generated code, etc) on GitHub PR diff pages, with a toggle button to show/hide them.
// @match        https://github.com/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubCollapseJunk/githubCollapseJunk.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubCollapseJunk/githubCollapseJunk.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Set to false in the console to silence per-file lifecycle logs.
let DEBUG_LOGGING_ENABLED = false;

if (!DEBUG_LOGGING_ENABLED) {
    console.log('[githubCollapseJunk] Debug logging disabled. To enable, run `DEBUG_LOGGING_ENABLED = true` in the console.');
}

(function () {
    'use strict';

    // GitHub-internal CSS-module class names and selectors. These are not a public
    // API and will change without warning, so keep them collected here as the
    // single place to update when the script breaks after a GitHub front-end change.
    const SEL = {
        diffHeader: '[class*="DiffFileHeader-module__diff-file-header__"]',
        diffBody: '.border.position-relative.rounded-bottom-2',
        collapseButtonChevron: 'button[aria-labelledby] svg.octicon-chevron-down, button[aria-labelledby] svg.octicon-chevron-right',
        toolbarSubmitButton: '.ReviewMenuButton-module__ReviewMenuButton__eXO8O',
        // Sidebar file tree (present on the PR files/changes page alongside the diff
        // list itself), used to auto-collapse folders whose files are all junk/viewed.
        fileTree: '#pr-file-tree',
        treeFileLink: 'a[href^="#diff-"]',
        // Deliberately matches folders in any open/closed state, not just
        // aria-expanded="true" - collapseJunkFolders must evaluate a folder
        // exactly once, the moment its files settle, regardless of whether the
        // folder happens to be open or closed at that instant. A closed-only
        // filter meant a folder collapsed by the user (or nested inside one)
        // was invisible to this query until reopened, at which point it looked
        // brand new and got immediately re-collapsed by our own script.
        treeFolder: 'li[role="treeitem"][aria-expanded]',
        treeFolderToggle: ':scope > div [class*="PRIVATE_TreeView-item-toggle"] svg',
        // The PR header's own +N/-N diffstat (e.g. "+859"/"-5", plus a
        // visually-hidden "Lines changed: 859 additions & 5 deletions" span
        // for screen readers) - rewritten to a junk-excluded total.
        prHeaderWrapper: '[class*="PullRequestHeader-module__rightContentWrapper__"]',
        prHeaderAdditions: '[class*="PullRequestHeader-module__rightContentWrapper__"] .fgColor-success',
        prHeaderDeletions: '[class*="PullRequestHeader-module__rightContentWrapper__"] .fgColor-danger',
        prHeaderSrOnly: '[class*="PullRequestHeader-module__rightContentWrapper__"] .sr-only',
    };
    const CLASS = {
        collapsed: 'DiffFileHeader-module__collapsed__',
    };
    const HANDLED_ATTR = 'data-collapse-junk-handled';
    const LINE_STATS_TOOLTIP_HANDLED_ATTR = 'data-collapse-junk-tooltip-handled';
    const CLASSIFICATION_LABEL_CLASS = 'gh-collapse-junk-classification-label';
    const LOG_PREFIX = '[githubCollapseJunk]';


    // Phase-tagged, per-file lifecycle logging. Every line carries the file path
    // and phase, so a single file's journey can be followed by grepping its path
    // in the console. `level` is a console method name ('log' | 'warn').
    function emitPhase(level, path, phase, detail) {
        if (!DEBUG_LOGGING_ENABLED) return;
        const suffix = detail ? ` (${detail})` : '';
        console[level](`${LOG_PREFIX} [${phase}] ${path}${suffix}`);
    }

    function logPhase(path, phase, detail = '') {
        emitPhase('log', path, phase, detail);
    }

    function warnPhase(path, phase, detail = '') {
        emitPhase('warn', path, phase, detail);
    }

    // Writes textContent only when it would actually change. Every textContent
    // write is itself a childList mutation, and reconcileObserver invokes
    // reconcile() (which drives all our own writes) on every childList mutation -
    // an unconditional write would re-trigger that observer forever. No-ops on a
    // null element so callers can pass an unresolved querySelector result.
    function setTextIfChanged(el, text) {
        if (el && el.textContent !== text) el.textContent = text;
    }

    // Tier 1: filename/path + embedded-metadata, no DOM. Tier 2: rendered
    // diff-body text, a fallback for files diffContents doesn't cover (GitHub
    // doesn't always embed full metadata at initial load, even for a fully
    // rendered file). Tier 3: gated full-file fetch - "shouldFetch" filters
    // which files fetch at all; every qualifying classifier then runs against
    // the one fetched body, in declared order, first match wins.
    const classifiers = [
        { tier: 1, name: 'Deleted file', displayName: 'Deleted', classify: (fileMeta) => fileMeta.status === 'REMOVED' },
        { tier: 1, name: 'Generated file', displayName: 'Auto-generated', classify: (fileMeta) => {
            return fileMeta.newTreeEntry?.isGenerated === true || /oas_.*_gen\.go$/.test(fileMeta.path);
        }},
        { tier: 1, name: 'Binary', displayName: 'Binary file', classify: (fileMeta) => fileMeta.isBinary === true },
        { tier: 1, name: 'Tests', displayName: 'Test', classify: (fileMeta) => /_test\.go$/.test(fileMeta.path) },
        { tier: 1, name: 'Mocks', displayName: 'Mock', classify: (fileMeta) => /_mock\.go$/.test(fileMeta.path) },
        { tier: 1, name: 'package-lock.json', displayName: 'Dependency management', classify: (fileMeta) => /(^|\/)package-lock\.json$/.test(fileMeta.path) },
        { tier: 1, name: 'go.mod/go.sum', displayName: 'Dependency management', classify: (fileMeta) => /(^|\/)go\.(mod|sum)$/.test(fileMeta.path) },
        { tier: 1, name: 'SVG', displayName: 'Image', classify: (fileMeta) => /\.svg$/.test(fileMeta.path) },
        // Tier 2: rendered diff-body text, reached only when Tier 1 found no
        // match. Covers files diffContents is silent about, like a generated
        // file GitHub renders a "not rendered by default" placeholder for.
        { tier: 2, name: 'Deleted file', displayName: 'Deleted', classify: (fileMeta, bodyText) => bodyText.includes('This file was deleted.') },
        { tier: 2, name: 'Renamed, no changes', displayName: 'Renamed', classify: (fileMeta, bodyText) => bodyText.includes('File renamed without changes.') },
        { tier: 2, name: 'Generated file', displayName: 'Auto-generated', classify: (fileMeta, bodyText) => bodyText.includes('Some generated files are not rendered by default.') },
        { tier: 2, name: 'Binary', displayName: 'Binary file', classify: (fileMeta, bodyText) => bodyText.includes('Binary file not shown.') },
        // Tier 3: full file fetch. fileContent is always the new (post-diff)
        // version - fetchFileContent resolves fileMeta.newCommitOid, never the
        // old blob - so this only fires when the tygo header is present in the
        // file as it stands after the PR.
        {
            tier: 3,
            name: 'tygo generated',
            displayName: 'Auto-generated',
            shouldFetch: (fileMeta) => /\.ts$/.test(fileMeta.path),
            classify: (fileMeta, fileContent) => fileContent.startsWith('// Code generated by tygo. DO NOT EDIT.'),
        },
        {
            tier: 3,
            name: 'OpenAPI generated',
            displayName: 'Auto-generated',
            shouldFetch: (fileMeta) => /openapi/.test(fileMeta.path) && /\.yaml$/.test(fileMeta.path),
            classify: (fileMeta, fileContent) => fileContent.includes('AUTO-GENERATED - DO NOT EDIT'),
        },
        // A "too large to render" file isn't necessarily junk on its own -
        // it's promoted to a Tier 3 fetch so we can look past the placeholder
        // at the real content before deciding whether it's junk.
        {
            tier: 3,
            name: 'Large - Generated',
            displayName: 'Auto-generated',
            shouldFetch: (fileMeta, bodyText) => fileMeta.isTooBig === true || bodyText.includes('Large diffs are not rendered by default.'),
            classify: (fileMeta, fileContent) => fileContent.split('\n', 1)[0].includes('AUTO-GENERATED - DO NOT EDIT'),
        },
    ];
    const tier1Classifiers = classifiers.filter(c => c.tier === 1);
    const tier2Classifiers = classifiers.filter(c => c.tier === 2);
    const tier3Classifiers = classifiers.filter(c => c.tier === 3);

    // classification is keyed by a classifier's `name` (logs, run summary,
    // junk-detection). displayName is a separate, required label for the
    // on-page header badge - callers must not fall back to `name`, since the
    // two are allowed to diverge (e.g. plural vs singular).
    const displayNameByName = new Map(classifiers.map(c => [c.name, c.displayName]));

    // files: pathDigest -> { path, classification, meta, viewed, tier2Deferred,
    //   isCollapsed, shouldBeCollapsed, tier3Kicked }
    // classification: 'UNCLASSIFIED' (pending) | 'normal' | a classifier's name.
    // viewed: true when GitHub loads the file pre-collapsed (markedAsViewed).
    // tier2Deferred: true for a viewed file whose tier-2/3 pass is postponed
    //   until the user opens it (no point classifying by DOM text while hidden).
    // isCollapsed: last-observed DOM state, written only by reconcile()'s own read.
    // shouldBeCollapsed: desired state - the only field classification, the global
    //   toggle, and manual user clicks are allowed to write. reconcile() is the only
    //   code that ever compares isCollapsed to shouldBeCollapsed and clicks to
    //   correct a disagreement - see "reconcile" below for the full contract.
    // tier3Kicked: guards against kicking off a duplicate tier-3 fetch when
    //   reconcile() re-fires before an in-flight fetch resolves.
    const files = new Map();
    let registryPath = '';

    // Pathname onPageReady saw on its previous call, updated unconditionally at
    // the top of every call. Distinct from registryPath (which only changes on a
    // full rebuild). Used solely to decide whether folderCollapseState needs
    // clearing: same-page anchor navigation (e.g. GitHub's router updating the URL
    // hash when a sidebar file is clicked) fires pushState/replaceState/popstate
    // without changing the pathname and must NOT clear it, whereas a round trip
    // through a non-diff page (e.g. Overview) and back must. Tracking this only in
    // run()/wipeStateForNewPr would miss the round-trip, since the non-diff page
    // returns early from onPageReady before reaching either.
    let lastSeenPath = '';

    // The PR header's own additions/deletions count, read once off the DOM the
    // first time updateHeaderLineStats() runs after a registry build, then used
    // as the fixed starting point junk-file lines get subtracted from. null means
    // "not read yet"; reset alongside the registry (buildRegistry,
    // wipeStateForNewPr) since a new PR starts from its own baseline.
    let headerLineStatsBaseline = null;

    // The "Hide junk"/"Show junk" toggle's current intent. Read whenever a file's
    // shouldBeCollapsed needs computing. Not persisted across a hard reload, but
    // intentionally NOT reset on Turbo navigation to a different PR/tab, so an
    // in-session toggle choice carries over until the page is hard-reloaded.
    let globalHideJunk = true;

    // Which sidebar file-tree folders have made their one-time collapse decision,
    // keyed by the folder's own DOM id (derived from its path, so stable across
    // the sidebar's virtualized mount/unmount - unlike a hash of currently-
    // rendered children, which differs when a folder remounts with an incomplete
    // child list). 'analyzed' = collapseJunkFolders decided this folder stays open
    // (or it's a descendant of a collapsed ancestor) and won't reconsider it.
    // 'collapsed' = this folder itself was clicked shut - kept distinct from
    // 'analyzed' so isDescendantOfCollapsed can tell "this folder is done" apart
    // from "this folder is why its children are done". Absence = still pending (a
    // contained file was UNCLASSIFIED and not viewed last check). Reset in buildRegistry.
    const folderCollapseState = new Map();

    function isJunk(file) {
        return file.classification !== 'normal' && file.classification !== 'UNCLASSIFIED';
    }

    function needsRebuild() {
        return window.location.pathname !== registryPath;
    }

    // GitHub embeds the PR's file list as JSON data islands, split across two
    // arrays. diffSummaries has every file (path, pathDigest, changeType) but no
    // isBinary/isTooBig/isGenerated. diffContents has that richer metadata but
    // only covers a subset - GitHub fetches the rest lazily via a background API
    // call that never lands in another script tag, so a file missing here at
    // registry-build time stays missing for the life of the page. So diffSummaries
    // is the source of the file list, enriched with diffContents wherever a
    // pathDigest matches. comparison.fullDiff.headOid is the PR's head commit,
    // identical to every diffContents entry's newCommitOid, so it doubles as the
    // blob ref for files diffContents doesn't cover.
    function getEmbeddedRouteArrays(root = document) {
        const summaries = [];
        const contentsByDigest = new Map();
        let headOid;
        const scripts = root.querySelectorAll('script[type="application/json"]');
        let routesFound = 0;
        for (const script of scripts) {
            let data;
            try {
                data = JSON.parse(script.textContent);
            } catch {
                continue;
            }
            const route = data?.payload?.pullRequestsChangesRoute;
            if (!route) continue;
            routesFound++;
            if (Array.isArray(route.diffSummaries)) {
                summaries.push(...route.diffSummaries);
            }
            if (Array.isArray(route.diffContents)) {
                for (const content of route.diffContents) {
                    if (content.pathDigest) contentsByDigest.set(content.pathDigest, content);
                }
            }
            if (route.comparison?.fullDiff?.headOid) {
                headOid = route.comparison.fullDiff.headOid;
            }
        }
        logPhase('(page)', 'route-scan', `${scripts.length} json script(s), ${routesFound} route(s), ${summaries.length} summar(y/ies)`);
        return { summaries, contentsByDigest, headOid };
    }

    // Fallback for when Turbo's tab-switch (main PR page -> "Files changed") never
    // re-embeds the pullRequestsChangesRoute JSON into the live document (see the
    // call site in run()). GitHub still server-renders that JSON for any direct
    // request to the diff URL, so fetching it and parsing into a detached document
    // gets the same data a full reload would, without the visible reload.
    async function fetchEmbeddedRouteArrays() {
        const response = await fetch(window.location.href, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return getEmbeddedRouteArrays(doc);
    }

    function buildRegistry(routeArrays = getEmbeddedRouteArrays()) {
        files.clear();
        const { summaries, contentsByDigest, headOid } = routeArrays;
        for (const summary of summaries) {
            if (!summary.pathDigest) continue;
            const content = contentsByDigest.get(summary.pathDigest);
            // status and changeType are the same enum, so a file missing from
            // diffContents still gets a usable status.
            const meta = {
                path: summary.path,
                status: summary.changeType,
                isBinary: content?.isBinary ?? false,
                isTooBig: content?.isTooBig ?? false,
                newTreeEntry: content?.newTreeEntry,
                newCommitOid: content?.newCommitOid ?? headOid,
                // Left undefined (not defaulted to 0) when GitHub's JSON has no
                // number for this file - updateHeaderLineStats must tell "changed
                // 0 lines" apart from "we don't know", since only the former is
                // safe to subtract from the header's baseline total.
                linesAdded: summary.linesAdded,
                linesChanged: summary.linesChanged,
                linesDeleted: summary.linesDeleted,
            };
            const viewed = summary.markedAsViewed === true;
            files.set(summary.pathDigest, {
                path: summary.path,
                classification: 'UNCLASSIFIED',
                meta,
                viewed,
                tier2Deferred: false,
                isCollapsed: undefined,
                shouldBeCollapsed: viewed,
                tier3Kicked: false,
            });
            logPhase(summary.path, 'registry', viewed ? 'viewed' : 'not viewed');
        }
        folderCollapseState.clear();
        headerLineStatsBaseline = null;
        logLineStatTotals();
    }

    // Diagnostic: sums linesAdded/linesChanged/linesDeleted across the registry
    // and logs the totals, to compare by eye against the PR header's "+N/-N"
    // diffstat as a sanity check before trusting this data.
    function logLineStatTotals() {
        let linesAdded = 0, linesChanged = 0, linesDeleted = 0;
        for (const file of files.values()) {
            linesAdded += file.meta.linesAdded ?? 0;
            linesChanged += file.meta.linesChanged ?? 0;
            linesDeleted += file.meta.linesDeleted ?? 0;
        }
        logPhase('(page)', 'line-stat-totals', `added=${linesAdded} changed=${linesChanged} deleted=${linesDeleted}`);
    }

    // Reads the header's "+N"/"-N" text and parses out the raw counts for
    // updateHeaderLineStats()'s starting point, before this script touches those
    // elements. Returns null if the header isn't mounted yet - callers must treat
    // null as "retry next reconcile() pass", not as a baseline of zero. Either
    // the additions or deletions element may be missing (GitHub doesn't render
    // them when the count is 0), in which case that count is treated as 0.
    function readHeaderLineStatsBaseline() {
        const additionsEl = document.querySelector(SEL.prHeaderAdditions);
        const deletionsEl = document.querySelector(SEL.prHeaderDeletions);
        if (!additionsEl && !deletionsEl) return null;
        const linesAdded = additionsEl ? parseInt(additionsEl.textContent.replace(/[^\d]/g, ''), 10) : 0;
        const linesDeleted = deletionsEl ? parseInt(deletionsEl.textContent.replace(/[^\d]/g, ''), 10) : 0;
        if ((additionsEl && Number.isNaN(linesAdded)) || (deletionsEl && Number.isNaN(linesDeleted))) return null;
        logPhase('(page)', 'header-line-stats-baseline', `added=${linesAdded} deleted=${linesDeleted}`);
        return { linesAdded, linesDeleted };
    }

    // Rewrites the PR header's "+N/-N" diffstat (both the visible colored spans
    // and the visually-hidden screen-reader summary) to a junk-excluded total.
    // Starts from the header's own baseline and subtracts each junk file's
    // linesAdded/linesDeleted - rather than summing non-junk files directly - so
    // a file GitHub gave us no number for (undefined) just isn't subtracted,
    // instead of being treated as a 0-line change and corrupting the total. Runs
    // on every reconcile() pass, since files keep resolving out of UNCLASSIFIED
    // asynchronously (tier-2/3) and each new classification changes which files
    // are excluded.
    function updateHeaderLineStats() {
        if (headerLineStatsBaseline === null) {
            headerLineStatsBaseline = readHeaderLineStatsBaseline();
            if (headerLineStatsBaseline === null) return;
        }

        let linesAdded = headerLineStatsBaseline.linesAdded;
        let linesDeleted = headerLineStatsBaseline.linesDeleted;
        for (const file of files.values()) {
            if (!isJunk(file)) continue;
            if (file.meta.linesAdded !== undefined) linesAdded -= file.meta.linesAdded;
            if (file.meta.linesDeleted !== undefined) linesDeleted -= file.meta.linesDeleted;
        }

        const additionsEl = document.querySelector(SEL.prHeaderAdditions);
        const deletionsEl = document.querySelector(SEL.prHeaderDeletions);
        const srOnlyEl = document.querySelector(SEL.prHeaderSrOnly);
        setTextIfChanged(additionsEl, `+${linesAdded}`);
        setTextIfChanged(deletionsEl, `-${linesDeleted}`);
        setTextIfChanged(srOnlyEl, `Lines changed: ${linesAdded} additions & ${linesDeleted} deletions`);

        insertLineStatsTooltipListener();
    }

    let lineStatsTooltipEl = null;

    // Shows the pre-junk-exclusion totals on hover/focus, since
    // updateHeaderLineStats() overwrites the header's numbers in place and the
    // originals aren't visible anywhere else. Reuses GitHub's own Primer tooltip
    // class/attributes (rather than hand-rolled styles) to inherit already-loaded
    // CSS - same hardcoded-class-name risk this file accepts elsewhere (e.g.
    // SEL.toolbarSubmitButton), and the same "unstyled until updated" failure mode
    // if GitHub reships the class under a new hash.
    function showLineStatsTooltip(wrapper) {
        if (headerLineStatsBaseline === null || lineStatsTooltipEl) return;
        const tooltip = document.createElement('span');
        tooltip.className = 'prc-TooltipV2-Tooltip-tLeuB';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.setAttribute('popover', 'auto');
        tooltip.setAttribute('data-direction', 's');
        tooltip.textContent = `Original: +${headerLineStatsBaseline.linesAdded} -${headerLineStatsBaseline.linesDeleted}`;
        document.body.appendChild(tooltip);
        // popover="auto" elements are hidden (display: none) by the UA stylesheet
        // until explicitly shown - just appending to the DOM isn't enough.
        tooltip.showPopover();

        const wrapperRect = wrapper.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        tooltip.style.position = 'fixed';
        tooltip.style.top = `${wrapperRect.bottom + 6}px`;
        tooltip.style.left = `${wrapperRect.left + wrapperRect.width / 2 - tooltipRect.width / 2}px`;

        lineStatsTooltipEl = tooltip;
    }

    function hideLineStatsTooltip() {
        lineStatsTooltipEl?.remove();
        lineStatsTooltipEl = null;
    }

    // Attaches the hover/focus listeners to the diffstat wrapper exactly once -
    // guarded like insertToggleButton() guards its container, since React replaces
    // this wrapper on Turbo navigation to a new PR and a guard keyed to the old
    // element would silently stop firing.
    function insertLineStatsTooltipListener() {
        const wrapper = document.querySelector(SEL.prHeaderWrapper);
        if (!wrapper || wrapper.hasAttribute(LINE_STATS_TOOLTIP_HANDLED_ATTR)) return;
        wrapper.setAttribute(LINE_STATS_TOOLTIP_HANDLED_ATTR, '1');
        wrapper.addEventListener('mouseenter', () => showLineStatsTooltip(wrapper));
        wrapper.addEventListener('mouseleave', hideLineStatsTooltip);
        wrapper.addEventListener('focusin', () => showLineStatsTooltip(wrapper));
        wrapper.addEventListener('focusout', hideLineStatsTooltip);
    }

    function getDiffEntry(pathDigest) {
        return document.getElementById(`diff-${pathDigest}`);
    }

    function getHeader(diffEntry) {
        return diffEntry?.querySelector(SEL.diffHeader) ?? null;
    }

    function getCollapseButton(header) {
        const chevron = header?.querySelector(SEL.collapseButtonChevron);
        return chevron ? chevron.closest('button') : null;
    }

    function isCollapsed(header) {
        return header.className.split(' ').some(c => c.includes(CLASS.collapsed));
    }

    // Renders the classifier's displayName (falling back to its name) as an
    // italicized "(Name)" label just before the header's diffstat, so a
    // collapsed file's junk category is visible without expanding it. Finds the
    // diffstat wrapper via its hide-on-mobile module class (scoped to `div` - the
    // copy button carries the same class on a `button`) and inserts the label as
    // its preceding sibling, right-justified alongside the stats in their shared
    // flex-justify-end container. A 'normal', 'UNCLASSIFIED', or falsy
    // classification clears any existing label instead of showing one - a
    // still-unclassified file (e.g. a deferred viewed file) must never render a
    // raw "(UNCLASSIFIED)" label.
    function applyClassificationLabel(header, classification) {
        if (!header) return;
        const statsWrapper = header.querySelector('div[class*="DiffFileHeader-module__hide-on-mobile__"]');
        const parent = statsWrapper?.parentElement;
        if (!parent) return;

        let label = parent.querySelector(`.${CLASSIFICATION_LABEL_CLASS}`);
        if (!classification || classification === 'normal' || classification === 'UNCLASSIFIED') {
            label?.remove();
            return;
        }

        const text = `(${displayNameByName.get(classification) ?? classification})`;
        if (label && label.textContent === text) return;

        if (!label) {
            label = document.createElement('span');
            label.className = CLASSIFICATION_LABEL_CLASS;
            label.style.fontStyle = 'italic';
            label.style.opacity = '0.7';
            label.style.marginRight = '8px';
            parent.insertBefore(label, statsWrapper);
        }
        label.textContent = text;
    }

    // Writes a file's classification and, per stuck-state invariant, keeps
    // shouldBeCollapsed in sync: a file that just became junk adopts the current
    // global toggle intent; a file that resolved to 'normal' is left alone (keeps
    // its existing shouldBeCollapsed - false, unless viewed). reconcile() acts on
    // the change; see its comment for why async callers (tier-3 fetch,
    // classifyDeferredOnOpen) must call reconcile() afterward while synchronous
    // tier-1/tier-2 callers don't (reconcile() re-checks this file later in the
    // same pass).
    function applyClassification(file, classification) {
        logPhase(file.path, 'classified', `${file.classification} -> ${classification}`);
        file.classification = classification;
        if (isJunk(file)) {
            file.shouldBeCollapsed = globalHideJunk;
        }
    }

    // Tier 1: filename + embedded-metadata classifiers, sync, need no DOM. Runs
    // against every file immediately once the registry is seeded, viewed or not -
    // no mount sweep needed, since reconcile() picks up remaining files lazily as
    // their headers mount.
    //
    // Viewed files load pre-collapsed, so they never need an explicit collapse: a
    // tier-1 junk match just records the classification, and a viewed file with no
    // tier-1 match is marked deferred (its tier-2/3 pass waits until the user
    // opens it - no point reading DOM text from a hidden body).
    function runTier1() {
        for (const file of files.values()) {
            const match = tier1Classifiers.find(c => c.classify(file.meta));
            if (match) {
                applyClassification(file, match.name);
                logPhase(file.path, 'tier1', match.name);
            } else if (file.viewed) {
                file.tier2Deferred = true;
                logPhase(file.path, 'deferred', 'viewed, awaiting open');
            }
        }
    }

    function getBodyText(pathDigest) {
        const body = getDiffEntry(pathDigest)?.querySelector(SEL.diffBody);
        return body ? body.textContent : '';
    }

    // Tier 2: rendered diff-body text, run only for files Tier 1 didn't match.
    // Returns a classifier name on match, or null.
    function classifyTier2(file, pathDigest) {
        const bodyText = getBodyText(pathDigest);
        const match = tier2Classifiers.find(c => c.classify(file.meta, bodyText));
        return match ? match.name : null;
    }

    // Diagnostic only: logs whether diffContents metadata for this file has
    // shown up by the time we're about to fall back to Tier 2/3, to check
    // whether GitHub ever lazily delivers it (which would let us drop the
    // Tier 2 DOM-text fallback entirely in favor of re-reading embedded JSON).
    function logDiffContentsAvailability(file) {
        if (!DEBUG_LOGGING_ENABLED) return;
        const { contentsByDigest } = getEmbeddedRouteArrays();
        const nowAvailable = [...contentsByDigest.values()].some(c => c.path === file.path);
        console.log(`${LOG_PREFIX} diffContents for ${file.path} available at Tier 2 time: ${nowAvailable} (was ${!!file.meta.newCommitOid} at registry build time)`);
    }

    // Every current Tier 3 classifier only inspects the start of the file (a
    // leading comment or first line), so we request just the first slice of bytes
    // via a Range header - this is what saves downloading a multi-MB "too large"
    // file in full just to check its header. GitHub's raw host honors Range and
    // answers 206; a 200 means it ignored the header (or the file is smaller than
    // the range) and sent the whole thing, still correct to read from, just no
    // bandwidth savings.
    const TIER3_FETCH_RANGE_BYTES = 2000;

    async function fetchFileContent(fileMeta) {
        const repo = window.location.pathname.match(/^\/[^/]+\/[^/]+/)?.[0];
        // newCommitOid is the exact blob for this file's new version in the diff
        // (embedded in the same JSON as the rest of fileMeta), so we fetch that
        // specific commit's blob rather than an ambiguous branch ref.
        const url = `${window.location.origin}${repo}/raw/${fileMeta.newCommitOid}/${fileMeta.path}`;
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: { Range: `bytes=0-${TIER3_FETCH_RANGE_BYTES - 1}` },
        });
        logPhase(fileMeta.path, 'tier3-fetch', `${url} -> ${response.status}`);
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
        return response.text();
    }

    // Tier 3: for a file with no Tier 1 match, fetches its content once (only if
    // at least one Tier 3 classifier's shouldFetch passes) and runs every
    // qualifying classifier against that single body. Resolves to the file's final
    // classification: a classifier name, or 'normal'. bodyText is the Tier 2
    // rendered diff-body text (may be empty, e.g. a viewed file never expanded) -
    // shouldFetch needs it too, since a "too large" file's signal can be a Tier 3
    // shouldFetch check rather than a standalone match.
    async function classifyTier3(file, bodyText = '') {
        // newCommitOid falls back to the PR's head commit in buildRegistry, so
        // this is only null when neither diffContents nor headOid was found at
        // all (e.g. embedded JSON missing entirely) - no blob to fetch.
        if (!file.meta.newCommitOid) return 'normal';

        const qualifying = tier3Classifiers.filter(c => c.shouldFetch(file.meta, bodyText));
        if (qualifying.length === 0) return 'normal';

        try {
            const content = await fetchFileContent(file.meta);
            logPhase(file.path, 'tier3-content', JSON.stringify(content.slice(0, 80)));
            const match = qualifying.find(c => c.classify(file.meta, content));
            return match ? match.name : 'normal';
        } catch (err) {
            // A failed fetch shouldn't block classification - treat as normal.
            warnPhase(file.path, 'tier3-error', err.message);
            return 'normal';
        }
    }

    // How long a programmatic click's guard stays up before reconcile() may treat
    // that file as "settled" again. Must outlive the whole click -> React
    // re-render -> collapsed-class-mutation cycle, not just a microtask - clearing
    // too early would let reconcile() see the mutation our own click produced and
    // misread it as still disagreeing.
    const SELF_CLICK_GUARD_MS = 150;
    const selfClicking = new Map(); // pathDigest -> timeout id

    // Suppresses reconcile() while another extension runs a global collapse-all /
    // expand-all gesture (bound to alt-click on a diff header - it toggles every
    // file to one uniform state). We don't own that gesture, so reconcile() must
    // stay hands-off for its whole mutation burst: otherwise it would either undo
    // the sweep (springing every non-matching file back) or double-toggle a file
    // the other extension hasn't reached yet. Set true the moment we see the
    // alt-click; cleared a short quiet period after the last sweep mutation lands,
    // at which point one reconcile() confirms the DOM already matches our updated
    // shouldBeCollapsed. Re-armed on every mutation seen mid-sweep (via
    // reconcileObserver) so a long, many-file sweep never releases early - the
    // window tracks "quiet since the last mutation", not a fixed duration.
    let altSweepActive = false;
    let altSweepQuietTimer = null;
    const ALT_SWEEP_QUIET_MS = 300;

    function extendAltSweep() {
        altSweepActive = true;
        clearTimeout(altSweepQuietTimer);
        altSweepQuietTimer = setTimeout(() => {
            altSweepActive = false;
            reconcile();
        }, ALT_SWEEP_QUIET_MS);
    }

    // The only place that ever clicks a collapse button programmatically. Returns
    // false (caller should retry on the next reconcile pass) if the header is
    // mounted but its chevron/button isn't found yet - GitHub renders the header
    // before wiring the click handler, so an early click can silently no-op even
    // once the button element exists in some intermediate render.
    function clickCollapseButton(pathDigest, header) {
        const btn = getCollapseButton(header);
        if (!btn) return false;
        clearTimeout(selfClicking.get(pathDigest));
        selfClicking.set(pathDigest, setTimeout(() => selfClicking.delete(pathDigest), SELF_CLICK_GUARD_MS));
        btn.click();
        return true;
    }

    // Walks up from a header to its diff entry and recovers the pathDigest from
    // the entry's id, mirroring getDiffEntry's `diff-${pathDigest}` scheme in
    // reverse. Used by the manual-click listener to know which file a click on
    // the page actually belongs to.
    function pathDigestFromHeader(header) {
        const id = header.closest('[id^="diff-"]')?.id;
        return id ? id.slice('diff-'.length) : null;
    }

    // The single reconciler: for every file with a mounted header, drives DOM
    // state toward shouldBeCollapsed, and lazily classifies whatever is still
    // UNCLASSIFIED once its body text is available. The only code that clicks a
    // collapse button on our behalf (via clickCollapseButton) or reads isCollapsed
    // as ground truth - every other concern (classification, the global toggle,
    // user clicks) only writes shouldBeCollapsed/classification and leaves DOM
    // reconciliation to this loop.
    //
    // Stuck-state invariants this function upholds: (1) a file mid-click (tracked
    // in selfClicking) is skipped entirely, so an in-flight programmatic click is
    // never re-clicked or misread as a fresh disagreement while React catches up;
    // (2) every other caller that changes shouldBeCollapsed/classification
    // asynchronously (the tier-3 fetch below, classifyDeferredOnOpen, toggleJunk)
    // must call reconcile() again once done - relying on a future incidental
    // mutation to notice is exactly how a file gets stuck. A synchronous caller
    // (tier-1, tier-2 below) doesn't need to: the collapse check for that file
    // runs later in this same loop iteration.
    function reconcile() {
        // A global collapse-all/expand-all gesture from another extension is in
        // flight; leave every file alone until it goes quiet (see altSweepActive).
        // Covers direct callers too (tier-3 .then, classifyDeferredOnOpen), not
        // just the observer path, so nothing corrects a file mid-sweep.
        if (altSweepActive) return;
        for (const [pathDigest, file] of files) {
            if (selfClicking.has(pathDigest)) continue;
            const header = getHeader(getDiffEntry(pathDigest));
            if (!header) continue;

            if (file.classification === 'UNCLASSIFIED' && !file.viewed) {
                const bodyText = getBodyText(pathDigest);
                if (bodyText.trim().length > 0) {
                    const tier2Match = classifyTier2(file, pathDigest);
                    if (tier2Match) {
                        if (!file.meta.newCommitOid) logDiffContentsAvailability(file);
                        applyClassification(file, tier2Match);
                        logPhase(file.path, 'tier2', tier2Match);
                    } else if (!file.tier3Kicked) {
                        file.tier3Kicked = true;
                        classifyTier3(file, bodyText).then(result => {
                            applyClassification(file, result);
                            logPhase(file.path, 'tier3', result);
                            // .then() resolves after this reconcile() pass has already
                            // returned - nothing else will notice the freshly-set
                            // shouldBeCollapsed without an explicit re-trigger here.
                            reconcile();
                        });
                    }
                }
            }

            const domCollapsed = isCollapsed(header);
            file.isCollapsed = domCollapsed;
            if (domCollapsed !== file.shouldBeCollapsed) {
                // Do not update file.isCollapsed here even if the click lands
                // synchronously - let the mutation that click produces drive the
                // next reconcile() pass's read, so a landed collapse is never
                // double-processed against a value we merely assumed.
                clickCollapseButton(pathDigest, header);
            } else {
                applyClassificationLabel(header, file.classification);
            }
        }
        updateToggleButtonLabel();
        updateHeaderLineStats();
        collapseJunkFolders();
    }

    // Finishes a viewed file's deferred Tier 2/3 classification once the user
    // opens it. The body is mounted and expanded by now, so Tier 2 can read it
    // directly. Deliberately does NOT go through applyClassification: that would
    // set shouldBeCollapsed = globalHideJunk for a junk file, re-collapsing the
    // file the user just opened - the one thing this path must never do. So it
    // writes classification directly and leaves shouldBeCollapsed untouched
    // (already false - never true while UNCLASSIFIED). Calls reconcile() itself
    // since this runs from its own observer callback, outside reconcile()'s call
    // stack.
    async function classifyDeferredOnOpen(pathDigest, file) {
        // The header's collapsed class and the diff body's content land in
        // separate DOM mutations - the observer can fire on the former before the
        // latter has painted. Bail out (without clearing tier2Deferred) and retry
        // on the next mutation, rather than reading an empty body and falling
        // through to a premature, permanent 'normal'.
        const bodyText = getBodyText(pathDigest);
        if (bodyText.trim().length === 0) return;

        file.tier2Deferred = false;
        const tier2Match = classifyTier2(file, pathDigest);
        if (tier2Match) {
            file.classification = tier2Match;
            logPhase(file.path, 'upgraded-on-open', `tier2: ${tier2Match}`);
        } else {
            file.classification = await classifyTier3(file, bodyText);
            logPhase(file.path, 'upgraded-on-open', `tier3: ${file.classification}`);
        }
        reconcile();
    }

    // Evaluates every sidebar file-tree folder against folderCollapseState and
    // collapses whichever ones just became eligible - mirroring the collapsed
    // state their diffs settled into in the main panel. Called at the end of
    // every reconcile() pass (cheap: 'analyzed' folders are skipped instantly),
    // so a folder collapses the moment every one of its files is settled
    // (classified or viewed), rather than waiting for every file in the whole
    // PR to settle first. Once a folder is analyzed it's never reconsidered -
    // a folder the user explicitly re-opens afterward doesn't keep snapping
    // shut on its own, and a file within it going from junk back to 'normal'
    // (impossible today, but the invariant is intentional) wouldn't reopen it.
    //
    // Clicks at most one folder's toggle per call, then returns - clicking
    // several toggle buttons synchronously in the same tick outran GitHub's
    // virtualized tree library badly enough that every collapsed folder except
    // the very last one clicked needed two real clicks to reopen (its own
    // internal focus/rove-index bookkeeping never got to flush between our
    // clicks). The reconcileObserver's mutation callback re-invokes reconcile()
    // (and so this function) after each click's own DOM mutation lands, so the
    // remaining eligible folders still all collapse - just one real frame apart
    // instead of piled into one synchronous burst.
    function collapseJunkFolders() {
        const tree = document.querySelector(SEL.fileTree);
        if (!tree) {
            warnPhase('(page)', 'collapse-folders', 'no file tree found, skipping');
            return;
        }

        const isSettled = (file) => file.viewed || file.classification !== 'UNCLASSIFIED';
        const isJunkOrViewed = (file) => file.viewed || isJunk(file);

        // A folder nested inside one we've already collapsed must never be
        // touched: GitHub hides/unmounts its contents (including its own
        // toggle button) the instant the ancestor collapses, so clicking a
        // child folder's toggle in that same state - or even just re-reading
        // it - is exactly what desynced GitHub's own focus-tracking library
        // (the "Element requested is not a known focusable element" warning)
        // and made a click land on the wrong folder. Once a folder collapses,
        // every descendant is marked 'analyzed' immediately, without ever
        // being read or clicked - the ancestor's own collapsed state already
        // speaks for all of them.
        const isDescendantOfCollapsed = (folder) => {
            let ancestor = folder.parentElement?.closest(SEL.treeFolder);
            while (ancestor) {
                if (folderCollapseState.get(ancestor.id) === 'collapsed') return true;
                ancestor = ancestor.parentElement?.closest(SEL.treeFolder);
            }
            return false;
        };

        const folders = tree.querySelectorAll(SEL.treeFolder);
        for (let i = 0; i < folders.length; i++) {
            const folder = folders[i];
            // Keyed by the folder's own DOM id (GitHub derives it from the
            // folder's path, so it's stable across mount/unmount), not a hash
            // of its currently-rendered children - the sidebar tree is
            // virtualized, so a folder that's unmounted (its parent collapsed)
            // and later remounted can render an incomplete child list at the
            // instant we scan it, producing a different hash than what we
            // recorded before. That cache-miss made an already-'analyzed'
            // folder look brand new and re-triggered its collapse click right
            // as the user tried to open it.
            const key = folder.id;
            if (!key) continue;

            if (folderCollapseState.has(key)) continue;

            if (isDescendantOfCollapsed(folder)) {
                folderCollapseState.set(key, 'analyzed');
                logPhase('(page)', 'collapse-folders', `folder[${i}] skipped - descendant of a collapsed ancestor`);
                continue;
            }

            const hashes = Array.from(folder.querySelectorAll(SEL.treeFileLink))
                .map(a => a.getAttribute('href').slice(1).replace(/^diff-/, ''));
            if (hashes.length === 0) continue;

            const filesInFolder = hashes.map(h => files.get(h));
            const statuses = hashes.map((h, j) => {
                const file = filesInFolder[j];
                return `${file?.path ?? h}=${file ? (file.viewed ? 'viewed' : file.classification) : 'MISSING'}`;
            });

            if (!filesInFolder.every(f => f && isSettled(f))) {
                logPhase('(page)', 'collapse-folders', `folder[${i}] pending (${statuses.join(', ')})`);
                continue;
            }

            if (!filesInFolder.every(f => isJunkOrViewed(f))) {
                folderCollapseState.set(key, 'analyzed');
                logPhase('(page)', 'collapse-folders', `folder[${i}] analyzed, not all junk/viewed - leaving open (${statuses.join(', ')})`);
                continue;
            }

            const toggleSvg = folder.querySelector(SEL.treeFolderToggle);
            const toggleBtn = toggleSvg?.closest('button, [class*="toggle"]');
            if (!toggleBtn) {
                folderCollapseState.set(key, 'analyzed');
                warnPhase('(page)', 'collapse-folders', `folder[${i}] all junk/viewed but no toggle button found (${statuses.join(', ')})`);
                continue;
            }
            folderCollapseState.set(key, 'collapsed');
            logPhase('(page)', 'collapse-folders', `folder[${i}] collapsing (${statuses.join(', ')})`);
            toggleBtn.click();
            return;
        }
    }

    // Watches viewed files that still have a deferred tier-2/3 pass. When the
    // user opens one (its header loses the collapsed class), we finish
    // classifying it. Reads the collapsed state on each mutation rather than
    // trusting a one-shot check, since GitHub re-renders headers as they mount.
    function watchViewedFilesForOpen() {
        const deferred = [...files.entries()].filter(([, file]) => file.tier2Deferred);
        if (deferred.length === 0) return;

        const observer = new MutationObserver(() => {
            for (const [pathDigest, file] of deferred) {
                if (!file.tier2Deferred) continue;
                const header = getHeader(getDiffEntry(pathDigest));
                if (header && !isCollapsed(header)) {
                    // classifyDeferredOnOpen clears the flag synchronously before
                    // its await, so the file won't be picked up twice.
                    classifyDeferredOnOpen(pathDigest, file);
                }
            }
            if (deferred.every(([, file]) => !file.tier2Deferred)) {
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    let toggleButtonEl = null;

    // Label reflects globalHideJunk directly rather than scanning DOM state - the
    // button's text is the toggle's intent, not a report on whether every junk
    // file happens to currently be collapsed (a manual per-file override no
    // longer needs to change what the button says).
    function updateToggleButtonLabel() {
        if (!toggleButtonEl) return;
        const text = globalHideJunk ? 'Show junk' : 'Hide junk';
        setTextIfChanged(toggleButtonEl, text);
    }

    // Flips the global intent and applies it to every currently-known junk file,
    // overriding any prior manual per-file override - per spec, the global toggle
    // always wins. reconcile() is what actually drives the DOM to match; called
    // explicitly here per stuck-state invariant 2, since nothing else guarantees
    // a reconcile pass runs if the page happens to be otherwise quiet.
    function toggleJunk() {
        globalHideJunk = !globalHideJunk;
        for (const file of files.values()) {
            if (isJunk(file)) file.shouldBeCollapsed = globalHideJunk;
        }
        reconcile();
    }

    function insertToggleButton() {
        const submitButton = document.querySelector(SEL.toolbarSubmitButton);
        if (!submitButton) return;
        const container = submitButton.parentElement;
        if (!container || container.hasAttribute(HANDLED_ATTR)) return;
        container.setAttribute(HANDLED_ATTR, '1');

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Hide junk';
        button.className = submitButton.className;
        button.addEventListener('click', toggleJunk);

        container.insertBefore(button, submitButton);
        toggleButtonEl = button;
        updateToggleButtonLabel();
    }

    let running = false;

    // Path we've already tried the fetch fallback for and come up empty on -
    // prevents re-fetching on every later mutation when the fallback itself
    // finds nothing (a genuine failure, not just a timing issue).
    let fetchFallbackFailedFor = null;

    async function run() {
        // The body MutationObserver fires on every mutation we cause while
        // sweeping (collapsing), so guard against a second run() stomping on the
        // first mid-build.
        if (running) {
            logPhase('(page)', 'run', 'already running, skipping');
            return;
        }
        running = true;
        const path = window.location.pathname;
        logPhase('(page)', 'run', `starting for ${path}`);
        try {
            buildRegistry();
            logPhase('(page)', 'run', `registry built, ${files.size} file(s)`);
            if (files.size === 0) {
                if (fetchFallbackFailedFor === path) {
                    logPhase('(page)', 'registry', 'fetch fallback already failed for this path, will retry on next navigation');
                    return;
                }
                // GitHub only embeds the pullRequestsChangesRoute JSON island on a
                // real server-rendered page load. A Turbo Drive tab switch (e.g. the
                // main PR page -> "Files changed") swaps the URL and patches the DOM,
                // but never re-embeds that JSON into the live document - so an empty
                // registry here usually isn't a slow render to retry, it's data that
                // will never arrive from the live DOM. Fetch the URL directly instead
                // (GitHub still server-renders the JSON into that response) and
                // rebuild from it - no visible reload needed.
                warnPhase('(page)', 'registry', 'no files found in live DOM, fetching page directly');
                try {
                    const routeArrays = await fetchEmbeddedRouteArrays();
                    buildRegistry(routeArrays);
                    logPhase('(page)', 'run', `registry built from fetch, ${files.size} file(s)`);
                } catch (err) {
                    warnPhase('(page)', 'registry-fetch-error', err.message);
                }
                if (files.size === 0) {
                    warnPhase('(page)', 'registry', 'still no files after fetch, giving up for this navigation');
                    fetchFallbackFailedFor = path;
                    return;
                }
            }
            fetchFallbackFailedFor = null;
            registryPath = path;
            insertToggleButton();
            runTier1();
            reconcile();
            watchViewedFilesForOpen();
            logPhase('(page)', 'run', 'complete');
        } finally {
            running = false;
        }
    }

    function isDiffPage() {
        return /\/pull\/\d+\/(files|changes)/.test(window.location.pathname);
    }

    // owner/repo#number for the PR the current pathname points at, or null off a
    // diff page. Used as a defense-in-depth guard: if a soft navigation ever lands
    // on a different PR than the one our state belongs to, wipe everything rather
    // than trust needsRebuild's plain pathname comparison alone to always catch it.
    function getPrSlug() {
        const match = window.location.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)/);
        return match ? `${match[1]}#${match[2]}` : null;
    }

    let currentPrSlug = null;

    // Wipes all per-PR state (but not globalHideJunk - see its own comment on why
    // that intentionally persists across Turbo navigation) so a stale file's
    // cached classification/shouldBeCollapsed from a previous PR can never leak
    // into a different PR's diff list.
    function wipeStateForNewPr(slug) {
        files.clear();
        selfClicking.forEach(clearTimeout);
        selfClicking.clear();
        clearTimeout(altSweepQuietTimer);
        altSweepActive = false;
        folderCollapseState.clear();
        toggleButtonEl = null;
        hideLineStatsTooltip();
        registryPath = '';
        currentPrSlug = slug;
        logPhase('(page)', 'pr-slug', `switched PR - wiped state (now ${slug})`);
    }

    function onPageReady(source) {
        const path = window.location.pathname;
        logPhase('(page)', 'onPageReady', `source=${source ?? 'unknown'} path=${path}`);
        // Updated unconditionally, before the isDiffPage() early return below -
        // see lastSeenPath's own comment for why a round trip through a non-diff
        // page must still register as a pathname change.
        const pathChangedSinceLastSeen = path !== lastSeenPath;
        lastSeenPath = path;
        if (!isDiffPage()) {
            logPhase('(page)', 'onPageReady', 'not a diff page, ignoring');
            return;
        }
        const slug = getPrSlug();
        if (slug && slug !== currentPrSlug) {
            wipeStateForNewPr(slug);
        }
        if (needsRebuild()) {
            logPhase('(page)', 'onPageReady', 'needs rebuild, calling run()');
            run();
            return;
        }
        // Same path as our last run: nothing to rebuild. If Turbo has reset the
        // diff list back to fully expanded (e.g. navigating to another PR tab like
        // Checks and back), reconcile() notices the disagreement between
        // shouldBeCollapsed and the DOM on its next trigger - no special-case
        // detection needed, since files still holds accurate classification data.
        // The sidebar file tree needs its own reset, though: Turbo re-expands it on
        // a genuine tab-switch-and-back, but collapseJunkFolders() has no DOM state
        // of its own to notice - folderCollapseState would otherwise still call
        // every folder 'analyzed' and permanently skip re-collapsing.
        //
        // Gated on the pathname actually having changed (pathChangedSinceLastSeen),
        // not merely `source !== 'mutation'` - pushState/replaceState/popstate also
        // fire for same-page anchor navigation (e.g. GitHub's router updating the
        // URL hash when a sidebar file is clicked), which never touches the pathname
        // or resets the tree. Clearing on every one of those wiped
        // folderCollapseState on almost any click, making collapseJunkFolders()
        // re-collapse every settled folder - including the one just opened.
        if (pathChangedSinceLastSeen) {
            folderCollapseState.clear();
        }
        insertToggleButton();
        reconcile();
    }

    onPageReady('initial');

    // Observe documentElement, not body: Turbo Drive navigations (e.g. the main PR
    // page -> "Files changed" tab) can replace document.body wholesale rather than
    // mutating its children, which would silently detach an observer bound to the
    // old body and leave it never firing again. documentElement is never swapped.
    const pageReadyObserver = new MutationObserver(() => onPageReady('mutation'));
    pageReadyObserver.observe(document.documentElement, { childList: true, subtree: true });

    // The reconciler observer: separate from the one above since it only needs to
    // see diff-list mutations (collapsing, mounting) - document.body, not
    // documentElement, is fine here since a Turbo body swap is instead caught by
    // the pageReadyObserver above triggering a fresh run().
    const reconcileObserver = new MutationObserver(() => {
        // While another extension's collapse-all/expand-all sweep is in flight,
        // every mutation it produces just extends the quiet window and defers our
        // reconcile - see altSweepActive. reconcile() itself also early-returns
        // during the sweep, so this guard is only about re-arming the timer.
        if (altSweepActive) {
            extendAltSweep();
            return;
        }
        reconcile();
    });
    reconcileObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // Delegated listener for manual user clicks on a diff header's collapse
    // chevron. Ignores clicks on files we don't track and clicks that are our own
    // in-flight programmatic click (selfClicking). Immediately puts the file into
    // selfClicking itself (a click event fires synchronously before React's
    // re-render) so the reconcileObserver, which reacts to that same click's
    // eventual DOM mutation, doesn't see shouldBeCollapsed still disagreeing with
    // the not-yet-updated DOM and re-click the user's own click away - the two
    // animation frames give React time to actually flip the class before we read
    // it and resync shouldBeCollapsed to match.
    document.addEventListener('click', (e) => {
        const header = e.target.closest(SEL.diffHeader);
        if (!header) return;
        const pathDigest = pathDigestFromHeader(header);
        const file = pathDigest && files.get(pathDigest);
        if (!file || selfClicking.has(pathDigest)) return;

        // Alt-click is another extension's collapse-all/expand-all gesture: it
        // drives every file to one uniform state, keyed off the clicked file's
        // current state (expanded -> collapse everything, collapsed -> expand
        // everything). We don't own it and must not fight it - adopt its target
        // as our own desired state for every file, and sync the global toggle
        // intent so a classification resolving later can't re-collapse a file the
        // gesture just expanded. extendAltSweep() then keeps reconcile() hands-off
        // for the burst. We never preventDefault: the other extension does the
        // actual collapsing.
        if (e.altKey) {
            const targetCollapsed = !isCollapsed(header);
            globalHideJunk = targetCollapsed;
            for (const f of files.values()) f.shouldBeCollapsed = targetCollapsed;
            extendAltSweep();
            return;
        }

        const guardTimer = setTimeout(() => selfClicking.delete(pathDigest), SELF_CLICK_GUARD_MS);
        selfClicking.set(pathDigest, guardTimer);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            clearTimeout(guardTimer);
            selfClicking.delete(pathDigest);
            const nowCollapsed = isCollapsed(header);
            file.shouldBeCollapsed = nowCollapsed;
            file.isCollapsed = nowCollapsed;
            // Per reconcile()'s stuck-state invariant: any caller that mutates
            // shouldBeCollapsed/classification asynchronously must trigger reconcile()
            // itself. Without this, a file whose classification lands while
            // selfClicking is still guarding it (e.g. a deferred viewed file opened by
            // the user) never gets its label applied unless some unrelated mutation
            // happens to fire reconcile() again afterward.
            reconcile();
        }));
    }, true);

    // GitHub is a single-page app (Turbo): navigating from the main PR page to the
    // "Files changed" tab (or between diff pages) often updates the URL without a
    // full reload, and without necessarily mutating document.body in a way the
    // observer above catches. Hook the history API and Turbo's own navigation
    // event so a landing on a diff page always re-triggers onPageReady, even when
    // the DOM mutation observer alone would miss it.
    for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function () {
            const result = original.apply(this, arguments);
            onPageReady(method);
            return result;
        };
    }
    window.addEventListener('popstate', () => onPageReady('popstate'));
    document.addEventListener('turbo:load', () => onPageReady('turbo:load'));
})();
