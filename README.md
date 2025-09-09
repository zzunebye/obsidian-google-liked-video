# Geulo - YouTube Liked Video Plugin

Transform your YouTube liked videos into a powerful knowledge management system within Obsidian.

Geulo seamlessly fetches, organizes, and integrates your liked videos in YouTube directly into your Obsidian workflow. Perfect for researchers, content creators, and knowledge workers who believe that revisiting quality content is as valuable as discovering new material.

**Why Geulo?** Instead of letting your liked videos disappear into YouTube's depths, Geulo brings them into your personal knowledge base where you can search, sort, and reference them alongside your notes. Turn passive video consumption into active knowledge building.

**Key capabilities:**

- Instantly access your entire YouTube liked video collection
- Smart search and sorting to rediscover forgotten gems  
- One-click integration with your daily notes
- Curate your collection by removing videos directly from the sidebar

*Features are still at its early stages - your feedback shapes the future.* Connect with us at [zzunebye@gmail.com](mailto:zzunebye@gmail.com) or open an issue for suggestions.

## Features

### ✅ Available Now
- **Video retrieval**: Access your entire YouTube liked video history
- **Smart sidebar interface**: Search, filter, and sort your videos with multiple options. Search is based on the video title, channel title, and tags.
- **Create Video Notes**: Create video notes with a single click and write your own notes. You can also organize them by channel.
- **Daily note integration**: Add videos to your daily notes with a single click
- **Collection curation**: Remove videos from your liked list directly within Obsidian
- **Video info display**: Display video info with a single click
- **Search by channel name**: Search by channel title when channel is clicked in the video card

### 🔄 Coming Soon
- **Batch processing**: Bulk import and organize your entire video collection
- **Trending insights**: Surface your most-watched and popular videos

It is inspired by the [obsidian-google-calendar](https://github.com/YukiGasai/obsidian-google-calendar) plugin.

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

#### 4. Enter Credentials in Plugin

- Open Obsidian and go to the settings of the YouTube Liked Videos plugin.
- Enter your Client ID and Client secret in the respective fields.
- Click "Login" to login to your Google account.

### Troubleshooting

If you encounter any issues, consider the following steps:

1. **Credentials**: Double-check that your Client ID and Client secret are correctly entered in the plugin settings.
2. **Authorized URIs**: Verify that http://127.0.0.1:42813 is listed in the Authorized JavaScript origins and http://127.0.0.1:42813/callback in the Authorized redirect URIs.
3. If granting permission to your google project fails, check if there are multiple window/tabs for login process opened. If so, close all of them and try again.

