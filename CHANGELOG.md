# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Localization via `extension/_locales/`. English is the default locale, German
  is a translation, and the browser picks one by system language. The popup text
  and the manifest description are resolved through the `i18n` API instead of
  being hardcoded German. The English wording stays inline in `popup.html` as a
  fallback, so a missing message degrades to English rather than to a blank
  label.

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [1.0.0] - 2026-07-20

### Added

- Four independent toggles in the popup — feed/timeline, ads, news & games rail,
  notification badges. Each one applies immediately in every open LinkedIn tab
  and is remembered in `storage.local`. The default is "everything hidden".
- Content script and stylesheet are injected at `document_start`, so hidden
  elements never paint.
- Selector sets for both DOM shells LinkedIn serves: the newer React shell (feed,
  profiles) and the classic Ember shell (messaging). Whichever is served, one set
  matches.
- JavaScript detection for elements without a stable CSS anchor: promoted posts
  (German and English label texts) and the right-rail news and daily-games
  modules, driven by a `MutationObserver` plus a `popstate` rescan.
- Debug logging on `linkedin.com` via `localStorage.setItem('lfDebug', '1')`,
  which reports what matched and why.
- `sync.sh`, which copies `extension/` into the generated Safari project's
  Resources directory so resource-only changes need no Xcode rebuild.
- A jsdom test harness (`npm test`) that drives the content script and the popup
  through a fake storage API, making both DOM-shell branches reachable without a
  browser.

### Fixed

- Skeleton posts in the React shell were permanently misclassified as organic
  because they were marked as checked before they had any text content.
- A recycled post container kept a stale "promoted" flag. The checked marker is
  now keyed on the post's identity (activity URN or mount id), so a changed
  identity forces a re-check.
- The news-module lookup could mark a page-level wrapper and hide far more than
  the intended card; it is now bound to the enclosing `aside`.
- Ad and news scans ran even when their toggle was switched off.
- Clearing or removing a key from `storage.local` flipped the toggle classes on
  every scan instead of restoring the default, because `classList.toggle()`
  ignores an `undefined` force argument. Stored values are now coerced against
  the defaults table.
- A toggle flipped while the initial storage read was still in flight was
  overwritten by the older snapshot, leaving the tab in the pre-toggle state
  until the next toggle or a reload.
- The popup could lose the first click: the change listener was attached before
  the stored state had been read, so the click was visually reverted by the stale
  snapshot.
- `sync.sh` picked the first of several `Resources/manifest.json` candidates. It
  now excludes build artifacts and fails on an ambiguous match instead of
  guessing.
- Removed a `history.pushState` patch that could never fire — content scripts run
  in an isolated world, so the page's own calls never reached the patched copy.
  SPA navigation is handled by the `MutationObserver` and `popstate`.

### Security

- The per-post "already checked" memo moved from a DOM data attribute into a
  `WeakMap` held in the isolated world. As an attribute it was both readable and
  writable by the page: LinkedIn could have pinned it so the scan was skipped and
  an ad stayed visible, or frozen a "promoted" flag onto an organic post.

[Unreleased]: https://github.com/jjarndt/linkedin-focus/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jjarndt/linkedin-focus/releases/tag/v1.0.0
