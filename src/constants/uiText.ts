export const UI_TEXT = {
    // Header
    HEADER_TITLE: 'My Liked videos',
    HEADER_TITLE_USER_PLAYLISTS: 'My Playlists',

    // Buttons
    BTN_REFRESH: 'Refresh',
    BTN_SETTINGS: 'Settings',
    BTN_TOGGLE_SORT_ORDER: 'Toggle sort order',
    BTN_FETCH_ALL: 'Fetch all liked videos',

    // Sort options
    SORT_LABEL: 'Sort by:',
    SORT_BY_LIKED_ORDER: 'Liked Order',
    SORT_BY_VIEW_COUNT: 'View Count',
    SORT_BY_LIKE_COUNT: 'Like Count',
    SORT_BY_COMMENT_COUNT: 'Comment Count',
    SORT_BY_LIKE_VIEW_RATIO: 'Like/View Ratio',
    SORT_BY_PUBLISHED_DATE: 'Published Date',
    SORT_BY_TITLE: 'Title',
    SORT_BY_DURATION: 'Duration',

    // Aria labels
    ARIA_SORT_VIDEOS: 'Sort videos',
    ARIA_TOGGLE_SORT_ORDER: 'Toggle sort order',

    // Video count
    VIDEO_COUNT: (count: number) => `${count} videos`,
    VIDEO_COUNT_WITH_TOTAL: (current: number, total: number) =>
        current === total ? `${current} videos` : `${current} videos (of ${total})`,

    // Empty state
    NO_VIDEOS_FOUND: 'No videos found',

    // Notifications
    NOTICE_NEW_VIDEOS_FETCHED: (count: number) => `Geulo: New liked videos from Youtube are fetched and added - ${count} new videos.`,
    NOTICE_TOTAL_VIDEOS: (count: number) => `Geulo: ${count} videos in total`,
    NOTICE_ALL_VIDEOS_SAVED: (count: number) => `Geulo: All liked videos have been fetched and saved to LocalStorage - ${count} videos`,

    // Error
    ERROR_TITLE: 'error',
    ERROR_MESSAGE: (error: any) => `error: ${error}`,
} as const;