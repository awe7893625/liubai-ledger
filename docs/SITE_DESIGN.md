# Ledger public website v1.1

## Design source

Aligned to the owner's NexPilot notebook design tokens, inspected 2026-09-21:
- Canvas #F3EFE6; elevated #FBF8F1; paper #FDFCF8; secondary #F2EDE2.
- Ink #211E19 / #5B544A; hairline #E4DDCE; strong line #D3C9B6.
- Accent #D0713F; accessible amber ink / primary #A8551F; indigo #4D63D6.
- Optional manual dark theme: #15161A / #1E1F25, text #ECE7DC, accent #E08862.
- Default is always the notebook light theme; OS dark mode alone does not override it.
- UI font: system-first Inter / SF Pro fallback; no font downloads or third-party tracking.

## Contents

A real React landing site, not a flattened generated image. Includes local interactive demo, three actual App screenshots from a disposable synthetic database, downloadable signed Shortcuts, deployment instructions, validated URL builder, four-step interactive iPhone setup illustration, JSON example, privacy boundaries, FAQ, GitHub Star links.

Screenshot captions distinguish actual App renders from the website's interactive display and schematic iOS tutorial. No screenshot is claimed to be a live bank transaction.

## Sources

- Apple transaction triggers: https://support.apple.com/zh-tw/guide/shortcuts/apd65c67538a/ios
- Apple sharing: https://support.apple.com/zh-tw/guide/shortcuts/apdf01f8c054/ios
- macOS sharing/signing: https://support.apple.com/guide/shortcuts-mac/share-shortcuts-apdf01f8c054/mac
- Tailscale Serve: https://tailscale.com/kb/1242/tailscale-serve

## Safety

The public website never sends transactions or tokens to the author's infrastructure. The URL builder operates in memory and only opens the explicitly chosen HTTPS health URL after a click. The public UI does not accept tokens. Installation templates use example.invalid and a placeholder token. Signed artifacts are checked against a manifest. Self-hosted deployment still requires private-network protection or an independent authentication gateway: the ingest token is not a general API login.
