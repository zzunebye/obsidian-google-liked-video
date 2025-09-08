import * as React from 'react';
import { ReactNode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Modal, App } from 'obsidian';

interface ReactModalProps {
    children: ReactNode;
    onClose?: () => void;
}

const ReactModalContent: React.FC<ReactModalProps> = ({ children, onClose }: ReactModalProps) => {
    return (
        <div className="react-modal-wrapper">
            {children}
        </div>
    );
};

export class ReactModal extends Modal {
    private root: Root | null = null;
    private component: ReactNode;
    private onCloseCallback?: () => void;

    constructor(
        app: App,
        component: ReactNode,
        options?: {
            title?: string;
            width?: string;
            height?: string;
            onClose?: () => void;
        }
    ) {
        super(app);
        this.component = component;
        this.onCloseCallback = options?.onClose;

        if (options?.title) {
            this.titleEl.setText(options.title);
        }

        if (options?.width) {
            this.modalEl.style.width = options.width;
        }

        if (options?.height) {
            this.modalEl.style.height = options.height;
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Create React root and render component
        this.root = createRoot(contentEl);
        this.root.render(
            <ReactModalContent onClose={() => this.close()}>
                {this.component}
            </ReactModalContent>
        );
    }

    onClose() {
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }

        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Utility function to create and open a React modal
export const openReactModal = (
    app: App,
    component: ReactNode,
    options?: {
        title?: string;
        width?: string;
        height?: string;
        onClose?: () => void;
    }
): ReactModal => {
    const modal = new ReactModal(app, component, options);
    modal.open();
    return modal;
};

// Hook for using React modals in React components
export const useReactModal = (app?: App) => {
    const openModal = (
        component: ReactNode,
        options?: {
            title?: string;
            width?: string;
            height?: string;
            onClose?: () => void;
        }
    ) => {
        if (!app) {
            console.error('App instance required for useReactModal');
            return null;
        }
        return openReactModal(app, component, options);
    };

    return { openModal };
};