// ==UserScript==
// @name         claudeBudgetPacer
// @version      1.4
// @description  Shows spending progress relative to monthly budget and days remaining on Claude API usage page
// @match        https://claude.ai/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/claudeBudgetPacer/claudeBudgetPacer.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/claudeBudgetPacer/claudeBudgetPacer.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Get current date/time in local timezone (America/Los_Angeles)
    function getLocalNow() {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(new Date());
        const partMap = {};
        parts.forEach(p => {
            partMap[p.type] = p.value;
        });
        return new Date(
            parseInt(partMap.year),
            parseInt(partMap.month) - 1,
            parseInt(partMap.day),
            parseInt(partMap.hour),
            parseInt(partMap.minute),
            parseInt(partMap.second)
        );
    }

    // The business day runs 8am-5pm, which lines up with the 5pm budget reset.
    const BUSINESS_DAY_START_HOUR = 8;
    const BUSINESS_DAY_END_HOUR = 17;
    const HOURS_PER_BUSINESS_DAY = BUSINESS_DAY_END_HOUR - BUSINESS_DAY_START_HOUR;
    const MS_PER_HOUR = 60 * 60 * 1000;

    function isWeekday(date) {
        const dayOfWeek = date.getDay();
        return dayOfWeek >= 1 && dayOfWeek <= 5;
    }

    // Count business days (Mon-Fri) from startDate's day through endDate's day,
    // inclusive on both ends. A day whose business window has already closed at
    // startDate does not count, so a window that opens at a 5pm reset starts the
    // following day.
    function countBusinessDays(startDate, endDate) {
        const cursor = new Date(startDate);
        cursor.setHours(0, 0, 0, 0);
        if (startDate.getHours() >= BUSINESS_DAY_END_HOUR) {
            cursor.setDate(cursor.getDate() + 1);
        }

        const last = new Date(endDate);
        last.setHours(0, 0, 0, 0);

        let daysCount = 0;
        while (cursor <= last) {
            if (isWeekday(cursor)) {
                daysCount += 1;
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        return daysCount;
    }

    function dayStart(date) {
        const d = new Date(date);
        d.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
        return d;
    }

    function dayEnd(date) {
        const d = new Date(date);
        d.setHours(BUSINESS_DAY_END_HOUR, 0, 0, 0);
        return d;
    }

    // Business hours (Mon-Fri, 8am-5pm) between two dates, clipping partial days
    // to the actual overlap so a mid-morning "now" is counted precisely.
    function businessHoursBetween(startDate, endDate) {
        if (endDate <= startDate) return 0;

        let ms = 0;
        const cursor = new Date(startDate);
        cursor.setHours(0, 0, 0, 0);

        while (cursor < endDate) {
            if (isWeekday(cursor)) {
                const overlapStart = Math.max(startDate.getTime(), dayStart(cursor).getTime());
                const overlapEnd = Math.min(endDate.getTime(), dayEnd(cursor).getTime());
                if (overlapEnd > overlapStart) {
                    ms += overlapEnd - overlapStart;
                }
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        return ms / MS_PER_HOUR;
    }

    // Percentage through the budget window, measured in business hours
    function getWindowProgressPercent(windowStart, now, resetDate) {
        const totalBusinessHours = businessHoursBetween(windowStart, resetDate);
        if (totalBusinessHours === 0) return 0;
        const remaining = businessHoursBetween(now, resetDate);
        const elapsed = totalBusinessHours - remaining;
        return Math.min(100, Math.max(0, (elapsed / totalBusinessHours) * 100));
    }

    // Calculate recommended spend per business hour to hit limit by reset date
    function getBudgetPerBusinessHour(spentAmount, limitAmount, now, resetDate) {
        const remainingBusinessHours = businessHoursBetween(now, resetDate);
        if (remainingBusinessHours === 0) return 0;
        return (limitAmount - spentAmount) / remainingBusinessHours;
    }

    // Calculate recommended spend per business day to hit limit
    function getBudgetPerBusinessDay(spentAmount, limitAmount, now, resetDate) {
        return getBudgetPerBusinessHour(spentAmount, limitAmount, now, resetDate) * HOURS_PER_BUSINESS_DAY;
    }

    // Parse reset date from text like "Resets Fri, Jul 31, 5:00 PM PDT"
    function parseResetDate(resetText) {
        const match = resetText.match(/(\w+)\s+(\d+)/);
        if (!match) return null;

        const monthStr = match[1];
        const dayStr = parseInt(match[2]);

        const months = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };

        const month = months[monthStr];
        if (month === undefined) return null;

        // The reset happens at a wall-clock time on that day (5:00 PM in practice).
        // Without it the final day of the window would be dropped entirely.
        let hour = BUSINESS_DAY_END_HOUR;
        let minute = 0;
        const timeMatch = resetText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (timeMatch) {
            hour = parseInt(timeMatch[1]) % 12;
            if (timeMatch[3].toUpperCase() === 'PM') hour += 12;
            minute = parseInt(timeMatch[2]);
        }

        const year = new Date().getFullYear();
        const resetDate = new Date(year, month, dayStr, hour, minute, 0, 0);

        // If the reset date is in the past, it must be next year
        if (resetDate < getLocalNow()) {
            resetDate.setFullYear(year + 1);
        }

        return resetDate;
    }

    // Remembering past reset times lets us measure the window from the previous
    // reset rather than assuming it started on the 1st of the month.
    const DEADLINE_STORAGE_KEY = 'claudeBudgetPacer.deadlines';
    const MAX_STORED_DEADLINES = 2;
    const MAX_WINDOW_DAYS = 45;

    function readStoredDeadlines() {
        try {
            const raw = localStorage.getItem(DEADLINE_STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map(value => new Date(value))
                .filter(date => !isNaN(date.getTime()));
        } catch (e) {
            return [];
        }
    }

    function writeStoredDeadlines(deadlines) {
        try {
            const serialized = deadlines
                .slice()
                .sort((a, b) => a - b)
                .slice(-MAX_STORED_DEADLINES)
                .map(date => date.toISOString());
            localStorage.setItem(DEADLINE_STORAGE_KEY, JSON.stringify(serialized));
        } catch (e) {
            // Storage unavailable; fall back to the default window start.
        }
    }

    // Record the current reset time and return the start of the current window:
    // the most recent previously-seen reset, or the 1st of the reset month.
    function resolveWindowStart(resetDate, now) {
        const stored = readStoredDeadlines();
        const known = stored.some(date => date.getTime() === resetDate.getTime());
        writeStoredDeadlines(known ? stored : stored.concat([resetDate]));

        const earliestAllowed = new Date(resetDate.getTime() - MAX_WINDOW_DAYS * 24 * MS_PER_HOUR);
        const candidates = stored.filter(date =>
            date < resetDate && date <= now && date > earliestAllowed
        );

        if (candidates.length === 0) {
            return new Date(resetDate.getFullYear(), resetDate.getMonth(), 1, 0, 0, 0, 0);
        }

        return new Date(Math.max.apply(null, candidates.map(date => date.getTime())));
    }

    // Parse spend amount from text like "$499.17 of $2,000.00 spent"
    function parseSpendAmounts(spendText) {
        const match = spendText.match(/\$([0-9,]+(?:\.\d{2})?)\s+of\s+\$([0-9,]+(?:\.\d{2})?)/);
        if (!match) return null;

        const spent = parseFloat(match[1].replace(/,/g, ''));
        const limit = parseFloat(match[2].replace(/,/g, ''));

        return { spent, limit };
    }

    // Format currency for display
    function formatCurrency(amount) {
        return '$' + amount.toFixed(2);
    }

    // The observer fires on nearly every SPA render, so a bail-out reason would be
    // logged hundreds of times. Log each distinct reason at most once per interval.
    const BAIL_LOG_INTERVAL_MS = 5000;
    const lastBailLogAt = {};

    // Log why injection stopped, then return false so callers can `return bail(...)`.
    function bail(reason, details) {
        const now = Date.now();
        if (lastBailLogAt[reason] && now - lastBailLogAt[reason] < BAIL_LOG_INTERVAL_MS) return false;
        lastBailLogAt[reason] = now;
        console.log('[claudeBudgetPacer] stopped: ' + reason, details || '');
        return false;
    }

    // Compact description of an element for bail-out logs: enough to compare against
    // the selectors above without dumping the whole subtree.
    function describe(el) {
        if (!el) return null;
        return {
            tag: el.tagName,
            className: typeof el.className === 'string' ? el.className : String(el.className),
            childCount: el.children.length,
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200)
        };
    }

    // Find and inject progress bars into the usage limits section
    function injectProgressBars() {
        // Find the section containing "Your usage limits"
        const headings = Array.from(document.querySelectorAll('h3'));
        const usageLimitHeading = headings.find(h => h.textContent.includes('Your usage limits'));
        if (!usageLimitHeading) {
            return bail('no h3 containing "Your usage limits"', {
                path: location.pathname,
                h3Count: headings.length,
                h3Texts: headings.map(h => h.textContent.trim().slice(0, 60)),
                headingTexts: Array.from(document.querySelectorAll('h1,h2,h3,h4'))
                    .map(h => h.tagName + ': ' + h.textContent.trim().slice(0, 60)),
                pageMentionsUsageLimits: document.body.textContent.includes('Your usage limits')
            });
        }

        // Walk up to the enclosing section
        let section = usageLimitHeading.closest('section');
        if (!section) {
            return bail('heading has no ancestor <section>', {
                heading: describe(usageLimitHeading),
                ancestors: (function() {
                    const chain = [];
                    let el = usageLimitHeading.parentElement;
                    while (el && chain.length < 6) {
                        chain.push(el.tagName + '.' + (typeof el.className === 'string' ? el.className : ''));
                        el = el.parentElement;
                    }
                    return chain;
                })()
            });
        }

        // Check if we've already injected (prevent double-injection on re-renders)
        if (section.querySelector('[data-usage-month-progress]')) return;

        // Find the spend row by what it contains rather than by the class of its
        // wrapper, which the app has renamed before (divide-y -> settings-group-dividers).
        // The row is the outermost flex column holding both the "spent" text and the meter.
        const spendRow = Array.from(section.querySelectorAll('div')).find(el =>
            el.classList.contains('flex') &&
            el.classList.contains('flex-col') &&
            el.textContent.includes('spent') &&
            el.querySelector('[data-cds="Meter"]')
        );
        if (!spendRow) {
            return bail('no flex-col row containing both "spent" and a Meter', {
                section: describe(section),
                sectionMentionsSpent: section.textContent.includes('spent'),
                meterCount: section.querySelectorAll('[data-cds="Meter"]').length,
                flexColClasses: Array.from(section.querySelectorAll('div'))
                    .filter(el => el.classList.contains('flex') && el.classList.contains('flex-col'))
                    .map(el => el.className)
            });
        }

        // Find the spend amount text div
        const spendAmountDiv = Array.from(spendRow.querySelectorAll('div')).find(
            el => el.textContent.includes('spent')
        );
        if (!spendAmountDiv) {
            return bail('no div containing "spent" in the spend row', {
                spendRow: describe(spendRow),
                divTexts: Array.from(spendRow.querySelectorAll('div'))
                    .map(el => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 80))
                    .filter(Boolean)
                    .slice(0, 20)
            });
        }

        // Find the reset text and left container
        const leftContainer = spendAmountDiv.closest('[class*="md:w-80"]');
        if (!leftContainer) {
            return bail('spend amount has no [class*="md:w-80"] ancestor', {
                spendAmountDiv: describe(spendAmountDiv),
                ancestorClasses: (function() {
                    const chain = [];
                    let el = spendAmountDiv.parentElement;
                    while (el && el !== spendRow.parentElement && chain.length < 6) {
                        chain.push(el.className);
                        el = el.parentElement;
                    }
                    return chain;
                })()
            });
        }

        const resetTextDiv = Array.from(leftContainer.querySelectorAll('div')).find(
            el => el.textContent.includes('Resets')
        );
        if (!resetTextDiv) {
            return bail('no div containing "Resets" in the left container', {
                leftContainer: describe(leftContainer),
                sectionMentionsResets: section.textContent.includes('Resets'),
                sectionResetSnippet: (section.textContent.match(/Resets[^\n]{0,60}/) || [null])[0]
            });
        }

        const resetText = resetTextDiv.textContent;
        const spendText = spendAmountDiv.textContent;

        const amounts = parseSpendAmounts(spendText);
        const resetDate = parseResetDate(resetText);
        if (!amounts || !resetDate) {
            return bail('could not parse the spend or reset text', {
                spendText: spendText.replace(/\s+/g, ' ').trim().slice(0, 200),
                resetText: resetText.replace(/\s+/g, ' ').trim().slice(0, 200),
                parsedAmounts: amounts,
                parsedResetDate: resetDate ? resetDate.toString() : null
            });
        }

        const now = getLocalNow();
        const windowStart = resolveWindowStart(resetDate, now);
        const monthProgressPercent = getWindowProgressPercent(windowStart, now, resetDate);
        const budgetPerBusinessDay = getBudgetPerBusinessDay(amounts.spent, amounts.limit, now, resetDate);

        const totalCalendarDays = resetDate.getDate();
        const currentCalendarDay = now.getDate();
        const totalBusinessDays = countBusinessDays(windowStart, resetDate);
        const currentBusinessDay = countBusinessDays(windowStart, now);
        const totalBusinessHours = businessHoursBetween(windowStart, resetDate);
        const remainingBusinessHours = businessHoursBetween(now, resetDate);
        const elapsedBusinessHours = totalBusinessHours - remainingBusinessHours;
        const budgetPerHour = getBudgetPerBusinessHour(amounts.spent, amounts.limit, now, resetDate);
        const spentPercent = amounts.limit === 0 ? 0 : (amounts.spent / amounts.limit) * 100;

        console.log('[claudeBudgetPacer]', {
            now: now.toLocaleDateString() + ' ' + now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' }),
            resetDate: resetDate.toLocaleString(),
            windowStart: windowStart.toLocaleString(),
            spent: amounts.spent,
            limit: amounts.limit,
            remaining: amounts.limit - amounts.spent,
            calendarDays: `Day ${currentCalendarDay} of ${totalCalendarDays}`,
            businessDays: `Business day ${currentBusinessDay} of ${totalBusinessDays}`,
            totalBusinessHours,
            elapsedBusinessHours,
            remainingBusinessHours,
            monthProgressPercent: monthProgressPercent.toFixed(2) + '%',
            spentPercent: spentPercent.toFixed(2) + '%',
            paceDeltaPercent: (spentPercent - monthProgressPercent).toFixed(2) + '%',
            budgetPerHour: '$' + budgetPerHour.toFixed(2) + '/hour',
            budgetPerBusinessDay: '$' + budgetPerBusinessDay.toFixed(2) + `/business day (${HOURS_PER_BUSINESS_DAY} hours)`
        });

        // Find the existing meter in the spend row
        const existingMeter = spendRow.querySelector('[data-cds="Meter"]');
        if (!existingMeter) {
            return bail('no [data-cds="Meter"] in the spend row', {
                spendRow: describe(spendRow),
                dataCdsValuesInSection: Array.from(section.querySelectorAll('[data-cds]'))
                    .map(el => el.getAttribute('data-cds')),
                meterRolesInSection: section.querySelectorAll('[role="meter"]').length,
                progressbarRolesInSection: section.querySelectorAll('[role="progressbar"]').length
            });
        }

        // Find the percent label span (the one showing "25% used")
        const percentLabelSpan = spendRow.querySelector('span[class*="text-footnote"][class*="text-secondary"]');
        if (!percentLabelSpan) {
            return bail('no percent label span (text-footnote + text-secondary) in the spend row', {
                spanClasses: Array.from(spendRow.querySelectorAll('span')).map(el => ({
                    className: el.className,
                    text: el.textContent.trim().slice(0, 40)
                }))
            });
        }

        // Clone the entire spend row to create the month progress row
        const monthProgressRow = spendRow.cloneNode(true);
        monthProgressRow.setAttribute('data-usage-month-progress', 'month-bar');

        // Update the left side of the month progress row
        const monthLeftContent = monthProgressRow.querySelector('[class*="md:w-80"]');
        if (!monthLeftContent) {
            bail('cloned row has no [class*="md:w-80"] left content; labels will be wrong');
        }
        if (monthLeftContent) {
            const titleDiv = monthLeftContent.querySelector('[class*="text-body"]');
            if (titleDiv) {
                titleDiv.textContent = 'Month progress';
            }
            const descDiv = monthLeftContent.querySelector('[class*="text-footnote"]');
            if (descDiv) {
                descDiv.textContent = `Day ${currentCalendarDay} of ${totalCalendarDays} - Business day ${currentBusinessDay} of ${totalBusinessDays}`;
            }
        }

        // Update the meter fill in the month progress row
        const monthMeter = monthProgressRow.querySelector('[data-cds="Meter"]');
        if (monthMeter) {
            // Update the inner fill bar transform
            const fillBar = monthMeter.querySelector('[role="meter"]');
            if (!fillBar) {
                bail('cloned meter has no [role="meter"] fill bar; bar will not reflect progress', {
                    monthMeterHtml: monthMeter.outerHTML.slice(0, 500)
                });
            }
            if (fillBar) {
                const innerDiv = fillBar.querySelector('div');
                if (!innerDiv) {
                    bail('fill bar has no inner div to transform', {
                        fillBarHtml: fillBar.outerHTML.slice(0, 500)
                    });
                }
                if (innerDiv) {
                    // Use the same transform calculation as the original component
                    innerDiv.style.transform = `translateX(calc(var(--_meter-dir, -1) * (100% - min(100%, max(${monthProgressPercent}%, 8px)))))`;
                }
                // Update aria attributes
                fillBar.setAttribute('aria-valuenow', monthProgressPercent.toFixed(1));
                fillBar.setAttribute('aria-valuetext', Math.round(monthProgressPercent) + '% through');
            }
        }

        // Update the percent label in the month progress row to show the month percent
        const monthPercentLabelSpan = monthProgressRow.querySelector('span[class*="text-footnote"][class*="text-secondary"]');
        if (monthPercentLabelSpan) {
            monthPercentLabelSpan.textContent = Math.round(monthProgressPercent) + '% through';
        }

        // Insert the month progress row after the spend row
        spendRow.parentElement.insertBefore(monthProgressRow, spendRow.nextSibling);

        // Add budget per business day text below the spend amount (inside left container)
        if (!leftContainer.querySelector('[data-budget-per-day]')) {
            const budgetDiv = document.createElement('div');
            budgetDiv.className = 'text-footnote text-secondary';
            budgetDiv.setAttribute('data-budget-per-day', 'true');
            budgetDiv.style.marginTop = '0.25rem';
            budgetDiv.textContent = 'Budget: ' + formatCurrency(budgetPerBusinessDay) + ' / day';
            leftContainer.appendChild(budgetDiv);
        }

        console.log('[claudeBudgetPacer] injected month progress row');
        return true;
    }

    // Set up mutation observer to handle SPA re-renders
    function setupObserver() {
        const observer = new MutationObserver(() => {
            try {
                injectProgressBars();
            } catch (e) {
                console.error('[claudeBudgetPacer] Error injecting bars:', e);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        // Initial injection
        try {
            injectProgressBars();
        } catch (e) {
            console.error('[claudeBudgetPacer] Error on initial injection:', e);
        }
    }

    // Manual entry point for debugging: run one injection attempt with the
    // throttle cleared, so the current bail-out reason always prints.
    window.claudeBudgetPacerDebug = function() {
        Object.keys(lastBailLogAt).forEach(key => delete lastBailLogAt[key]);
        const existing = document.querySelector('[data-usage-month-progress]');
        if (existing) existing.remove();
        return injectProgressBars();
    };

    // Start the script
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupObserver);
    } else {
        setupObserver();
    }
})();
