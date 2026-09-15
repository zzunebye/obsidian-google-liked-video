# Geulo Obsidian Plugin Design System

## 1. Atmosphere & Identity

Geulo follows Obsidian's native visual language: compact, theme-aware, and content-first. The signature is a quiet media browser whose controls feel like part of the host application rather than a separate web app.

## 2. Color

The plugin uses Obsidian theme tokens instead of owning light and dark palettes.

| Role | Token | Usage |
|---|---|---|
| Primary surface | `--background-primary` | Main views and playlist cards |
| Secondary surface | `--background-secondary` | Headers and grouped controls |
| Elevated surface | `--background-primary-alt` | Modals, forms, and loading cards |
| Hover surface | `--background-modifier-hover` | Interactive hover feedback |
| Active surface | `--background-modifier-active` | Pressed feedback |
| Border | `--background-modifier-border` | Cards, controls, and dividers |
| Primary text | `--text-normal` | Titles and body copy |
| Secondary text | `--text-muted` | Supporting copy |
| Tertiary text | `--text-faint` | Metadata |
| Accent | `--interactive-accent` | Selected and primary actions |
| Accent hover | `--interactive-accent-hover` | Hovered accent actions |
| Destructive | `--text-error` | Permanent deletion actions |

Raw colors already present in legacy media overlays remain accepted debt. New controls must use Obsidian tokens.

## 3. Typography

- View titles use the existing `Georgia, serif` header treatment at `1.25em` and weight 600.
- Controls and metadata inherit Obsidian's application font.
- Card titles use 16px/600; descriptions use 13px; metadata uses 12px.
- Destructive confirmation copy uses the existing confirmation modal scale: 16px body and 14px controls.

## 4. Spacing & Layout

Spacing follows the existing 4px rhythm: 4, 8, 12, 16, 20, 24, and 32px.

- View-header actions are a compact horizontal cluster with a 4px gap.
- The owned-playlist detail header uses a compact, icon-only delete control beside Refresh.
- Playlist cards preserve their existing layout; permanent deletion remains in their native context menu.
- The plugin inherits the containing Obsidian pane width; no viewport-specific layout is introduced for playlist deletion.

## 5. Components

### ViewHeader

- **Structure:** icon, title, optional badge, action cluster.
- **States:** action buttons support default, hover, focus, active, and disabled states through Obsidian button styles.
- **Accessibility:** every icon-only action has a title and ARIA label.
- **Layout:** horizontal cluster with 8px between the leading icon and title; actions never shrink.

### PlaylistCard

- **Structure:** thumbnail, title/description, metadata, pin control, and hover overlay.
- **States:** default, hover, focus-visible, active, and pinned.
- **Accessibility:** keyboard activation remains Enter/Space. Owned cards expose deletion through the native context-menu key and Shift+F10.
- **Layout:** existing responsive card grid.

### Destructive Action

- **Structure:** a `trash-2` icon-only button in the owned-playlist detail header; owned cards expose `Delete playlist` in their native context menu.
- **States:** default, hover, focus-visible, and confirmation pending.
- **Accessibility:** each button has an explicit accessible name; activation always hands off to the confirmation modal.
- **Motion:** short color transitions only; reduced-motion mode removes them.

### ConfirmationModal

- **Structure:** warning message, cancel action, destructive confirm action.
- **States:** open, cancel, confirm.
- **Accessibility:** explicit irreversible-action wording; no remember-choice option for permanent deletion.

### Pagination

- **Structure:** first and previous actions, an editable current-page field with the total page count, then next and last actions.
- **States:** resting, editing, committed, and range-corrected. Empty or non-integer input restores the current page; out-of-range integers move to the nearest valid page.
- **Accessibility:** icon-only actions and the page field expose explicit accessible names; the field supports Enter to commit and Escape to cancel.
- **Layout:** controls keep the existing centered, compact arrangement and use Obsidian form-control styling.

### VideoCommentsModal

- **Structure:** video context, a scope note for up to 30 relevance-ranked top-level comments, optional `Your activity` group, and the remaining `Most relevant` comments.
- **States:** loading, loaded, empty, recoverable error, identity-partial success, and per-comment collapsed or expanded text. The modal owns every request and display state.
- **Activity:** comments liked by the connected viewer and comments authored by the viewer receive compact accent badges. A comment matching both states renders once with both badges.
- **Accessibility:** the comment count is a labelled button, comment text is selectable, disclosure buttons expose their expanded state, errors announce through an alert, loading announces through a status, and closing restores focus without scrolling the underlying pane.
- **Layout:** a theme-token modal with its own vertical scroll. Opening and closing never resets the liked-video view, pagination, filters, summaries, or scroll position.

## 6. Motion & Interaction

### Transcript reading

- Liked videos, playlists, and subscriptions share a transcript workspace. The captions button and `Read transcript` card menu open the reader immediately with a loading state, then show the fetched captions. The button shows its text label when the card's details area is at least 380px wide and collapses to an icon on narrower cards, with a single short tooltip.
- At pane widths of at least 900px the list occupies 40% and the reader 60%. Narrower panes show the reader with a back button. The mounted list retains its filters, pagination, and scroll position; it is inert and hidden from assistive technology while covered.
- Readers offer `Paragraphs` (the default) and `Original timestamps`. Original mode shows one row per received caption segment, preserving its text, line breaks and source timing without grouping. Switching is local and does not fetch again. Search, copy and new-note output use the selected mode; copying still includes all rows even when searching. Moving to a new pane retains the mode, and standalone pane state restores it.
- An `AI` button to the left of `Paragraphs` opens the existing cached video summary, even without a configured API key. If absent, the existing AI provider generates and caches it after checking AI settings and any long-video confirmation. The reader keeps a loading skeleton until the full summary is ready, then shows expanded Markdown. Switching transcript modes does not restart generation; opening a new pane is disabled while it is pending. Transcript search/copy/save controls are hidden in AI mode, which has its own summary copy/regenerate controls and retry feedback.
- The `AI` mode button includes the same bot icon as video cards. The AI view allows text selection and adds no extra `AI Summary` heading above the generated content. A card's bot action jumps directly to that video's AI view in the shared reader (or a standalone pane outside a transcript workspace). The card's summary preview is selectable, read-only text with no expand control; it wraps and grows to fit narrow panes. Cards observe summary storage changes, including one-line completions from the reader. Opening a cached summary with no one-liner requests only the missing one-liner when AI and an API key are enabled.
- Caption fragments keep their original words and timing. Paragraphs prefer sentence endings after 12 seconds or 160 characters, or caption gaps of at least 2 seconds. The 30-second/500-character target does not force a split; after it, gaps of at least 0.75 seconds also qualify. Without a natural boundary, split at a cue boundary at or after 60 seconds or before adding a cue would exceed 800 characters. Individual cues are never split, so an oversized cue can exceed these limits. Processing is linear in cue count plus text length, joining buffered fragments only once per paragraph. Caption gaps are timing hints, not measured audio silence; punctuation-free continuous captions may still need fallback splits.
- Search filters paragraphs and highlights matches. `Copy all` always copies the complete transcript, with an optional timestamp format. `Save as note` uses `Channel Name - Video Title Transcript.md` in the configured video-note folder, starts the body with `# Transcript`, and opens an existing transcript note without overwriting it. Video IDs remain in source links, not note titles.
- `Video display → Transcript language` chooses the preferred caption language for newly opened readers, defaulting to Obsidian's language. Selection prefers an exact language, then its base language, then English, then the first available track; manual captions win within each match group.
- `Open transcript in new pane` transfers loaded captions to an independent Obsidian view. Workspace restoration retains the video identity and fetches captions again.
- On desktop WebViewer, an optional, capability-checked Electron bridge reads the matching video's position and seeks without reloading. Origin and video identity are checked before and inside each request; advertisements are excluded. Other environments retain timestamp URL navigation.
- Playback highlights the current paragraph with a subtle background only, without a left stripe. Manual scrolling or searching pauses automatic following; `Follow playback` resumes it. Closing a reader cancels its fetch and stops its playback polling.

### Liked-video browsing

- A labelled native View Mode select inside the Filter box switches Pagination / Infinite scroll; Pagination is the default and the preference is saved locally. It collapses together with the other filters.
- Pagination keeps ten cards per page. Infinite scroll uses measured virtual rows with three rows of overscan, the existing 500px minimum card width, and 16px gaps. Obsidian's view-content owns scrolling.
- Infinite scroll initially exposes 50 videos, adding another 50 when the current end is within 600px below the pane. Expansion uses local data without network calls or artificial loading delays; cards outside the viewport remain virtualized. A muted footer shows the exposed count until the actual end is reached.
- Mode, search, filter, and sort changes reset the exposed range to 50; resizing preserves it. Pending cards outside that range stay mounted invisibly without increasing the scrollable length.
- Mode, search, filter, and sort changes return to the beginning without animation. Resizing recomputes columns and measured heights.
- Expanded summaries retain their state by video ID. Cards with pending summary work remain mounted until that work settles, including while filtered out or switching modes.
- The list exposes its total size and card positions. Offscreen retained work is hidden from focus and accessibility. The mode select and end-of-list message use native form styling and muted text.

- Existing micro-interactions use 120-200ms easing for hover and press feedback.
- The detail delete button is always visible for owned playlists and uses a dark secondary surface with the destructive color token.
- Card deletion follows native context-menu interaction and does not add an inline card action.
- Destructive activation always opens confirmation before the API request.

## 7. Depth & Surface

The existing mixed strategy is preserved: Obsidian theme borders provide structure, while playlist cards and modals use subtle legacy shadows. This feature adds no new surface styling.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- All new icon-only buttons have accessible names.
- The detail delete button and card context-menu action are available by pointer and keyboard.
- Destructive intent is stated before execution, with Cancel as a separate action.
- The UI must not claim success until YouTube returns a successful response.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Legacy raw overlay colors and mixed font families | `styles.css` | Pre-existing and unrelated to playlist deletion | Consolidate during a dedicated visual-system cleanup |
| No automated UI test framework | Project-wide | The repository currently has no test runner; this change is validated by type-check/build and manual Obsidian QA | Add when the project adopts a test harness |
