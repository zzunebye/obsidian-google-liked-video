import { App } from 'obsidian';
import { YouTubeVideo } from 'src/types';
import { ReactModal, openReactModal } from './ReactModal';

interface VideoInfoModalProps {
    videoInfo: YouTubeVideo;
    getCategoryDisplay?: (categoryId: string) => string;
}

const VideoInfoContent: React.FC<VideoInfoModalProps> = ({ videoInfo, getCategoryDisplay }) => {
    const formatKey = (key: string): string => {
        return key.replace(/([A-Z])/g, ' $1').trim();
    };

    const formatValue = (key: string, value: any): string => {
        if (key === 'categoryId' && getCategoryDisplay) {
            return getCategoryDisplay(value as string);
        }

        if (key === 'tags' && Array.isArray(value)) {
            return value.join(', ');
        }

        if (typeof value === 'object') {
            return JSON.stringify(value, null, 2);
        }

        return value?.toString() || '';
    };

    const renderInfoSection = (title: string, data: Record<string, any>, excludeKeys: string[] = []) => {
        const entries = Object.entries(data).filter(([key]) => !excludeKeys.includes(key));

        if (entries.length === 0) return null;

        return (
            <div className="video-info-section">
                <h3 className="video-info-section__title">{title}</h3>
                <div className="video-info-section__content">
                    {entries.map(([key, value]) => (
                        <div key={key} className="video-info-item">
                            <div className="video-info-item__key">
                                {formatKey(key)}:
                            </div>
                            <div className="video-info-item__value">
                                {formatValue(key, value)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="video-info-modal">
            {renderInfoSection('Statistics', videoInfo.statistics, ['favoriteCount'])}

            <div className="video-info-divider" />

            {renderInfoSection('Video Details', videoInfo.snippet, ['thumbnails', 'localized'])}

            {videoInfo.contentDetails && (
                <>
                    <div className="video-info-divider" />
                    {renderInfoSection('Content Details', videoInfo.contentDetails, ['regionRestriction'])}
                </>
            )}
        </div>
    );
};

// Utility function to open video info modal
export const openVideoInfoModal = (
    app: App,
    videoInfo: YouTubeVideo,
    getCategoryDisplay?: (categoryId: string) => string
): ReactModal => {
    return openReactModal(
        app,
        <VideoInfoContent
            videoInfo={videoInfo}
            getCategoryDisplay={getCategoryDisplay}
        />,
        {
            title: 'Video Information',
            width: '600px',
            height: '80vh'
        }
    );
};

// Legacy class for backwards compatibility
export class VideoInfoModal extends ReactModal {
    constructor(
        app: App,
        videoInfo: YouTubeVideo,
        getCategoryDisplay?: (categoryId: string) => string
    ) {
        super(
            app,
            <VideoInfoContent
                videoInfo={videoInfo}
                getCategoryDisplay={getCategoryDisplay}
            />,
            {
                title: 'Video Information',
                width: '600px',
                height: '80vh'
            }
        );
    }
}

// Hook-based approach for React components
export const useVideoInfoModal = () => {
    const openVideoInfoModal = (
        app: App,
        videoInfo: YouTubeVideo,
        getCategoryDisplay?: (categoryId: string) => string
    ) => {
        const modal = new VideoInfoModal(app, videoInfo, getCategoryDisplay);
        modal.open();
        return modal;
    };

    return { openVideoInfoModal };
};