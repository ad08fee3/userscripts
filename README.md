# Userscripts

Handy userscripts that I want to keep track of. They generally fix tiny quality-of-life issues or annoyances.

Eventually this will include scripts I pull in from other places that I want to back up or keep version-controlled, but for now these are all homemade.

## Scripts

| Script | Description |
| --- | --- |
| [githubAutoSso](userscripts/githubAutoSso/README.md) | Automatically completes GitHub's SSO re-auth banner in a background tab and closes it when done. |
| [githubFileTreeColors](userscripts/githubFileTreeColors/README.md) | Colors the PR sidebar file tree to reflect each file's collapsed and viewed state at a glance. |
| [githubCollapsibleHeaderBars](userscripts/githubCollapsibleHeaderBars/README.md) | Allows you to click anywhere on a file header to collapse its content. Expands upon the functionality added by Refined GitHub. |
| [githubCollapseJunk](userscripts/githubCollapseJunk/README.md) | Automatically collapses low-value "junk" files (tests, lock files, binaries, generated code, etc) on GitHub PR diff pages. |
| [githubDiffWhitespace](userscripts/githubDiffWhitespace/README.md) | Hides whitespace changes in GitHub diffs by default, while still letting you opt back in. |
| [githubWideInlineComments](userscripts/githubWideInlineComments/README.md) | Widens inline PR review comments so threads use more of the available space. |
| [instagramFixer](userscripts/instagramFixer/README.md) | Closes the stupid "pLeAsE lOg iN" modal and unmutes Instagram reels automatically. |
| [oktaAutoLogin](userscripts/oktaAutoLogin/README.md) | Automatically submits the Okta login form if your username is pre-filled. Reduces a few clicks from the  login process. |
| [oktaBackgroundLogin](userscripts/oktaBackgroundLogin/README.md) | Allows Okta login to proceed in background tabs, instead of waiting for the tab to focus. |

## Auto-Closers

These scripts automatically close redirect/launch pages that get left behind when you launch an app by clicking on a link, like Zoom or Slack.

- [AWS SSO](userscripts/autoclosers/awsSso/README.md) - Closes the AWS SSO tab after logging in.
- [Slack](userscripts/autoclosers/slack/README.md) - Closes Slack redirect pages once the app launches.
- [Zoom](userscripts/autoclosers/zoom/README.md) - Closes Zoom meeting launch tabs once the app launches.

## Deprecated

This repo still contains some older scripts that have been superseded by other scripts/extensions. See the [Deprecated README](userscripts/deprecated/README.md) for the full list.
