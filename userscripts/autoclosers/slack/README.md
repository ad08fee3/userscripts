# autoCloseSlack

[Install](https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/autoCloseSlack/autoCloseSlack.user.js)

Automatically closes Slack redirect pages once the app launches.

When you click a Slack link, your browser opens a redirect page (e.g. `https://*.slack.com/archives/...` or `https://*.slack.com/app_redirect?...`) before handing off to the Slack desktop app. This script overlays a countdown and closes the tab once it reaches zero.

This was inspired by https://github.com/ronnie/redirect-page-auto-closer-for-slack
