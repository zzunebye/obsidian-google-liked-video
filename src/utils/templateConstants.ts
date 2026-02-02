export const DEFAULT_TEMPLATE = `---
title: "{{title}}"
type: youtube-video
channel: "{{channel}}"
channel_id: {{channel_id}}
duration: {{duration}}
published: {{published_date}}
year: {{published_year}}
category: {{category}}
url: {{video_url}}
created_at: {{date}} {{time}}
views: {{view_count}}
likes: {{like_count}}
tags: [youtube, video, {{category|uncategorized}}]
video_tags: [{{tags_comma_separated}}]
content-language: {{language|unknown}}
---

# {{title}}
`;

export const TEMPLATE_VARIABLES_REFERENCE = `
                <div style="margin-top: 12px; font-size: 12px; line-height: 1.6;">
                    <h4 style="margin: 12px 0 8px 0; color: var(--text-accent);">📅 Date & Time (Obsidian Core)</h4>
                    <code>{{date}}</code> → Current date (2024-01-31)<br>
                    <code>{{date:YYYY-MM-DD}}</code> → Custom format<br>
                    <code>{{time}}</code> → Current time (14:30)<br>
                    <code>{{time:HH:mm:ss}}</code> → Custom format<br>

                    <h4 style="margin: 16px 0 8px 0; color: var(--text-accent);">🎬 Video Info</h4>
                    <code>{{title}}</code> → Video title<br>
                    <code>{{video_id}}</code> → Video ID<br>
                    <code>{{video_url}}</code> → YouTube URL<br>
                    <code>{{channel}}</code> → Channel name<br>
                    <code>{{channel_id}}</code> → Channel ID<br>
                    <code>{{description}}</code> → Video description<br>
                    <code>{{duration}}</code> → Duration (12:34)<br>
                    <code>{{duration_seconds}}</code> → Duration in seconds<br>
                    <code>{{category}}</code> → Category name<br>
                    <code>{{category_id}}</code> → Category ID<br>
                    <code>{{category_underscored}}</code> → Category with underscores<br>
                    <code>{{published_at}}</code> → Full ISO timestamp<br>
                    <code>{{published_date}}</code> → Publish date (YYYY-MM-DD)<br>
                    <code>{{published_year}}</code> → Publish year<br>
                    <code>{{created_at}}</code> → Note creation datetime<br>
                    <code>{{created_date}}</code> → Note creation date<br>
                    <code>{{pulled_at}}</code> → When video was fetched<br>

                    <h4 style="margin: 16px 0 8px 0; color: var(--text-accent);">📹 Content Details</h4>
                    <code>{{definition}}</code> → Video quality (hd/sd)<br>
                    <code>{{caption}}</code> → Has captions (true/false)<br>
                    <code>{{dimension}}</code> → Video dimension (2d/3d)<br>

                    <h4 style="margin: 16px 0 8px 0; color: var(--text-accent);">📊 Statistics</h4>
                    <code>{{view_count}}</code> → View count (raw number)<br>
                    <code>{{view_count_formatted}}</code> → View count (e.g. 1.2M)<br>
                    <code>{{like_count}}</code> / <code>{{like_count_formatted}}</code> → Like count<br>
                    <code>{{comment_count}}</code> / <code>{{comment_count_formatted}}</code> → Comment count<br>

                    <h4 style="margin: 16px 0 8px 0; color: var(--text-accent);">🏷️ Tags & Language</h4>
                    <code>{{tags}}</code> → Tags for display<br>
                    <code>{{tags_array}}</code> → Tags for display<br>
                    <code>{{tags_comma_separated}}</code> → Tags for YAML array<br>
                    <code>{{language}}</code> → Language code (en)<br>
                    <code>{{language_name}}</code> → Language name (English)<br>

                    <h4 style="margin: 16px 0 8px 0; color: var(--text-accent);">🖼️ Thumbnails</h4>
                    <code>{{thumbnail_default}}</code>, <code>{{thumbnail_medium}}</code><br>
                    <code>{{thumbnail_high}}</code>, <code>{{thumbnail_maxres}}</code><br>

                    <h4 style="margin: 16px 0 8px 0; color: var(--text-accent);">💡 Fallback Syntax</h4>
                    <code>{{variable|default}}</code> → Use default if value is empty
                </div>
            `;
