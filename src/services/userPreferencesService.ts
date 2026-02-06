/**
 * Service for managing user preferences stored in localStorage
 */
class UserPreferencesService {
    private readonly PREFERENCES_KEY = 'geulo-user-preferences';

    private defaultPreferences = {
        skipUnlikeConfirmation: false,
        skipLongVideoSummaryConfirmation: false,
    };

    /**
     * Get all user preferences
     */
    getPreferences() {
        try {
            const stored = localStorage.getItem(this.PREFERENCES_KEY);
            if (!stored) {
                return { ...this.defaultPreferences };
            }
            const parsed = JSON.parse(stored);
            return { ...this.defaultPreferences, ...parsed };
        } catch (error) {
            console.error('Failed to load user preferences:', error);
            return { ...this.defaultPreferences };
        }
    }

    /**
     * Update user preferences
     */
    setPreferences(preferences: Partial<typeof this.defaultPreferences>) {
        try {
            const current = this.getPreferences();
            const updated = { ...current, ...preferences };
            localStorage.setItem(this.PREFERENCES_KEY, JSON.stringify(updated));
        } catch (error) {
            console.error('Failed to save user preferences:', error);
        }
    }

    /**
     * Get specific preference value
     */
    getPreference<K extends keyof typeof this.defaultPreferences>(
        key: K
    ): typeof this.defaultPreferences[K] {
        const preferences = this.getPreferences();
        return preferences[key];
    }

    /**
     * Set specific preference value
     */
    setPreference<K extends keyof typeof this.defaultPreferences>(
        key: K,
        value: typeof this.defaultPreferences[K]
    ) {
        this.setPreferences({ [key]: value } as any);
    }

    /**
     * Check if user wants to skip unlike confirmation
     */
    shouldSkipUnlikeConfirmation(): boolean {
        return this.getPreference('skipUnlikeConfirmation');
    }

    /**
     * Set whether to skip unlike confirmation
     */
    setSkipUnlikeConfirmation(skip: boolean) {
        this.setPreference('skipUnlikeConfirmation', skip);
    }

    /**
     * Check if user wants to skip long video summary confirmation
     */
    shouldSkipLongVideoSummaryConfirmation(): boolean {
        return this.getPreference('skipLongVideoSummaryConfirmation');
    }

    /**
     * Set whether to skip long video summary confirmation
     */
    setSkipLongVideoSummaryConfirmation(skip: boolean) {
        this.setPreference('skipLongVideoSummaryConfirmation', skip);
    }

    /**
     * Reset all preferences to defaults
     */
    resetPreferences() {
        try {
            localStorage.removeItem(this.PREFERENCES_KEY);
        } catch (error) {
            console.error('Failed to reset user preferences:', error);
        }
    }
}

export const userPreferencesService = new UserPreferencesService();