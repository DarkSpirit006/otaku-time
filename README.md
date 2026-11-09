# Otaku Time

Otaku Time is a local-first anime airing schedule and personal watchlist. Browse upcoming and recently aired episodes, search AniList, and keep track of what you have watched. No account is required.

## Get started

You need [Node.js](https://nodejs.org/) 20.19+ or 22.12+ and npm. Node 22 is a good choice.

```bash
git clone https://github.com/DarkSpirit006/otaku-time.git
cd otaku-time
npm ci
npm run dev
```

Open the local URL printed in the terminal (usually <http://localhost:5173/>). Press `Ctrl+C` in the terminal to stop the server. An internet connection is needed for AniList data.

```bash
npm run typecheck   # Check TypeScript
npm run build       # Create the production site in dist/
npm run preview     # Serve the production build locally
```

The build inlines application JavaScript and CSS into HTML, but the manifest, icons and service worker are separate files. **Publish the entire `dist/` folder**, not just `index.html`.

## Using the app

- **Upcoming** shows the next broadcast and the loaded schedule. Filter by format or saved shows, and load more episodes as needed.
- **Search** finds anime by title; select a result for details or add it to your watchlist. Results and availability come from AniList.
- **Watchlist** stores each title's progress and personal status: Watching, Planned, Paused, Completed or Dropped. Use the plus and minus buttons to change progress and the status selector to change status. The plus button is capped at the known aired episode count when there is reliable schedule evidence, or at the total if known; unavailable data may limit accuracy. Existing progress is not discarded if schedule data changes.
- **Recently aired** lists episodes in the loaded recent window. Both schedules refresh when the app is visible and data becomes stale. Search and schedules require a connection; the offline app shell does not cache AniList results.
- **Settings** offers dark/light themes, installation, watchlist notifications, calendar export, JSON backup/import and clear-all. Import **replaces** the current watchlist and asks for confirmation if it contains shows; export a backup first. Clear-all also requires confirmation. Existing watchlist exports and the existing local-storage key remain supported.
- **On phones**, swipe between sections; swipe down on the settings or details sheet handle, or from the top of its content, to close it. Filter strips scroll horizontally. Each section retains its own scroll position.

### Saving and backups

Your watchlist, theme and notification preferences are stored in this browser on this device, not in an AniList account. They do not automatically sync to other devices. Browser data clearing, private browsing, storage restrictions or a different origin can remove or isolate them. Export the watchlist JSON regularly via Settings, especially before changing browsers or clearing site data. Notification preferences are not part of that export. Invalid stored watchlist data is backed up to `otaku-time.watchlist.backup` (or a timestamped backup key if one already exists) when storage permits; recovery may require browser developer tools.

### Notifications and calendar

In Settings, enable **Watchlist reminders**, grant permission, choose a lead time and select the shows to notify. Newly saved shows are selected by default. Reminders are checked **while the app is open**; background tabs can be delayed, and reminders cannot be scheduled for a completely closed app. They depend on available, current airing data and browser/device permission. On supported iOS versions, notification permission requires the installed Home Screen app. Calendar export creates a snapshot of known next airings with a 15-minute alert; import it into a calendar app to manage reminders separately, and export again when schedules change.

### Install

Open Settings → **Install Otaku Time**, use the command palette, or share <https://darkspirit006.github.io/otaku-time/?install=1>. A supported browser may provide a native install button; the prompt is only opened by your action. Otherwise, follow the device-specific instructions in the sheet. On iOS/iPadOS, use Safari's Share menu → **Add to Home Screen**. Some browsers offer only a shortcut, and an installation in another browser or a normal tab may not be detectable. Installation generally requires HTTPS and browser support; service worker registration is enabled in production, not development.

The install link preserves other query parameters and the hash. Closing the sheet removes the `install` parameter. Section links use hashes such as `#watchlist` and show details use `#show/123`.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Open search |
| `Ctrl+K` or `⌘K` | Open command palette |
| `?` | Show shortcuts |
| `g`, then `u`, `w`, or `r` | Upcoming, Watchlist, Recently aired |
| `Esc` | Close the current dialog |

## GitHub Pages deployment

1. Push the project to a GitHub repository and choose **Settings → Pages → Build and deployment → Source → GitHub Actions**.
2. The included workflow runs on pushes to `master` or `main`, or manually via Actions. It installs locked dependencies, type-checks, builds with `BASE_PATH=/<repository>/` and publishes all of `dist/`.
3. For this repository, the project URL is <https://darkspirit006.github.io/otaku-time/>. For a fork, replace the owner and repository name.

To build a project-path deployment locally:

```bash
BASE_PATH=/otaku-time/ npm run build
```

The base must begin and end with `/`. Use `/` for a root-domain site. The workflow assumes a **project** site path; adjust `BASE_PATH` in the workflow for a root user/organization site or a custom domain. Vite's preview server is useful for the root build but may fall back to HTML for service-worker URLs under a project path; the production PWA test uses a static server that serves the built folder under `/otaku-time/` instead. The dev/preview host allowlist is open for tunnel and sandbox use; do not expose those servers to untrusted networks without restricting it.

The service worker caches the app shell for offline launch and updates it network-first. Anime data, artwork and externally hosted fonts may be unavailable offline. Installing or updating requires the manifest, icons and service worker to be served from the same deployment path.

## Checks

```bash
npm ci
npx playwright install chromium       # first time; Linux may also need: npx playwright install-deps chromium
npm run typecheck
npm run build
npm run test:app
npm run test:gestures
npm run test:pwa
BASE_PATH=/otaku-time/ npm run build
npm run test:pwa:production
```

The app and gesture tests use headless Chromium and mocked AniList responses; the PWA install test mocks browser install events. The production test uses the actual built project path, manifest, service worker, Chromium installability checks and offline shell. These tests do not prove real OS installation, device notification delivery, screen-reader behavior or touch performance on physical Android/iOS devices. There is no separate lint script configured; TypeScript strict checks run via `typecheck`.

## Project structure

```text
src/App.tsx                    Section and hash navigation, providers and dialogs
src/views/                     Upcoming, Watchlist and Recently aired screens
src/components/                Cards, sheets, navigation, pager and shared UI
src/lib/api.ts                 AniList GraphQL client
src/lib/store.tsx              Local watchlist, toasts and shared clock
src/lib/schedule-store.tsx     Shared schedule fetching and refresh
src/lib/notifications.tsx      Opt-in local reminders
src/lib/ics.ts                 Calendar and JSON exports
src/lib/usePwaInstall.ts       Browser installation flow
src/index.css                  Theme tokens, layout and shared styles
public/                        PWA manifest, service worker and icons
tests/                         Playwright browser checks
.github/workflows/deploy.yml   GitHub Pages build and deployment
```

## Troubleshooting

- **No schedule or search results:** check your connection and try again. AniList may be unavailable or rate-limiting requests. A search error is different from a successful search with no matches.
- **Watchlist not persisting:** check browser storage permissions and free space, avoid private mode, and export a JSON backup before closing the page if a storage warning appears.
- **No install button:** use a supported browser over HTTPS and follow the manual instructions in the installation sheet. A browser controls whether it offers a native prompt. Deploy every file in `dist/`.
- **No notification:** verify the app is open, the show is selected, permissions are enabled in both browser and device, and its airing time is current. Test the notification from Settings. Closed-app scheduled notifications are not supported.
- **Changes not visible after deployment:** check that the workflow succeeded and the whole updated `dist/` was published. Reload with a network connection so the service worker can receive the new shell.

For a bug, [open an issue](https://github.com/DarkSpirit006/otaku-time/issues) with steps to reproduce, expected and actual behavior, browser/device/version and relevant screenshots or console errors. Do not include private watchlist exports unless you intend to share them.

## License and attribution

Copyright DarkSpirit006. The project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE); see also [NOTICE](NOTICE). The license permits use for the permitted noncommercial purposes it defines, as well as the other uses it expressly permits. Use outside those permissions requires separate permission from the copyright holder; contact DarkSpirit006 through the repository. Read the license for the complete terms.

Anime metadata and schedules are provided by [AniList](https://anilist.co/) via its public GraphQL API. Anime titles, artwork, links and other content belong to their respective owners and are not licensed by this project's license. API requests and externally hosted images and fonts are sent to their respective providers; local watchlist storage does not make those requests private from those providers.

The project uses React, Vite, Tailwind CSS, Framer Motion, Lucide, Playwright and other dependencies under their own licenses; see their package license files and `package-lock.json`. Fonts from Google Fonts (Syne, Inter and IBM Plex Mono) have their own licenses. Third-party terms remain applicable.
