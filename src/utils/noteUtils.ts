import { moment, TFile, Notice } from "obsidian";
import { YouTubeVideo } from "src/types";
import { parseDurationToSeconds } from "src/ui/VideoInfoModal";
import { getAllDailyNotes, getDailyNote, createDailyNote } from "obsidian-daily-notes-interface";
import { TemplateService } from "src/services/templateService";

export const sanitizeFileName = (title: string): string => {
    return title
        .replace(/[\\/:*?<>|#]/g, '-')
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

/**
 * Sanitize a string for safe use in YAML frontmatter.
 * Escapes double quotes and removes newlines to prevent YAML parsing errors.
 */
export const sanitizeForYAML = (value: string): string => {
    if (!value) return '';
    return value
        .replace(/"/g, '\\"')   // Escape double quotes
        .replace(/\n/g, ' ')    // Replace newlines with spaces
        .replace(/\r/g, '')     // Remove carriage returns
        .trim();
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

export const escapeYAMLString = (str: string): string => {
    return str.replace(/"/g, '\\"');
};

export const getLanguageName = (code: string | undefined): string => {
    const languageMap: Record<string, string> = {
        'en': 'English',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'it': 'Italian',
        'pt': 'Portuguese',
        'ru': 'Russian',
        'ja': 'Japanese',
        'ko': 'Korean',
        'zh': 'Chinese',
        'ar': 'Arabic',
        'hi': 'Hindi',
        'nl': 'Dutch',
        'pl': 'Polish',
        'sv': 'Swedish',
        'tr': 'Turkish',
    };
    return code ? (languageMap[code] || code) : 'unknown';
};

// Build template variables from video info
// Used for replacing in templates
export const buildTemplateVariables = (
    videoInfo: YouTubeVideo,
    videoUrl: string,
    getCategoryDisplay?: (categoryId: string) => string
): Record<string, string> => {
    const category = getCategoryDisplay
        ? getCategoryDisplay(videoInfo.snippet.categoryId)
        : videoInfo.snippet.categoryId;

    const variables: Record<string, string> = {
        // Core metadata
        'title': sanitizeForYAML(videoInfo.snippet.title),
        'video_id': videoInfo.id,
        'video_url': videoUrl,
        'channel': sanitizeForYAML(videoInfo.snippet.channelTitle),
        'channel_id': videoInfo.snippet.channelId,
        'description': videoInfo.snippet.description || '',
        'category': category.replace(/\s*\(\d+\)\s*/g, '').trim(),
        'category_id': videoInfo.snippet.categoryId,
        'category_underscored': category.replace(/\s*\(\d+\)\s*/g, '').trim().replace(/[\s&]+/g, '_'),

        // Time & duration
        'duration': formatDurationForYAML(videoInfo.contentDetails?.duration || ''),
        'duration_seconds': String(parseDurationToSeconds(videoInfo.contentDetails?.duration || '')),
        'published_at': videoInfo.snippet.publishedAt,
        'published_date': moment(videoInfo.snippet.publishedAt).format('YYYY-MM-DD'),
        'published_year': moment(videoInfo.snippet.publishedAt).format('YYYY'),
        'created_at': moment().format('YYYY-MM-DD HH:mm:ss'),
        'created_date': moment().format('YYYY-MM-DD'),
        'pulled_at': videoInfo.pulled_at,

        // Statistics
        'view_count': String(videoInfo.statistics?.viewCount || 0),
        'view_count_formatted': formatCount(videoInfo.statistics?.viewCount || 0),
        'like_count': String(videoInfo.statistics?.likeCount || 0),
        'like_count_formatted': formatCount(videoInfo.statistics?.likeCount || 0),
        'comment_count': String(videoInfo.statistics?.commentCount || 0),
        'comment_count_formatted': formatCount(videoInfo.statistics?.commentCount || 0),

        // Tags & language
        'tags_comma_separated': (videoInfo.snippet.tags || [])
            .map(tag => `"${tag.replace(/"/g, '\\"')}"`)
            .join(', '),
        'tags_array': JSON.stringify(videoInfo.snippet.tags || []),
        'tags': videoInfo.snippet.tags?.toString() || '',
        'language': videoInfo.snippet.defaultAudioLanguage || '',
        'language_name': getLanguageName(videoInfo.snippet.defaultAudioLanguage),

        // Thumbnails
        'thumbnail_default': videoInfo.snippet.thumbnails?.default?.url || '',
        'thumbnail_medium': videoInfo.snippet.thumbnails?.medium?.url || '',
        'thumbnail_high': videoInfo.snippet.thumbnails?.high?.url || '',
        'thumbnail_maxres': videoInfo.snippet.thumbnails?.maxres?.url || '',

        // Content details
        'definition': videoInfo.contentDetails?.definition || '',
        'caption': videoInfo.contentDetails?.caption || '',
        'dimension': videoInfo.contentDetails?.dimension || ''
    };

    return variables;
};

export const replaceTemplateVariables = (
    template: string,
    variables: Record<string, string>
): string => {
    let result = template;

    // Replace {{variable|fallback}} or {{variable}}
    const regex = /\{\{([^}|]+)(?:\|([^}]*))?\}\}/g;

    result = result.replace(regex, (match, varName, fallback) => {
        const trimmedVarName = varName.trim();
        const value = variables[trimmedVarName];

        if (value !== undefined && value !== '') {
            return value;
        }

        return fallback?.trim() || '';
    });

    return result;
};

/**
 * Obsidian 코어 템플릿 호환 - {{date}}, {{date:FORMAT}}, {{time}}, {{time:FORMAT}} 지원
 */
export const replaceDateTimeVariables = (template: string): string => {
    let result = template;

    // {{date}} - 기본 날짜 (YYYY-MM-DD)
    result = result.replace(/\{\{date\}\}/g, moment().format('YYYY-MM-DD'));

    // {{date:FORMAT}} - 커스텀 포맷 (예: {{date:YYYY-MM-DD}})
    result = result.replace(/\{\{date:([^}]+)\}\}/g, (_, format) => {
        return moment().format(format);
    });

    // {{time}} - 기본 시간 (HH:mm)
    result = result.replace(/\{\{time\}\}/g, moment().format('HH:mm'));

    // {{time:FORMAT}} - 커스텀 포맷 (예: {{time:HH:mm:ss}})
    result = result.replace(/\{\{time:([^}]+)\}\}/g, (_, format) => {
        return moment().format(format);
    });

    return result;
};

export const generateVideoNoteContentFromTemplate = (
    template: string,
    videoInfo: YouTubeVideo,
    videoUrl: string,
    getCategoryDisplay?: (categoryId: string) => string
): string => {
    const variables = buildTemplateVariables(videoInfo, videoUrl, getCategoryDisplay);
    // First replace Obsidian core date/time variables, then video variables
    let result = replaceDateTimeVariables(template);
    result = replaceTemplateVariables(result, variables);
    return result;
};

export const generateVideoNoteContent = async (
    videoInfo: YouTubeVideo,
    videoUrl: string,
    getCategoryDisplay?: (categoryId: string) => string,
    templateService?: TemplateService
): Promise<string> => {
    // Try to load custom template
    if (templateService) {
        try {
            const template = templateService.loadTemplate();
            if (template) {
                return generateVideoNoteContentFromTemplate(
                    template,
                    videoInfo,
                    videoUrl,
                    getCategoryDisplay
                );
            }
        } catch (error) {
            console.error('Template processing failed:', error);
            // Will fall through to built-in template
        }
    }

    // Built-in template (existing code)
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