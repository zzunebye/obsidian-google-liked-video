# Architecture

## Project Structure

```text
my-app/
├── src/
│   ├── components/
│   ├── pages/
│   ├── utils/
│   └── ...
```

## Data Fetching flow from API

```text
LikedVideoApi
  ├── likedVideoFetchService
    └── 기존 데이터와 병합
  ├── localStorageService
    └── LikedVideoStorageService
  ├── liked-videos.json
  ├── listener
  ├── VideosProvider
  └── LikedVideoView
```
