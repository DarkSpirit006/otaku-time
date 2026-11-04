## Summary

<!-- What does this change, in one or two sentences? -->

## Why

<!-- The problem it solves or the issue it closes. Use "Fixes #123" when applicable. -->

## How

<!-- Implementation notes a reviewer would want: approach, trade-offs, alternatives. -->

## Checklist

- [ ] `npm test` passes locally (unit tests)
- [ ] `npm run test:e2e` passes locally (Playwright)
- [ ] No absolute asset paths — everything loads from a repository subpath
- [ ] Local data formats are versioned and backward compatible (or migration included)
- [ ] No fabricated data, mock responses, or invented badges in the UI
- [ ] Accessibility basics preserved: keyboard access, focus states, labels
- [ ] User-facing changes are reflected in the docs (README, screenshots)
