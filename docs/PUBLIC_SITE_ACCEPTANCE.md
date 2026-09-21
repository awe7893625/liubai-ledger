# Public website acceptance — v1.1

Verified on 2026-09-21. This report covers the NexPilot-style Ledger public website and its added self-hosting entry.

| Gate | Result |
|---|---|
| Backend | 73 tests passed, including same-origin routes and environment-only AI credentials |
| Frontend lint | Passed |
| Public production build | Passed |
| Self-hosted production build | Passed |
| npm audit | 0 reported vulnerabilities at time of check |
| Browser widths | 320, 375, 390, 430, 768, 1440 px |
| Themes | Default cream even with OS dark; explicit dark toggle works |
| Layout | No document-level horizontal overflow in tested sections |
| Interactive demo | Synthetic add/reset works; no bank or backend request |
| Screenshot gallery | Three actual App screenshots; synthetic database; dialog open/Escape works |
| iPhone tutorial | All four steps can be selected |
| URL builder | Rejects HTTP, userinfo, query credentials and localhost; HTTPS endpoint copy works |
| Signed downloads | Both signed files served and matched SHA-256 manifest |
| Star buttons | Point to the public GitHub repository |
| Public API boundary | Public site has no transaction backend; /api must not serve the documentation HTML |
| External requests | No external or API requests observed during local browser interactions (external links not followed) |

The screenshot assets in frontend/public/screens/site-desktop.webp and site-mobile.webp are browser renders, not an AI image mockup.

## Reproduce

Build the public frontend with VITE_PUBLIC_DOCS=1 and the VITE_GITHUB_URL pointing to this repository, then run scripts/check_public_site.py in an environment with Playwright, Pillow and Chrome. Backend tests use isolated synthetic data. scripts/capture_public_screens.py constructs a separate disposable demonstration database and cleans it up.

## Explicit limits

The downloaded Shortcuts passed static property-list/action-reference validation and macOS anyone-mode signing. This is not a claim that a physical iPhone import, permission prompt, locked-device run, or real Apple Pay tap has been tested. Those checks must be completed on the target iPhone. Apple Watch, online Apple Pay and bank synchronization are not guaranteed.

The ingest token protects only /api/wallet, not all account/history/export endpoints. A private network or independent gateway remains required for safe deployment.

Dependency audit means no issues reported by that audit at this time, not a guarantee of absence of security defects.
