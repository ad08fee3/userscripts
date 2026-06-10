# githubAutoSso

[Install](https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubAutoSso/githubAutoSso.user.js)

Automatically handles GitHub's SSO re-authentication banner so you don't have to click through it manually. When the banner appears, the script opens each organization's SSO link in a background tab, completes the auth flow, and closes the tab automatically once it redirects back.

It works best alongside [this browser extension](https://chromewebstore.google.com/detail/github-sso-auto-auth/gdegknehnfdbnfjljblhleiheokebdla), which handles the auth handoff on the SSO provider side.
