# githubDiffWhitespace

[Install](https://github.com/ad08fee3/userscripts/raw/refs/heads/main/userscripts/githubDiffWhitespace/githubDiffWhitespace.user.js)

"Compare" pages (like `/owner/repo/compare/abc123..def456`) don't remember your "show whitespace" preferences. This script adds `?w=1` to every `compare` link found on a GitHub page so they open with whitespace hidden by default.

Links that already have a `w` param (including `w=0`) are left alone, so you can still opt back in to seeing whitespace.
