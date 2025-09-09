import { moment } from "obsidian";
import { YouTubeVideo } from "src/types";
import { parseDurationToSeconds } from "src/ui/VideoInfoModal";

export const sanitizeFileName = (title: string): string => {
    return title
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
};

export const formatDurationForYAML = (duration: string): string => {
    const seconds = parseDurationToSeconds(duration);
    if (!seconds) return '';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

export const formatCount = (count: number | string): string => {
    const num = typeof count === 'string' ? parseInt(count) : count;
    if (isNaN(num)) return '0';

    if (num >= 1000000000) {
        return (num / 1000000000).toFixed(1) + 'B';
    } else if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
};

export const generateVideoNoteContent = (
    videoInfo: YouTubeVideo,
    videoUrl: string,
    getCategoryDisplay?: (categoryId: string) => string
): string => {
    const title = videoInfo.snippet.title;
    const channel = videoInfo.snippet.channelTitle;
    const duration = formatDurationForYAML(videoInfo.contentDetails?.duration || '');
    const published = moment(videoInfo.snippet.publishedAt).format('YYYY-MM-DD');
    const category = getCategoryDisplay ? getCategoryDisplay(videoInfo.snippet.categoryId) : videoInfo.snippet.categoryId;
    const tags = videoInfo.snippet.tags || [];

    const yamlTags = tags.length > 0 ? tags.map(tag => `"${tag}"`).join(', ') : '[]';

    const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
channel: "${channel.replace(/"/g, '\\"')}"
duration: "${duration}"
published: "${published}"
category: "${category}"
tags: [${yamlTags}]
youtube_url: "${videoUrl}"
created_at: "${moment().format('YYYY-MM-DD HH:mm:ss')}"
---

# ${title}
`;

    return frontmatter;
};

export const generateUniqueFileName = async (
    app: any,
    baseFileName: string,
    customPath?: string,
    extension = 'md'
): Promise<string> => {
    let targetPath = '';

    if (customPath && customPath.trim()) {
        // Use custom path if provided
        const cleanPath = customPath.trim();
        // Ensure the folder exists or create it
        try {
            if (!(await app.vault.adapter.exists(cleanPath))) {
                await app.vault.createFolder(cleanPath);
            }
        } catch (error) {
            console.warn('Could not create custom folder, using default location:', error);
            // Fall back to default location if folder creation fails
            const defaultLocation = app.fileManager.getNewFileParent('');
            targetPath = defaultLocation?.path || '';
        }
        targetPath = cleanPath;
    } else {
        // Use Obsidian's default new file location
        const defaultLocation = app.fileManager.getNewFileParent('');
        targetPath = defaultLocation?.path || '';
    }

    // Build the full file path
    const buildPath = (fileName: string) => {
        return targetPath ? `${targetPath}/${fileName}` : fileName;
    };

    let fileName = `${baseFileName}.${extension}`;
    let fullPath = buildPath(fileName);
    let counter = 1;

    while (await app.vault.adapter.exists(fullPath)) {
        fileName = `${baseFileName} ${counter}.${extension}`;
        fullPath = buildPath(fileName);
        counter++;
    }

    return fullPath;
};