/**
 * Service for managing vault-scoped user preferences
 */
import { vaultLocalStorageService } from './vaultLocalStorageService';
import { debugLogger } from '../debug';

type UserPreferences = {
    skipUnlikeConfirmation: boolean;
    skipLongVideoSummaryConfirmation: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

class UserPreferencesService {
    private readonly PREFERENCES_KEY = 'geulo-user-preferences';

    private defaultPreferences: UserPreferences = {
        skipUnlikeConfirmation: false,
        skipLongVideoSummaryConfirmation: false,
    };

    /**
     * Get all user preferences
     */
    getPreferences(): UserPreferences {
        try {
            const stored = vaultLocalStorageService.load(this.PREFERENCES_KEY);
            if (!isRecord(stored)) {
                return { ...this.defaultPreferences };
            }
            return {
                skipUnlikeConfirmation: typeof stored.skipUnlikeConfirmation === 'boolean'
                    ? stored.skipUnlikeConfirmation
                    : this.defaultPreferences.skipUnlikeConfirmation,
                skipLongVideoSummaryConfirmation: typeof stored.skipLongVideoSummaryConfirmation === 'boolean'
                    ? stored.skipLongVideoSummaryConfirmation
                    : this.defaultPreferences.skipLongVideoSummaryConfirmation,
            };
        } catch (error) {
            debugLogger.error('Failed to load user preferences:', error);
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
            vaultLocalStorageService.save(this.PREFERENCES_KEY, updated);
        } catch (error) {
            debugLogger.error('Failed to save user preferences:', error);
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
    setPreference(
        key: keyof typeof this.defaultPreferences,
        value: boolean
    ): void {
        if (key === 'skipUnlikeConfirmation') {
            this.setPreferences({ skipUnlikeConfirmation: value });
            return;
        }
        this.setPreferences({ skipLongVideoSummaryConfirmation: value });
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
            vaultLocalStorageService.save(this.PREFERENCES_KEY, null);
        } catch (error) {
            debugLogger.error('Failed to reset user preferences:', error);
        }
    }
}

export const userPreferencesService = new UserPreferencesService();
