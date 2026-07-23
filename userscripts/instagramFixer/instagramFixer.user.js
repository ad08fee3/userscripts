// ==UserScript==
// @name         Instagram Reels: - Close Modal and Unmute
// @version      1.1
// @description  Makes instagram usable my auto-closing the naggy modal and unmuting the reel
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

(function () {
    "use strict";

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