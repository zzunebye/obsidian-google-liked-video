# Geulo - YouTube Liked Video Plugin

Transform your YouTube liked videos into a powerful knowledge management system within Obsidian.

Geulo seamlessly fetches, organizes, and integrates your liked videos in YouTube directly into your Obsidian workflow. Perfect for researchers, content creators, and knowledge workers who believe that revisiting quality content is as valuable as discovering new material.

**Why Geulo?** Instead of letting your liked videos disappear into YouTube's depths, Geulo brings them into your personal knowledge base where you can search, sort, and reference them alongside your notes. Turn passive video consumption into active knowledge building.

**Key capabilities:**

- Instantly access your entire YouTube 'liked video' collection
- Browse and manage your YouTube playlists
- Search, filter and sort to rediscover videos
- AI-powered video summaries (Gemini / OpenRouter)
- One-click integration with your daily notes
- Curate your collection by removing videos directly from the sidebar

*Features are still at its early stages - your feedback shapes the future.* Connect with me at [zzunebye@gmail.com](mailto:zzunebye@gmail.com) or open an issue for suggestions.

## Table of Contents

- [Features](#features)
- [AI Summary Setup](#ai-summary-setup)
- [Tips](#tips)
- [Requirements](#requirements)
- [Release Notes](#release-notes)

## Features

- **Video retrieval**: Access your entire YouTube liked video history
- **Playlist browsing**: Browse your YouTube playlists and add custom playlists by ID
- **Searching and Content type filtering**: Search, filter, and sort your videos with multiple options. Search is based on the video title, channel title, and tags. Filter videos by type — Videos, Shorts, or Music.
- **Create Video Notes**: Create video notes with a single click and write your own notes. You can also organize them by channel.
- **Daily note integration**: Add videos to your daily notes with a single click
- **Collection curation**: Remove videos from your liked list directly within Obsidian
- **AI video summaries**: Generate video summaries using Google Gemini or OpenRouter with Gemini's video_url parameter. Summaries stream in real-time, with a collapsible one-liner preview and full expandable summary.
- **Add summary to note**: Append AI-generated summaries to your video notes
- **Video info display**: Display video info with a single click
- **Search by channel name**: Search by channel title when channel is clicked in the video card

It is inspired by the [obsidian-google-calendar](https://github.com/YukiGasai/obsidian-google-calendar) plugin.

## AI Summary Setup

1. Enable **AI Summary** in the plugin settings
2. Choose a provider: **Gemini** (direct) or **OpenRouter**
3. Enter the API key for your chosen provider
4. (OpenRouter only) Select or enter a model ID
5. Optionally customize the summary prompt
6. Click the summary button on any video card to generate a summary

## Tips

<img width="480" alt="image" src="https://github.com/user-attachments/assets/81f68f4e-3313-4bf1-a1aa-7e1a0566de7e" />

You can watch youtube video and take a note within Obsidian if you turn on **Core Plugin > Web Viewer**.

## Requirements

To use this plugin, you need to set up a project in Google Cloud Console and enable the YouTube Data API v3. Follow the steps below to set it up:

1. **Download the Plugin**: Go to the Obsidian community plugins page and search for "Geulo".
2. **Enable the Plugin**: In Obsidian, navigate to Settings > Community plugins and toggle the Geulo plugin on.
3. **Set Up API Credentials**: Follow the steps in the "Setting up Google Cloud Console and YouTube Data API v3" section to obtain your credentials.

### Setting up Google Cloud Console and YouTube Data API v3

The YouTube Data API v3 operates on a quota system where different API calls consume a specific number of “units” or “points” from a daily allowance. Using the API is free of charge; the “cost” refers to these quota units, not a monetary fee.

To use this plugin, you need to set up a project in Google Cloud Console and enable the YouTube Data API v3. 

Follow the steps below to set it up:

#### 1. Create a Project

- Go to Google Cloud Console.
- Click on the project dropdown and select "New Project".
- Enter a project name and click "Create".

#### 2. Enable YouTube Data API v3

- Navigate to API & Services > Library.
- Search for YouTube Data API v3 and click on it.
- Click "Enable".

#### 3. Create Credentials

- Go to API & Services > Credentials.
- Click on Create Credentials and select OAuth client ID.
- Configure the consent screen if prompted.
- Choose Web application and enter a name.
- In Authorized JavaScript origins, add `http://127.0.0.1:42813`.
- In Authorized redirect URIs, add `http://127.0.0.1:42813/callback`.
- Click "Create" and copy the Client ID and Client secret.

#### 4. Create Login Permissions

- Open **Google Cloud Console** for the project you created for this plugin.
- Go to **Google Auth Platform → Audience** (this replaces the older “OAuth consent screen” UI).
- Confirm:
  - **Publishing status** = **Testing**
  - **User type** = **External**
- Under **Test users**, click **Add users** and add the Google account you use in Obsidian (for example `yourname@gmail.com`).
- Save.

#### 5. Enter Credentials in Plugin

- Open Obsidian and go to the settings of the YouTube Liked Videos plugin.
- Enter your Client ID and Client secret in the respective fields.
- Click "Login" to login to your Google account.

#### 6. Successful Authentication Confirmation

- When the OAuth flow succeeds, your browser will open a page at a URL like: `http://127.0.0.1:42813/callback?code=...&scope=...`
- The page will display:
> **Authentication successful! Please return to Obsidian.**
- At that point you can close the tab and Obsidian should show that you are logged in.

### Troubleshooting

If you encounter any issues, consider the following steps:

1. **Credentials**: Double-check that your Client ID and Client secret are correctly entered in the plugin settings.
2. **Authorized URIs**: Verify that http://127.0.0.1:42813 is listed in the Authorized JavaScript origins and http://127.0.0.1:42813/callback in the Authorized redirect URIs.
3. If granting permission to your google project fails, check if there are multiple window/tabs for login process opened. If so, close all of them and try again.

## Release Notes

### 3.0.0

- **AI video summaries**: Generate summaries using Google Gemini or OpenRouter with real-time streaming responses
- **One-liner summaries**: Automatic brief summary generation after full summary completes
- **Summary management**: Regenerate summaries, add summaries to notes, filter by AI note
- **Content type filtering**: Filter liked videos by Videos, Shorts, or Music
- **Streaming UI**: Live streaming display with skeleton loading and cancel support
- **OpenRouter support**: Use OpenRouter API as an alternative AI provider with model selection
- **UI improvements**: Polishing the UI in general. reusable ViewHeader component, fixed thumbnail layout shift, chevron indicators for expandable sections

### 2.3.0

- **Template system**: Added template for video note, and reference for available template variables
- **Updated fetching logics**: Adjusted default fetch limit to 10 and maximum to 50 for better API quota management
- **Full fetch warning**: Added warning when auto note creation is enabled with full fetch mode

### 2.2.0

- **Automatic note creation**: Automatically create video notes for newly liked videos during auto-fetch
- **Daily note linking**: Option to automatically link new video notes to your daily note
- **Full fetch mode**: New option to fetch all liked videos on every auto-fetch (with quota warnings and user confirmation)
- **Template system**: Customize video notes with your own markdown templates
  - Configure template folder and default template
  - Fallback to built-in template option
  - Create example templates with one click

### 2.1.0

- **UI improvements**: Replaced icons with Lucide React icons for better consistency
- **Bug fix**: Fixed duration badge color display

### 2.0.1

- **Type safety**: Improved type safety in PlaylistApi

### 2.0.0

- **Enhanced daily note integration**: Add video entries to daily notes with improved error handling
- **Playlist pinning**: Pin your favorite playlists for quick access
- **Infinite scroll**: Smooth infinite scroll for video loading in playlists
- **Performance optimization**: Video display limit for better performance
- **Improved caching**: Enhanced cache management in PlaylistApi
- **UI refinements**: Updated ribbon icon labels and command names for clarity

