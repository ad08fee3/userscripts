// ==UserScript==
// @name         claudeBudgetPacer
// @version      1.2
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

    // Count business days (Mon-Fri) between two dates in local time
    function countBusinessDays(startDate, endDate) {
        let daysCount = 0;
        let currentDate = new Date(startDate);
        currentDate.setHours(0, 0, 0, 0);

        while (currentDate < endDate) {
            const dayOfWeek = currentDate.getDay();
            // Monday = 1, Friday = 5
            if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                daysCount += 1;
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return daysCount;
    }

    // Count business hours (Mon-Fri, 8am-6pm) between two dates in local time.
    // Counts full 10-hour days for each business day in range; does not account for partial hours on the current day.
    function countBusinessHours(startDate, endDate) {
        let hoursCount = 0;
        let currentDate = new Date(startDate);
        currentDate.setHours(0, 0, 0, 0);

        while (currentDate < endDate) {
            const dayOfWeek = currentDate.getDay();
            // Monday = 1, Friday = 5
            if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                hoursCount += 10; // 8am to 6pm = 10 hours
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return hoursCount;
    }

    // Count remaining business hours from now to end of day
    function getRemainingBusinessHoursToday(now, resetDate) {
        const currentHour = now.getHours();
        const dayOfWeek = now.getDay();

        // If it's a weekend or before 8am or after 6pm, no business hours remain today
        if (dayOfWeek === 0 || dayOfWeek === 6 || currentHour < 8 || currentHour >= 18) {
            return 0;
        }

        // If past 6pm, no more hours today
        if (currentHour >= 18) {
            return 0;
        }

        // Hours remaining = 18 (6pm) - current hour
        return Math.max(0, 18 - currentHour);
    }

    // Calculate percentage through current month by business hours
    function getMonthProgressPercent(now, resetDate) {
        const monthStart = new Date(resetDate.getFullYear(), resetDate.getMonth(), 1);
        const totalBusinessHours = countBusinessHours(monthStart, resetDate);
        const elapsedBusinessHours = countBusinessHours(monthStart, now) - getRemainingBusinessHoursToday(now, resetDate);

        if (totalBusinessHours === 0) return 0;
        return Math.min(100, Math.max(0, (elapsedBusinessHours / totalBusinessHours) * 100));
    }

    // Calculate recommended spend per business hour to hit limit by reset date
    function getBudgetPerBusinessHour(spentAmount, limitAmount, now, resetDate) {
        const remainingBusinessHours = countBusinessHours(now, resetDate) + getRemainingBusinessHoursToday(now, resetDate);
        if (remainingBusinessHours === 0) return 0;
        return (limitAmount - spentAmount) / remainingBusinessHours;
    }

    // Calculate recommended spend per business day (10 business hours) to hit limit
    function getBudgetPerBusinessDay(spentAmount, limitAmount, now, resetDate) {
        const budgetPerHour = getBudgetPerBusinessHour(spentAmount, limitAmount, now, resetDate);
        return budgetPerHour * 10; // 10 business hours per day (8am-6pm)
    }

    // Parse reset date from text like "Resets Fri, Jul 31, 5:00 PM PDT"
    function parseResetDate(resetText) {
        // Extract day and month from text like "Resets Fri, Jul 31, 5:00 PM PDT"
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

        // Create date for the reset date in local timezone
        // We'll use current year, but could adjust if reset date is in next year
        let year = new Date().getFullYear();
        const resetDate = new Date(year, month, dayStr);

        // If the reset date is in the past, it must be next year
        const now = getLocalNow();
        if (resetDate < now) {
            resetDate.setFullYear(year + 1);
        }

        return resetDate;
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

    // Find and inject progress bars into the usage limits section
    function injectProgressBars() {
        // Find the section containing "Your usage limits"
        const headings = Array.from(document.querySelectorAll('h3'));
        const usageLimitHeading = headings.find(h => h.textContent.includes('Your usage limits'));
        if (!usageLimitHeading) return;

        // Walk up to the enclosing section
        let section = usageLimitHeading.closest('section');
        if (!section) return;

        // Check if we've already injected (prevent double-injection on re-renders)
        if (section.querySelector('[data-usage-month-progress]')) return;

        // Find the main content div (divide-y class)
        const contentDiv = section.querySelector('[class*="divide-y"]');
        if (!contentDiv) return;

        // Find the spend row (first flex flex-col gap-3 div within contentDiv)
        const spendRow = Array.from(contentDiv.children).find(el =>
            el.classList.contains('flex') && el.classList.contains('flex-col')
        );
        if (!spendRow) return;

        // Find the spend amount text div
        const spendAmountDiv = Array.from(spendRow.querySelectorAll('div')).find(
            el => el.textContent.includes('spent')
        );
        if (!spendAmountDiv) return;

        // Find the reset text and left container
        const leftContainer = spendAmountDiv.closest('[class*="md:w-80"]');
        if (!leftContainer) return;

        const resetTextDiv = Array.from(leftContainer.querySelectorAll('div')).find(
            el => el.textContent.includes('Resets')
        );
        if (!resetTextDiv) return;

        const resetText = resetTextDiv.textContent;
        const spendText = spendAmountDiv.textContent;

        const amounts = parseSpendAmounts(spendText);
        const resetDate = parseResetDate(resetText);
        if (!amounts || !resetDate) return;

        const now = getLocalNow();
        const monthProgressPercent = getMonthProgressPercent(now, resetDate);
        const budgetPerBusinessDay = getBudgetPerBusinessDay(amounts.spent, amounts.limit, now, resetDate);

        // Log calculations for debugging
        const monthStart = new Date(resetDate.getFullYear(), resetDate.getMonth(), 1);
        const totalCalendarDays = resetDate.getDate();
        const currentCalendarDay = now.getDate();
        const totalBusinessDays = countBusinessDays(monthStart, resetDate);
        const currentBusinessDay = countBusinessDays(monthStart, now);
        const totalBusinessHours = countBusinessHours(monthStart, resetDate);
        const rawElapsedBusinessHours = countBusinessHours(monthStart, now);
        const todayRemainingHours = getRemainingBusinessHoursToday(now, resetDate);
        const elapsedBusinessHours = rawElapsedBusinessHours - todayRemainingHours;
        const remainingBusinessHours = countBusinessHours(now, resetDate) + todayRemainingHours;
        const budgetPerHour = getBudgetPerBusinessHour(amounts.spent, amounts.limit, now, resetDate);

        console.log('[claudeBudgetPacer]', {
            now: now.toLocaleDateString() + ' ' + now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' }),
            resetDate: resetDate.toLocaleDateString(),
            monthStart: monthStart.toLocaleDateString(),
            spent: amounts.spent,
            limit: amounts.limit,
            remaining: amounts.limit - amounts.spent,
            calendarDays: `Day ${currentCalendarDay} of ${totalCalendarDays}`,
            businessDays: `Business day ${currentBusinessDay} of ${totalBusinessDays}`,
            totalBusinessHours,
            rawElapsedBusinessHours,
            todayRemainingHours,
            elapsedBusinessHours,
            monthProgressPercent: monthProgressPercent.toFixed(2) + '%',
            remainingBusinessHours,
            budgetPerHour: '$' + budgetPerHour.toFixed(2) + '/hour',
            budgetPerBusinessDay: '$' + budgetPerBusinessDay.toFixed(2) + '/business day (10 hours)'
        });

        // Find the existing meter in the spend row
        const existingMeter = spendRow.querySelector('[data-cds="Meter"]');
        if (!existingMeter) return;

        // Find the percent label span (the one showing "25% used")
        const percentLabelSpan = spendRow.querySelector('span[class*="text-footnote"][class*="text-secondary"]');
        if (!percentLabelSpan) return;

        // Clone the entire spend row to create the month progress row
        const monthProgressRow = spendRow.cloneNode(true);
        monthProgressRow.setAttribute('data-usage-month-progress', 'month-bar');

        // Update the left side of the month progress row
        const monthLeftContent = monthProgressRow.querySelector('[class*="md:w-80"]');
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
            if (fillBar) {
                const innerDiv = fillBar.querySelector('div');
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

    // Start the script
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupObserver);
    } else {
        setupObserver();
    }
})();
