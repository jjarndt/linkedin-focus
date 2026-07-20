# LinkedIn Focus

A Safari Web Extension (macOS) that hides distracting LinkedIn elements — the
feed, promoted posts, the news/games rail, and notification badges — so you can
use messaging and profiles without the pull of the timeline. Everything is
controlled by four independent toggles in the popup, and the default is
"everything hidden" (focus mode).

[![CI](https://github.com/jjarndt/linkedin-focus/actions/workflows/ci.yml/badge.svg)](https://github.com/jjarndt/linkedin-focus/actions/workflows/ci.yml)

> Not affiliated with, endorsed by, or connected to LinkedIn or Microsoft. See
> the [disclaimer](#disclaimer) below.

<!--
There is no demo GIF yet. A short recording of the popup toggles taking effect
on a LinkedIn tab belongs here, above the Features section — "does this
interest me" is decided before "do I install this".
-->

## Features

Four independent toggles, each applied instantly across all open tabs (no reload)
and persisted in `storage.local`:

- **Feed / Timeline** — hides the center column on the feed route, the composer
  included. Profiles and messaging stay untouched.
- **Ads** — promoted posts (detected in JavaScript by their label text, German
  and English) plus sidebar advertisements.
- **News & Games** — the "LinkedIn News" module and the daily-games box in the
  right sidebar.
- **Notification badges** — the red counters in the top navigation. The nav
  itself stays fully clickable.

## Scope

LinkedIn Focus does exactly one thing: it hides four groups of LinkedIn UI
elements in Safari on macOS, switched by four toggles.

Anything that serves that sentence is welcome. Everything else is listed below.

## Non-Goals

These are things LinkedIn Focus deliberately does not do. They are not open
TODOs, they are decisions — proposals for them are closed without further
discussion.

- **No Chrome or Firefox build.** The shipped artifact is a Safari app
  extension. The build step is Apple's `safari-web-extension-converter` invoked
  with `--macos-only`, and `sync.sh` only knows how to find the Resources
  directory inside the generated Xcode project. The sources use plain
  WebExtension APIs (`globalThis.browser ?? globalThis.chrome`) and may well
  load elsewhere, but nothing here is built, signed, or verified against another
  browser.
- **No user-configurable selectors.** Every selector is a constant in
  `extension/content.js` and `extension/styles.css`. `storage.local` holds
  exactly the four booleans declared in `extension/shared.js` and nothing else;
  taking selectors from storage would mean executing user-supplied queries and
  CSS against LinkedIn pages. Beyond that, every option doubles the number of
  states that have to be tested and documented.
- **No network access and no telemetry.** The manifest requests the single
  permission `storage`, declares no `host_permissions` and no background script,
  and the code contains no `fetch`, `XMLHttpRequest`, or `sendBeacon`. Nothing
  leaves the browser, so there is nothing to opt out of.
- **No features beyond the four toggles.** The feature table in `shared.js` and
  the class map in `content.js` have exactly four entries, and each one maps to
  a single class on `<html>`. Keyword muting, per-author filters, usage timers,
  or schedules would need state and UI that this design does not have.
- **No App Store distribution.** Signing is local free provisioning with a
  Personal Team, as described under [Signing & running](#signing--running).
  Store distribution needs a paid membership and a review process; building it
  yourself from source is the intended path.

If one of these boundaries is in the way of a concrete use case, a fork is the
right way forward. The license explicitly allows it.

## Quickstart

macOS with Safari and Xcode installed. From nothing to a generated Safari
project:

```sh
git clone https://github.com/jjarndt/linkedin-focus.git
cd linkedin-focus

xcrun safari-web-extension-converter extension \
  --project-location SafariProject \
  --app-name "LinkedIn Focus" \
  --bundle-identifier com.example.linkedinfocus \
  --macos-only --no-open --copy-resources
```

Pick your own reverse-DNS bundle identifier instead of `com.example.*`. This
writes the `SafariProject/` Xcode project (gitignored) from the contents of
`extension/`.

The remaining steps happen in Xcode and Safari and are described under
[Signing & running](#signing--running): select your Personal Team on both
targets, `Cmd-R`, then enable the extension in Safari's settings and allow it on
`linkedin.com`.

## How it works

- **Manifest V3, no background script.** The popup writes to `storage.local`; the
  content script listens on `storage.onChanged` and toggles `lf-*` classes on the
  `<html>` element. `styles.css` does the actual hiding.
- **No feed flash.** The content script and stylesheet are injected at
  `document_start`, so hidden elements never paint.
- **JS-flagged elements.** Where LinkedIn offers no stable CSS anchor, promoted
  posts and right-rail modules are detected in JavaScript (a `MutationObserver`
  plus a `popstate` rescan; SPA navigations are picked up via the DOM swap they
  cause) and flagged with `.lf-ad` / `.lf-news`.
- **Two DOM shells.** LinkedIn serves either a newer React shell (feed, profiles)
  or a classic Ember shell (messaging). Both selector sets are kept, so whichever
  is served, one of them matches.

Only the `storage` permission and access to `*.linkedin.com` are requested. No
network calls, no data collection, no tracking.

### Debug logging

If a selector drifts and something stops being hidden, enable match logging on
`linkedin.com`:

```js
localStorage.setItem('lfDebug', '1');
```

Then watch the console for `[LinkedIn Focus]` messages explaining what matched
and why.

## Project layout

```
extension/            # the extension source (a plain WebExtension)
  manifest.json
  _locales/en | de    # UI strings; en is the default locale
  shared.js           # feature table (defaults), loaded by content script + popup
  content.js
  styles.css
  popup/popup.html | popup.css | popup.js
  icons/icon-48 | 128 | 512.png
SafariProject/        # generated by the converter (gitignored)
sync.sh               # rsync extension/ -> SafariProject Resources
```

## Requirements

- macOS with Safari
- Xcode (from the App Store)
- A free Apple ID for local code signing (no paid developer account needed)

## Build

The same command as in the [Quickstart](#quickstart), with its context: it wraps
the WebExtension in a Safari app container using Apple's converter. Pick your own
reverse-DNS bundle identifier:

```sh
xcrun safari-web-extension-converter extension \
  --project-location SafariProject \
  --app-name "LinkedIn Focus" \
  --bundle-identifier com.example.linkedinfocus \
  --macos-only --no-open --copy-resources
```

This creates the `SafariProject/` Xcode project (gitignored) from the contents of
`extension/`.

## Signing & running

1. Open `SafariProject` in Xcode.
2. For **both** targets — the app **and** the extension — go to
   **Signing & Capabilities**, enable **Automatically manage signing**, and
   select your **Personal Team** (your free Apple ID).
3. **Build & Run** (`Cmd-R`). The container app launches.
4. In Safari, open **Settings → Extensions**, enable **LinkedIn Focus**, and
   allow it on `linkedin.com` (choose **Always Allow**).

Free provisioning keeps the extension active across Safari restarts, but the
signature expires periodically. If the extension disappears, re-run `Cmd-R` in
Xcode to re-sign it.

## Usage

Click the toolbar icon to open the popup and flip any of the four toggles. **On =
hidden (focus).** Changes take effect immediately in every open LinkedIn tab and
are remembered.

## Iterating on the extension

`extension/` is the source of truth. After editing files there, sync them into
the generated Safari project's Resources directory:

```sh
./sync.sh
```

Then reload the extension in Safari — no full Xcode rebuild is needed for
resource-only changes.

## Disclaimer

This is an independent, unofficial project. It is **not** affiliated with,
endorsed by, sponsored by, or connected to LinkedIn or Microsoft in any way.
"LinkedIn" is a trademark of Microsoft Corporation. The extension only restyles
pages locally in your own browser; it does not modify, access, or transmit any
account data. Use it at your own discretion — LinkedIn's DOM can change at any
time and break the selectors.

## License

MIT — see [LICENSE](LICENSE).
