# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting for this repository (**Security → Report a vulnerability**), or contact the repository owner directly through GitHub. Include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected pages/versions if known.

You should receive an acknowledgement within a few days. We will coordinate a fix and disclosure timeline with you before anything goes public.

## Scope

Otaku Time is a static site: there is no backend, no accounts, no cookies and no server-side storage. The attack surface is therefore mostly:

- **Cross-site scripting via AniList content** — all API-derived strings pass through the `esc()` HTML-escaping helper before interpolation; image URLs are restricted to `https://s4.anilist.co/`.
- **Storage tampering** — localStorage contents are validated on read (versioned schemas). Corrupt or hostile payloads are rejected and never executed; the original file is left untouched.
- **Import of malicious backup files** — imports are JSON-only, size-capped (5 MB), schema-validated, and merged as data only. No HTML from imports is ever rendered unescaped.
- **Supply chain** — the shipped site has zero runtime dependencies. `package.json` exists for development and CI only (Playwright). Dependencies are pinned in the lockfile.

## Supported versions

Only the latest version on `main` receives fixes — this is a static site that deploys on every push.
