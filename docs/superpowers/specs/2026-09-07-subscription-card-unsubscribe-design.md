# Subscription Card Unsubscribe Design

## Goal

Add an `Unsubscribe channel` action to the context menu of video cards in the Subscription view. The action must require confirmation, unsubscribe the channel from the user's YouTube account, and immediately remove that channel and its cached videos from the current view.

## Scope

- Show the action only when `VideoCard` is rendered with `source="subscription"`.
- Place it after the existing Like or Unlike action.
- Keep Liked Videos and Playlist video-card menus unchanged.
- Reuse the existing subscription deletion, cache update, notice, and confirmation patterns in `SubscriptionView` and `SubscriptionService`.

## Component Design

`VideoCard` receives optional unsubscribe props rather than accessing `SubscriptionService` directly. When the source is `subscription` and the callback is available, its context menu adds `Unsubscribe channel`. A pending flag disables the action during an unsubscribe request to prevent duplicate submissions.

`SubscriptionView` resolves the video's `snippet.channelId` to the matching `SubscriptionChannel` in the active snapshot. It passes a callback that opens the confirmation modal for that single channel. This keeps account mutation and snapshot ownership in the view that already manages both.

## Confirmation and Data Flow

1. The user opens a Subscription video card's context menu and selects `Unsubscribe channel`.
2. A confirmation modal names the channel, explains that the YouTube subscription and cached videos will be removed, and shows the expected YouTube API quota.
3. Cancel closes the modal without changing state.
4. Confirm calls `subscriptionService.unsubscribeChannels([channel])`.
5. On success, `SubscriptionView` replaces its snapshot with the returned snapshot and clears any pending snapshot. Every cached video for the channel disappears immediately.
6. A success Notice confirms the channel was unsubscribed. A failed request preserves the channel and videos and displays the existing failure Notice.

The service already uses the stored subscription ID when available. If it is absent, it first looks up the subscription ID, so the quota estimate remains 50 units plus one lookup unit when required.

## Error and Edge Handling

- If the channel cannot be resolved from the active snapshot, do not show or execute an invalid unsubscribe request.
- Disable the menu action while an unsubscribe is active.
- Preserve the current snapshot on API failure.
- Do not change the existing failed-channel bulk-unsubscribe behavior.

## Verification

- Run ESLint on the changed TypeScript files.
- Run `npm run build` for strict TypeScript and production bundling.
- Run `git diff --check`.
- In the Obsidian Subscription view, verify that the action appears only on Subscription cards, Cancel is non-mutating, Confirm removes all videos for the channel, and failure leaves the cached content visible with a Notice.
