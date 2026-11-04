# Contributing to Otaku Time

Thanks for helping out. This project stays small on purpose — the guidelines below keep it that way.

## Ground rules

1. **Local-first, always.** No accounts, servers, databases or telemetry. Data is written to `localStorage`/IndexedDB in the user's browser and nowhere else.
2. **Vanilla only.** Plain HTML, CSS and ES modules. No frameworks, no bundlers, no CSS preprocessors without a demonstrated need that we couldn't solve in vanilla.
3. **Exactly three primary sections**: Upcoming, Watchlist, Recently aired. Search, detail and settings are supporting surfaces, not new sections.
4. **No fabricated data.** Never ship mock schedule responses, invented scores, fake badges or placeholder anime into the app. Tests may (and should) mock the API — the product must not.
5. **Preserve user data.** Storage formats are versioned. Changing a stored shape requires a migration that reads the old format, and corrupt user files are never overwritten.

## Development

```bash
npm ci
npm run serve        # http://localhost:8080
```

There is no build step — edit files, reload the browser.

### Code style

- ES modules, named exports, `const`/`let` only — no implicit globals.
- Functions stay focused; shared logic lives in `js/utils/` or `js/services/`, feature code in `js/features/<section>/`.
- HTML is built with template strings through the `esc()` helper — never interpolate unescaped API data.
- CSS follows the token system in `css/variables.css`. Use design tokens (`var(--sp-4)`, `var(--text-sm)`, …) instead of hard-coded values, and add new tokens rather than one-off values.
- Every animation must be gated behind `prefers-reduced-motion` (the global kill switch in `base.css` covers most cases).
- Keep asset references **relative** (`./css/…`, `./js/…`) so the site works from a GitHub Pages repository subpath.

### Before you open a PR

```bash
npm test           # unit tests (node:test)
npm run test:e2e   # Playwright suite
```

Both must pass. The PR template lists the full checklist.

### Tests

- Unit tests: `tests/unit/*.test.js`, plain `node:test` + `node:assert`, zero dependencies. Pure logic (formatting, time, ranking, normalization, client, storage) belongs here.
- E2E tests: `tests/e2e/*.spec.js`. Intercept `graphql.anilist.co` with the helpers in `tests/e2e/helpers.js`; don't hit the real API in tests.
- When you fix a bug, add a regression test that fails without the fix.

## Reporting bugs

Use the bug report template and include console output. Never attach exported watchlist files — they contain your data.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities privately.
