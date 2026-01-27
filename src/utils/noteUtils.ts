import { moment, TFile, Notice } from "obsidian";
import { YouTubeVideo } from "src/types";
import { parseDurationToSeconds } from "src/ui/VideoInfoModal";
import { getAllDailyNotes, getDailyNote, createDailyNote } from "obsidian-daily-notes-interface";

export const sanitizeFileName = (title: string): string => {
    return title
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
};

export const sanitizeChannelName = (channelName: string): string => {
    return channelName
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 50); // Shorter limit for folder names
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

    // Extract video tags if available
    const videoTags = videoInfo.snippet.tags || [];
    const tagsYAML = videoTags.length > 0
        ? videoTags.map(tag => `"${tag.replace(/"/g, '\\"')}"`).join(', ')
        : '';

    const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
type: "youtube-video"
channel: "${channel.replace(/"/g, '\\"')}"
duration: "${duration}"
published: "${published}"
category: "${category.replace(/\s*\(\d+\)\s*/g, '').trim()}"
url: "${videoUrl}"
created_at: "${moment().format('YYYY-MM-DD HH:mm:ss')}"
tags: [youtube, video]${tagsYAML ? `
video_tags: [${tagsYAML}]` : ''}
content-language: "${videoInfo.snippet.defaultAudioLanguage || 'unknown'}"
---

`;

    return frontmatter;
};

export const getVideoUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

export const linkToDailyNote = async (app: any, file: TFile) => {
    try {
        const today = moment().startOf('day');
        const dailyNotes = getAllDailyNotes();
        let dailyNote = getDailyNote(today, dailyNotes);

        if (!dailyNote) {
            dailyNote = await createDailyNote(today);
        }

        const dataToAdd = `\n- [[${file.basename}]]`;
        await app.vault.append(dailyNote, dataToAdd);
        new Notice(`Linked ${file.basename} to daily note.`);
    } catch (error) {
        console.error('Error linking to daily note:', error);
        new Notice('Failed to link to daily note. Check console for details.');
    }
};


export const getExpectedNotePath = async (
    app: any,
    baseFileName: string,
    customPath?: string,
    organizeByChannel?: boolean,
    channelName?: string,
    extension = 'md'
): Promise<string> => {
    let targetPath = '';

    if (customPath && customPath.trim()) {
        // Use custom path if provided
        const cleanPath = customPath.trim();

        // Add channel subfolder if organizing by channel
        let fullPath = cleanPath;
        if (organizeByChannel && channelName) {
            const sanitizedChannelName = sanitizeChannelName(channelName);
            if (sanitizedChannelName) {
                fullPath = `${cleanPath}/${sanitizedChannelName}`;
            }
        }

        // Ensure the folder exists or create it
        try {
            if (!(await app.vault.adapter.exists(fullPath))) {
                await app.vault.createFolder(fullPath);
            }
        } catch (error) {
            console.warn('Could not create custom folder, using default location:', error);
            // Fall back to base custom path without channel organization
            try {
                if (!(await app.vault.adapter.exists(cleanPath))) {
                    await app.vault.createFolder(cleanPath);
                }
                fullPath = cleanPath;
            } catch (fallbackError) {
                // Fall back to Obsidian default location
                const defaultLocation = app.fileManager.getNewFileParent('');
                fullPath = defaultLocation?.path || '';
            }
        }
        targetPath = fullPath;
    } else {
        // Use Obsidian's default new file location, optionally with channel subfolder
        const defaultLocation = app.fileManager.getNewFileParent('');
        const basePath = defaultLocation?.path || '';

        if (organizeByChannel && channelName && basePath) {
            const sanitizedChannelName = sanitizeChannelName(channelName);
            if (sanitizedChannelName) {
                const channelPath = `${basePath}/${sanitizedChannelName}`;
                try {
                    if (!(await app.vault.adapter.exists(channelPath))) {
                        await app.vault.createFolder(channelPath);
                    }
                    targetPath = channelPath;
                } catch (error) {
                    console.warn('Could not create channel folder in default location:', error);
                    targetPath = basePath;
                }
            } else {
                targetPath = basePath;
            }
        } else {
            targetPath = basePath;
        }
    }

    // Build the expected file path (without checking for duplicates)
    const fileName = `${baseFileName}.${extension}`;
    return targetPath ? `${targetPath}/${fileName}` : fileName;
};

export const generateUniqueFileName = async (
    app: any,
    baseFileName: string,
    customPath?: string,
    organizeByChannel?: boolean,
    channelName?: string,
    extension = 'md'
): Promise<string> => {
    let targetPath = '';

    if (customPath && customPath.trim()) {
        // Use custom path if provided
        const cleanPath = customPath.trim();

        // Add channel subfolder if organizing by channel
        let fullPath = cleanPath;
        if (organizeByChannel && channelName) {
            const sanitizedChannelName = sanitizeChannelName(channelName);
            if (sanitizedChannelName) {
                fullPath = `${cleanPath}/${sanitizedChannelName}`;
            }
        }

        // Ensure the folder exists or create it
        try {
            if (!(await app.vault.adapter.exists(fullPath))) {
                await app.vault.createFolder(fullPath);
            }
        } catch (error) {
            console.warn('Could not create custom folder, using default location:', error);
            // Fall back to base custom path without channel organization
            try {
                if (!(await app.vault.adapter.exists(cleanPath))) {
                    await app.vault.createFolder(cleanPath);
                }
                fullPath = cleanPath;
            } catch (fallbackError) {
                // Fall back to Obsidian default location
                const defaultLocation = app.fileManager.getNewFileParent('');
                fullPath = defaultLocation?.path || '';
            }
        }
        targetPath = fullPath;
    } else {
        // Use Obsidian's default new file location, optionally with channel subfolder
        const defaultLocation = app.fileManager.getNewFileParent('');
        const basePath = defaultLocation?.path || '';

        if (organizeByChannel && channelName && basePath) {
            const sanitizedChannelName = sanitizeChannelName(channelName);
            if (sanitizedChannelName) {
                const channelPath = `${basePath}/${sanitizedChannelName}`;
                try {
                    if (!(await app.vault.adapter.exists(channelPath))) {
                        await app.vault.createFolder(channelPath);
                    }
                    targetPath = channelPath;
                } catch (error) {
                    console.warn('Could not create channel folder in default location:', error);
                    targetPath = basePath;
                }
            } else {
                targetPath = basePath;
            }
        } else {
            targetPath = basePath;
        }
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