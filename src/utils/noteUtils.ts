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
    const viewCount = formatCount(videoInfo.statistics.viewCount);
    const likeCount = formatCount(videoInfo.statistics.likeCount);
    const category = getCategoryDisplay ? getCategoryDisplay(videoInfo.snippet.categoryId) : videoInfo.snippet.categoryId;
    const tags = videoInfo.snippet.tags || [];

    const yamlTags = tags.length > 0 ? tags.map(tag => `"${tag}"`).join(', ') : '[]';

    const frontmatter = `---
video_id: "${videoInfo.id}"
title: "${title.replace(/"/g, '\\"')}"
channel: "${channel.replace(/"/g, '\\"')}"
duration: "${duration}"
published: "${published}"
view_count: "${viewCount}"
like_count: "${likeCount}"
category: "${category}"
tags: [${yamlTags}]
youtube_url: "${videoUrl}"
created_from: "geulo-plugin"
created_at: "${moment().format('YYYY-MM-DD HH:mm:ss')}"
---

# ${title}
`;

    return frontmatter;
};

export const generateUniqueFileName = async (
    app: any,
    baseFileName: string,
    extension: string = 'md'
): Promise<string> => {
    let fileName = `${baseFileName}.${extension}`;
    let counter = 1;

    while (await app.vault.adapter.exists(fileName)) {
        fileName = `${baseFileName} ${counter}.${extension}`;
        counter++;
    }

    return fileName;
};