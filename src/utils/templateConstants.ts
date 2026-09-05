import type { CollapsibleReferenceSection } from './settingUiUtils';

export const DEFAULT_TEMPLATE = `---
title: "{{title}}"
type: youtube-video
video_id: "{{video_id}}"
channel: "{{channel}}"
channel_id: {{channel_id}}
duration: {{duration}}
published: {{published_date}}
year: "{{published_year}}"
category: {{category}}
url: {{video_url}}
created_at: {{date}} {{time}}
views: {{view_count}}
likes: {{like_count}}
tags: [youtube, video, {{category_underscored|uncategorized}}]
video_tags: [{{tags_comma_separated}}]
content-language: {{language|unknown}}
---

# {{title}}
`;

export const TEMPLATE_VARIABLES_REFERENCE: readonly CollapsibleReferenceSection[] = [
	{
		title: '📅 Date & Time (Obsidian Core)',
		items: [
			{ variables: ['{{date}}'], description: 'Current date (2024-01-31)' },
			{ variables: ['{{date:YYYY-MM-DD}}'], description: 'Custom format' },
			{ variables: ['{{time}}'], description: 'Current time (14:30)' },
			{ variables: ['{{time:HH:mm:ss}}'], description: 'Custom format' },
		],
	},
	{
		title: '🎬 Video Info',
		items: [
			{ variables: ['{{title}}'], description: 'Video title' },
			{ variables: ['{{video_id}}'], description: 'Video ID' },
			{ variables: ['{{video_url}}'], description: 'YouTube URL' },
			{ variables: ['{{channel}}'], description: 'Channel name' },
			{ variables: ['{{channel_id}}'], description: 'Channel ID' },
			{ variables: ['{{description}}'], description: 'Video description' },
			{ variables: ['{{duration}}'], description: 'Duration (12:34)' },
			{ variables: ['{{duration_seconds}}'], description: 'Duration in seconds' },
			{ variables: ['{{category}}'], description: 'Category name' },
			{ variables: ['{{category_id}}'], description: 'Category ID' },
			{ variables: ['{{category_underscored}}'], description: 'Category with underscores' },
			{ variables: ['{{published_at}}'], description: 'Full ISO timestamp' },
			{ variables: ['{{published_date}}'], description: 'Publish date (YYYY-MM-DD)' },
			{ variables: ['{{published_year}}'], description: 'Publish year' },
			{ variables: ['{{created_at}}'], description: 'Note creation datetime' },
			{ variables: ['{{created_date}}'], description: 'Note creation date' },
			{ variables: ['{{pulled_at}}'], description: 'When video was fetched' },
		],
	},
	{
		title: '📹 Content Details',
		items: [
			{ variables: ['{{definition}}'], description: 'Video quality (hd/sd)' },
			{ variables: ['{{caption}}'], description: 'Has captions (true/false)' },
			{ variables: ['{{dimension}}'], description: 'Video dimension (2d/3d)' },
		],
	},
	{
		title: '📊 Statistics',
		items: [
			{ variables: ['{{view_count}}'], description: 'View count (raw number)' },
			{ variables: ['{{view_count_formatted}}'], description: 'View count (e.g. 1.2M)' },
			{ variables: ['{{like_count}}', '{{like_count_formatted}}'], description: 'Like count' },
			{ variables: ['{{comment_count}}', '{{comment_count_formatted}}'], description: 'Comment count' },
		],
	},
	{
		title: '🏷️ Tags & Language',
		items: [
			{ variables: ['{{tags}}'], description: 'Tags for display' },
			{ variables: ['{{tags_array}}'], description: 'Tags for display' },
			{ variables: ['{{tags_comma_separated}}'], description: 'Tags for YAML array' },
			{ variables: ['{{language}}'], description: 'Language code (en)' },
			{ variables: ['{{language_name}}'], description: 'Language name (English)' },
		],
	},
	{
		title: '🖼️ Thumbnails',
		items: [
			{ variables: ['{{thumbnail_default}}', '{{thumbnail_medium}}'] },
			{ variables: ['{{thumbnail_high}}', '{{thumbnail_maxres}}'] },
		],
	},
	{
		title: '💡 Fallback Syntax',
		items: [
			{ variables: ['{{variable|default}}'], description: 'Use default if value is empty' },
		],
	},
];
