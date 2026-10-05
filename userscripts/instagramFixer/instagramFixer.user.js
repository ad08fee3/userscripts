// ==UserScript==
// @name         Instagram Reels: - Close Modal and Unmute
// @version      1.2
// @description  Makes instagram usable my auto-closing the naggy modals and unmuting reels
// @match        https://www.instagram.com/reel/*
// @match        https://www.instagram.com/*/reel/*
// @match        https://www.instagram.com/*/p/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/instagramFixer/instagramFixer.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/instagramFixer/instagramFixer.user.js
// @grant        none
// ==/UserScript==


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function findSvgTitle(text) {
    return [...document.querySelectorAll('svg title')]
        .find(t => t.textContent.trim() === text);
}

function clickBySvgTitle(titleText) {
    const title = findSvgTitle(titleText);

    if (!title) {
        return false;
    }
    // Find the nearest clickable ancestor.
    let element = title.parentElement;
    while (element && element !== document.body) {
        if (
            element.getAttribute("role") === "button" ||
            element.tagName === "BUTTON" ||
            element.tabIndex >= 0
        ) {
            element.click();
            return true;
        }
        element = element.parentElement;
    }

    return false;
}

let runId = 0;

async function processPage() {
    const myRun = ++runId;

    let closePresent = true;
    let audioMuted = true;

    let closeEverReturnedTrue = false;
    let muteEverReturnedTrue = false;

    let attempts = 0;
    const maxAttempts = 40;

    while (
        myRun === runId &&
        attempts < maxAttempts &&
        ((!closeEverReturnedTrue || !muteEverReturnedTrue) || closePresent || audioMuted)
    ) {
        attempts++;

        if (!closeEverReturnedTrue || closePresent) {
            closePresent = clickBySvgTitle("Close");
            if (closePresent) {
                closeEverReturnedTrue = true;
            }
        }

        if (!muteEverReturnedTrue || audioMuted) {
            audioMuted = clickBySvgTitle("Audio is muted") || !(findSvgTitle('Audio is playing'));
            if (audioMuted) {
                muteEverReturnedTrue = true;
            }
        }
        await sleep(100);
    }
}

/*
* Instagram frequently catches clicks on <a> elements and runs its own
* navigation/login logic instead of allowing the browser to perform the
* anchor's normal default action.
*
* Intercept clicks during CAPTURE, before Instagram's bubbling-phase
* handlers get them.
*
* IMPORTANT:
*   - We do NOT call preventDefault().
*   - Therefore the browser is still allowed to follow the <a href>.
*   - stopPropagation() prevents Instagram's ancestor handlers from
*     hijacking the click.
*/
function handleClick(event) {
    // Only deal with genuine mouse/pointer activation.
    if (event.type !== 'click') {
        return;
    }

    // Find the actual <a> element that was clicked.
    const link = event.target.closest('a[href]');

    if (!link) {
        return;
    }

    // Only handle links that belong to Instagram.
    // This avoids interfering with external links Instagram may
    // intentionally handle itself.
    const href = link.href;

    if (!href || !href.startsWith('https://www.instagram.com/')) {
        return;
    }

    /*
    * Do NOT call preventDefault().
    *
    * This is the key:
    *
    *     stopPropagation()
    *         = don't let Instagram's handlers see the click
    *
    *     preventDefault()
    *         = don't let the browser follow the link
    *
    * We want the first one, NOT the second one.
    */
    event.stopPropagation();
}

(function () {
    "use strict";

    /*
    * Capture phase = true.
    *
    * This gets the event while it is travelling DOWN toward the link,
    * before normal bubbling handlers installed by Instagram get a chance
    * to process it.
    */
    document.addEventListener('click', handleClick, true);

    processPage();

    let lastUrl = location.href;

    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            console.log("URL changed:", lastUrl);

            processPage();
        }
    }, 100);
})();