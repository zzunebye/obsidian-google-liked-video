import { App } from 'obsidian';
import { confirmAction } from 'src/ui/ConfirmationModal';
import { userPreferencesService } from 'src/services/userPreferencesService';

/**
 * Utility function to handle unlike confirmation with user preference checking
 */
export const confirmUnlikeAction = async (
    app: App, 
    videoTitle: string
): Promise<boolean> => {
    // Check if user has chosen to skip confirmation
    if (userPreferencesService.shouldSkipUnlikeConfirmation()) {
        return true;
    }

    const result = await confirmAction(
        app,
        `Are you sure you want to unlike "${videoTitle}"?`,
        {
            title: 'Confirm Unlike',
            confirmText: 'Unlike',
            cancelText: 'Cancel',
            type: 'warning',
            showRememberChoice: true,
            rememberChoiceText: "Don't ask me again for unlike actions"
        }
    );

    if (result.confirmed && result.rememberChoice) {
        // If user chose to remember this choice, save the preference
        userPreferencesService.setSkipUnlikeConfirmation(true);
    }

    return result.confirmed;
};

/**
 * Utility function for other potentially dangerous actions that might need similar treatment
 */
export const confirmDangerousAction = async (
    app: App,
    message: string,
    options?: {
        title?: string;
        confirmText?: string;
        showRememberChoice?: boolean;
        rememberChoiceText?: string;
        preferenceKey?: string; // For future extensibility
    }
): Promise<boolean> => {
    const result = await confirmAction(app, message, {
        title: options?.title || 'Confirm Action',
        confirmText: options?.confirmText || 'Confirm',
        cancelText: 'Cancel',
        type: 'danger',
        showRememberChoice: options?.showRememberChoice || false,
        rememberChoiceText: options?.rememberChoiceText || "Don't ask me again"
    });

    // Note: For future extensibility, we could handle different preference keys here
    // if (result.confirmed && result.rememberChoice && options?.preferenceKey) {
    //     userPreferencesService.setPreference(options.preferenceKey, true);
    // }

    return result.confirmed;
};