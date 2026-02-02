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