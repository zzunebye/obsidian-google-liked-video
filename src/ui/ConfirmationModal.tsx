import * as React from 'react';
import { useState } from 'react';
import { App } from 'obsidian';
import { ReactModal, openReactModal } from './ReactModal';

interface ConfirmationModalProps {
    message: string;
    onConfirm: (rememberChoice?: boolean) => void;
    onCancel?: () => void;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
    showRememberChoice?: boolean;
    rememberChoiceText?: string;
}

const ConfirmationContent: React.FC<ConfirmationModalProps> = ({
    message,
    onConfirm,
    onCancel,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'info',
    showRememberChoice = false,
    rememberChoiceText = "Don't ask me again"
}: ConfirmationModalProps) => {
    const [rememberChoice, setRememberChoice] = useState(false);

    const handleConfirm = () => {
        onConfirm(showRememberChoice ? rememberChoice : undefined);
    };

    const handleCancel = () => {
        if (onCancel) {
            onCancel();
        }
    };

    const getTypeIcon = () => {
        switch (type) {
            case 'danger':
                return '⚠️';
            case 'warning':
                return '⚠️';
            case 'info':
            default:
                return 'ℹ️';
        }
    };

    return (
        <div className={`confirmation-modal confirmation-modal--${type}`}>
            <div className="confirmation-modal__icon">
                {getTypeIcon()}
            </div>
            <div className="confirmation-modal__message" style={{ whiteSpace: 'pre-line' }}>
                {message}
            </div>
            {showRememberChoice && (
                <div className="confirmation-modal__remember-choice">
                    <label className="confirmation-modal__checkbox-label">
                        <input
                            type="checkbox"
                            checked={rememberChoice}
                            onChange={(e) => setRememberChoice(e.target.checked)}
                            className="confirmation-modal__checkbox"
                        />
                        <span className="confirmation-modal__checkbox-text">
                            {rememberChoiceText}
                        </span>
                    </label>
                </div>
            )}
            <div className="confirmation-modal__actions">
                <button
                    className="confirmation-modal__button confirmation-modal__button--cancel"
                    onClick={handleCancel}
                >
                    {cancelText}
                </button>
                <button
                    className={`confirmation-modal__button confirmation-modal__button--confirm confirmation-modal__button--${type}`}
                    onClick={handleConfirm}
                >
                    {confirmText}
                </button>
            </div>
        </div>
    );
};

// Utility function to open confirmation modal
export const openConfirmationModal = (
    app: App,
    options: ConfirmationModalProps & { title?: string }
): ReactModal => {
    // eslint-disable-next-line prefer-const
    let modalInstance: ReactModal;

    const handleConfirm = (rememberChoice?: boolean) => {
        options.onConfirm(rememberChoice);
        modalInstance.close();
    };

    const handleCancel = () => {
        if (options.onCancel) {
            options.onCancel();
        }
        modalInstance.close();
    };

    modalInstance = openReactModal(
        app,
        <ConfirmationContent
            {...options}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
        />,
        {
            title: options.title || 'Confirmation',
            width: '600px'
        }
    );

    return modalInstance;
};

// Promise-based confirmation modal with remember choice support
export const confirmAction = (
    app: App,
    message: string,
    options?: {
        title?: string;
        confirmText?: string;
        cancelText?: string;
        type?: 'danger' | 'warning' | 'info';
        showRememberChoice?: boolean;
        rememberChoiceText?: string;
    }
): Promise<{ confirmed: boolean; rememberChoice?: boolean }> => {
    return new Promise((resolve) => {
        openConfirmationModal(app, {
            message,
            onConfirm: (rememberChoice?: boolean) => resolve({
                confirmed: true,
                rememberChoice
            }),
            onCancel: () => resolve({ confirmed: false }),
            ...options
        });
    });
};