export const UI_TEXT = {
    // Header
    HEADER_TITLE: 'My Liked videos',
    
    // Buttons
    BTN_REFRESH: 'Refresh',
    BTN_SETTINGS: 'Settings',
    BTN_TOGGLE_SORT_ORDER: 'Toggle sort order',
    BTN_FETCH_ALL: 'Fetch all liked videos',
    
    // Sort options
    SORT_LABEL: 'Sort by:',
    SORT_BY_LIKED_ORDER: 'By Liked Order',
    SORT_BY_VIEW_COUNT: 'By View Count',
    SORT_BY_LIKE_COUNT: 'By Like Count',
    SORT_BY_LIKE_VIEW_RATIO: 'By Like/View Ratio',
    SORT_BY_PUBLISHED_DATE: 'By Published Date',
    SORT_BY_TITLE: 'By Title',
    
    // Aria labels
    ARIA_SORT_VIDEOS: 'Sort videos',
    ARIA_TOGGLE_SORT_ORDER: 'Toggle sort order',
    
    // Video count
    VIDEO_COUNT: (count: number) => `${count} videos`,
    
    // Empty state
    NO_VIDEOS_FOUND: 'No videos found',
    
    // Notifications
    NOTICE_NEW_VIDEOS_FETCHED: (count: number) => `New liked videos from Youtube are fetched and added - ${count} new videos.`,
    NOTICE_TOTAL_VIDEOS: (count: number) => `${count} videos in total`,
    NOTICE_ALL_VIDEOS_SAVED: (count: number) => `All liked videos have been fetched and saved to LocalStorage - ${count} videos`,
    
    // Error
    ERROR_TITLE: 'error',
    ERROR_MESSAGE: (error: any) => `error: ${error}`,
    
    // Pagination
    PAGE_FIRST: '<--',
    PAGE_PREV: '<-',
    PAGE_NEXT: '->',
    PAGE_LAST: '-->',
    
    // Sort order icons
    SORT_ASC: '🔼',
    SORT_DESC: '🔽',
} as const;