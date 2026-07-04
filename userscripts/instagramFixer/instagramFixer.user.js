// ==UserScript==
// @name         Instagram Reels: - Close Modal and Unmute
// @version      1.0
// @description  Makes instagram usable my auto-closing the naggy modal and unmuting the reel
// @match        https://www.instagram.com/reel/*
// @match        https://www.instagram.com/*/reel/*
// @downloadURL  https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/instagramFixer/instagramFixer.user.js
// @updateURL    https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/instagramFixer/instagramFixer.user.js
// @grant        none
// ==/UserScript==


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function findSvgTitle(text) {
    return [...document.querySelectorAll('svg title')]
        .find(t => t.textContent.trim() === text);
}

function clickBySvgTitle(titleText, description) {
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
            break;
        }
        element = element.parentElement;
    }
    return true;
}

(async function () {
    'use strict';

    let closePresent = true;
    let audioMuted = true;

    let attempts = 0;
    const maxAttempts = 40;

    while ((closePresent || audioMuted) && attempts < maxAttempts) {
        attempts++;

        if (closePresent) {
            closePresent = clickBySvgTitle("Close", "close button");
        }
        if (audioMuted) {
            audioMuted = !clickBySvgTitle("Audio is muted", "mute button");
        }
        await sleep(100);
    }
})();