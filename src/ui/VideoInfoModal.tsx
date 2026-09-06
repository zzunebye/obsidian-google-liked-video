import * as React from 'react';
import { App } from 'obsidian';
import { YouTubeVideo } from 'src/types';
import { ReactModal, openReactModal } from './ReactModal';
import { VideoTagChips } from './VideoTags';

interface VideoInfoModalProps {
    videoInfo: YouTubeVideo;
    getCategoryDisplay?: (categoryId: string) => string;
}

// Parse YouTube ISO 8601 duration format to seconds
export const parseDurationToSeconds = (duration: string | undefined): number | null => {
    if (!duration || typeof duration !== 'string') {
        return null;
    }
    
    // Handle duration that doesn't start with P
    if (!duration.startsWith('P')) {
        return null;
    }
    
    try {
        // Extract weeks, days, hours, minutes, and seconds
        // Format: P[n]W[n]DT[n]H[n]M[n]S
        const match = duration.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
        if (!match) {
            return null;
        }
        
        const weeks = match[1] ? parseInt(match[1]) : 0;
        const days = match[2] ? parseInt(match[2]) : 0;
        const hours = match[3] ? parseInt(match[3]) : 0;
        const minutes = match[4] ? parseInt(match[4]) : 0;
        const seconds = match[5] ? parseInt(match[5]) : 0;
        
        // Convert all to seconds
        const totalSeconds = 
            weeks * 7 * 24 * 3600 +
            days * 24 * 3600 +
            hours * 3600 + 
            minutes * 60 + 
            seconds;
        
        return totalSeconds;
    } catch (error) {
        console.error(`Error parsing duration: ${duration}`, error);
        return null;
    }
};

// Parse YouTube ISO 8601 duration format for display
const parseDuration = (duration: string): string => {
    if (!duration || typeof duration !== 'string') {
        return duration || '';
    }
    
    // Handle duration that doesn't start with P
    if (!duration.startsWith('P')) {
        return duration;
    }
    
    try {
        // Extract weeks, days, hours, minutes, and seconds
        const match = duration.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
        if (!match) {
            return duration;
        }
        
        const weeks = match[1] ? parseInt(match[1]) : 0;
        const days = match[2] ? parseInt(match[2]) : 0;
        const hours = match[3] ? parseInt(match[3]) : 0;
        const minutes = match[4] ? parseInt(match[4]) : 0;
        const seconds = match[5] ? parseInt(match[5]) : 0;
        
        // Calculate total days (including weeks)
        const totalDays = weeks * 7 + days;
        
        // Format the output
        const parts = [];
        if (totalDays > 0) {
            parts.push(`${totalDays}d`);
        }
        if (hours > 0) {
            parts.push(`${hours}h`);
        }
        if (minutes > 0) {
            parts.push(`${minutes}m`);
        }
        if (seconds > 0) {
            parts.push(`${seconds}s`);
        }
        
        // If all parts are 0, return "0s"
        if (parts.length === 0) {
            return '0s';
        }
        
        // Format clock time (days:hours:minutes:seconds or hours:minutes:seconds)
        const formattedTime = [];
        if (totalDays > 0) {
            formattedTime.push(`${totalDays}d`);
            formattedTime.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
            return `${parts.join(' ')} (${formattedTime.join(' ')})`;
        } else if (hours > 0) {
            formattedTime.push(hours.toString());
            formattedTime.push(minutes.toString().padStart(2, '0'));
        } else {
            formattedTime.push(minutes.toString());
        }
        formattedTime.push(seconds.toString().padStart(2, '0'));
        
        return `${parts.join(' ')} (${formattedTime.join(':')})`; 
    } catch (error) {
        console.error(`Error formatting duration: ${duration}`, error);
        return duration;
    }
};

const VideoInfoContent: React.FC<VideoInfoModalProps> = ({ videoInfo, getCategoryDisplay }: VideoInfoModalProps) => {
    const formatKey = (key: string): string => {
        return key.replace(/([A-Z])/g, ' $1').trim();
    };

    const formatValue = (key: string, value: unknown): React.ReactNode => {
        if (key === 'categoryId' && getCategoryDisplay) {
            return typeof value === 'string' ? getCategoryDisplay(value) : '';
        }

        if (key === 'duration' && typeof value === 'string') {
            return parseDuration(value);
        }

        if (key === 'tags' && Array.isArray(value)) {
            return <VideoTagChips tags={value.filter((tag): tag is string => typeof tag === 'string')} />;
        }

        if (typeof value === 'object') {
            return JSON.stringify(value, null, 2);
        }

        return value === null || value === undefined ? '' : String(value);
    };

    const renderInfoSection = (title: string, data: Record<string, unknown>, excludeKeys: string[] = []) => {
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
                            <div className={`video-info-item__value ${key === 'tags' ? 'video-info-item__value--tags' : ''}`}>
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
