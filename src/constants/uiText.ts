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

    // Full Fetch Mode Warnings
    FULL_FETCH_WARNING_TITLE: 'Full Fetch Mode - Resource Intensive',
    FULL_FETCH_CONFIRM_MESSAGE:
        'Full fetch mode makes continuous API calls to retrieve ALL your liked videos. \n\nIf you have more than thousands of videos, this can:\n\n' +
        '• Consume significant memory (5-10KB per video)\n' +
        '• Use substantial API quota (~1 call per 50 videos)\n' +
        '• Drain battery and network resources\n\n' +
        'Recommended: Reduce the auto-fetch interval.\n\n' +
        'Enable full fetch mode?',
    FULL_FETCH_ENABLED_NOTICE: '⚠️ Full fetch mode enabled - this will fetch ALL videos on each auto-fetch',
    FULL_FETCH_STARTED_NOTICE: '⚠️ Full fetch started - this may take several minutes',
    FULL_FETCH_WARNING_DESC:
        '⚠️ WARNING: Fetches ALL liked videos instead of the fetch limit. ' +
        'Uses more API quota and resources but ensures you never miss new videos. ' +
        'Recommended only for infrequent auto-fetch (2+ hours).',
    FULL_FETCH_ACTIVE_INFO:
        '⚠️ Full Fetch Mode Active\n\n' +
        'Impact per fetch:\n' +
        '• Memory: ~5-10KB per video (~50MB for 5,000 videos)\n' +
        '• API Quota: ~1 call per 50 videos (100+ calls for 5,000 videos)\n' +
        '• Fetch Time: 5-30+ minutes for thousands of videos\n' +
        '• Battery/Network: Continuous pagination drains resources',
    FULL_FETCH_NOT_RECOMMEND_AUTO_VIDEO_NOTE_WARNING: 
        `Not Recommended to turn this on when 'Automatically create notes' option is enabled. `,
    FULL_FETCH_AGGRESSIVE_INTERVAL_WARNING: (interval: number) =>
        `⚠️ Aggressive interval detected (${interval} min). ` +
        'Full fetch should run every 2+ hours (360 min) to avoid overwhelming API/device.',
    FULL_FETCH_RECOMMENDATIONS:
        'Recommended Configuration:\n' +
        '• Auto-fetch Interval: 360+ minutes (2+ hours)\n' +
        '• Monitor Obsidian performance after enabling\n' +
        '• Not recommend to auto\n' +
        '• Consider limiting to 1-2 full fetches per day',

    // Content Type Filter
    CONTENT_TYPE_LABEL: 'Type:',
    CONTENT_TYPE_VIDEOS: 'Videos',
    CONTENT_TYPE_SHORTS: 'Shorts',
    CONTENT_TYPE_MUSIC: 'Music',

    // Tooltips
    TOOLTIP_VIDEOS: 'Regular videos (longer than 60 seconds, excludes music)',
    TOOLTIP_SHORTS: 'Videos shorter than 90 seconds (does not categorize YouTube Shorts)',
    TOOLTIP_MUSIC: 'Music videos (YouTube category: Music)',
} as const;