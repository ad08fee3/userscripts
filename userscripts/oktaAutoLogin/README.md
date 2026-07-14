# oktaAutoLogin

[Install](https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/oktaAutoLogin/oktaAutoLogin.user.js)

Automatically click "Next" on the Okta login form if your username is pre-filled.

When the Okta login page (matching `https://*.okta.com/oauth2/v1/authorize`) loads:

1. Checks if the username field exists and contains a value
2. If it does, ensures the "Remember me" checkbox is checked
3. Clicks the "Next" button to submit the form

This is useful if you have to log into Okta frequently, when the browser has saved your Okta credentials and you want to automatically proceed through the first step of the login flow.
