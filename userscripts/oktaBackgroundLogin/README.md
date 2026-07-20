# oktaBackgroundLogin

[Install](https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/oktaBackgroundLogin/oktaBackgroundLogin.user.js)

Tricks Okta into completing its login flow even when the tab is in the background.

Okta checks page visibility and focus before proceeding, which causes the flow to stall in background tabs. This script spoofs `document.hidden`, `document.visibilityState`, and `document.hasFocus` so Okta believes the tab is active and visible throughout the auth flow. In effect, this makes Okta tabs proceed through the login flow while in the background.

This is handy if you open links in new tabs and want the page to load in the background.
