# Geulo: Obsidian용 YouTube 라이브러리와 AI 요약

[![Latest release](https://img.shields.io/github/v/release/zzunebye/obsidian-google-liked-video?label=release)](https://github.com/zzunebye/obsidian-google-liked-video/releases/latest)
[![Obsidian 1.13.0+](https://img.shields.io/badge/Obsidian-1.13.0%2B-7C3AED?logo=obsidian)](https://obsidian.md/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.es.md">Español</a> |
  <strong>한국어</strong>
</p>

**YouTube 라이브러리를 Obsidian 노트에 연결합니다.**

YouTube는 다음 동영상을 계속 보게 만들어져 있습니다. Geulo는 이미 본 동영상을 Obsidian에서 다시 찾고, 노트와 함께 두게 합니다. 좋아요 표시한 동영상, 재생목록, 구독을 가져옵니다. 검색과 필터로 동영상을 찾습니다. 자막을 읽고 AI 요약을 만든 뒤 Markdown 노트로 남깁니다.

> Geulo를 쓰려면 Google OAuth 인증 정보를 직접 준비해야 합니다. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만드세요. YouTube Data API v3를 켜고 OAuth 클라이언트 인증 정보를 발급하세요. 플러그인은 이 인증 정보로 YouTube 계정에 접근합니다. 좋아요 표시한 동영상, 재생목록, 구독을 가져옵니다. 순서는 아래 [요구 사항](#요구-사항)에 있습니다.

## 목차

- [기능](#기능)
- [요구 사항](#요구-사항)
- [AI 요약 설정](#ai-요약-설정)
- [팁](#팁)
- [지원](#지원)
- [릴리스 노트](./README.md#release-notes), 영어

## 기능

- **동영상 가져오기.** 좋아요 표시한 YouTube 동영상을 불러옵니다.
- **재생목록.** 내 YouTube 재생목록을 봅니다. ID로 재생목록을 추가합니다.
- **좋아요 동영상을 재생목록에 추가.** 좋아요 표시한 동영상을 오른쪽 클릭하고 **재생목록에 추가…**를 선택합니다. 검색해서 내 YouTube 재생목록을 고릅니다. Geulo는 이미 들어 있는 동영상인지 확인한 다음 추가합니다. 좋아요는 유지됩니다.
- **검색과 콘텐츠 유형 필터.** 제목, 채널, 태그, 콘텐츠 유형으로 찾고 정렬합니다. 유형은 일반 동영상, 짧은 동영상, 음악입니다.

    > 짧은 동영상 필터는 길이로 나눕니다. YouTube Data API는 동영상에 공식 Shorts 표시를 주지 않습니다. 기준은 설정의 영상 표시에 있는 짧은 동영상 최대 길이입니다. Geulo는 그 길이 이하의 동영상을 짧은 동영상으로 묶습니다. 그 길이 이하의 일반 동영상이 포함될 수 있습니다. 그 길이보다 긴 Shorts는 빠질 수 있습니다.

- **동영상 노트.** 한 번 눌러 동영상 노트를 만들고 메모를 씁니다. 채널별 폴더로 모을 수 있습니다.
- **동영상 노트의 좋아요 상태.** `liked: true`와 `liked: false`는 Geulo에 연결된 YouTube 계정의 마지막 확인 평가입니다. `likes`는 그 동영상의 전체 좋아요 수입니다. Geulo는 카드나 웹 뷰어에서 동영상 노트를 만들거나 열 때 이 값을 확인합니다. 좋아요, 좋아요 취소, 실행 취소, 좋아요 동영상 동기화 뒤에는 기존 노트도 갱신합니다. 최근 동기화는 이번에 가져온 좋아요를 확인합니다. 전체 검사는 가져온 목록 밖의 기존 노트도 확인합니다. 사용자 지정 템플릿에서는 `{{liked}}`를 씁니다. 조회에 실패하거나 상태를 알 수 없으면 Geulo는 기존 값을 두고 새 값은 비워 둡니다. 저장된 목록을 지워도 이 속성은 그대로입니다. 노트에서 이 속성을 고쳐도 YouTube의 좋아요는 그대로입니다.
- **일간 노트.** 한 번 눌러 일간 노트에 동영상 링크를 추가합니다.
- **좋아요 목록 정리.** Obsidian 안에서 좋아요 목록의 동영상을 뺍니다.
- **AI 동영상 요약.** Google Gemini, OpenRouter, OpenAI로 요약을 만듭니다. Gemini는 동영상을 직접 분석합니다. OpenRouter와 OpenAI는 선택한 자막을 요약합니다. 요약에는 접을 수 있는 한 줄 미리보기와 펼칠 수 있는 전체 요약이 있습니다.
- **요약을 노트에 추가.** 만든 AI 요약을 동영상 노트에 붙입니다.
- **자막 읽기.** 좋아요 동영상, 재생목록, 구독의 동영상 카드 메뉴에서 **자막 읽기**를 선택합니다. 이미 있는 YouTube 자막을 타임스탬프 링크와 함께 읽고 텍스트를 복사합니다. 별도의 API 키는 필요 없습니다. Geulo는 앱 언어의 자막을 먼저 고릅니다. 없으면 영어를 고르고, 그다음 쓸 수 있는 첫 언어를 고릅니다. 자막은 비공식 YouTube 경로로 가져옵니다. 일부 동영상에는 자막이 없거나, 요청이 잠시 막힐 수 있습니다. 자막은 열 때 가져옵니다. Geulo는 자막을 자동으로 저장하지 않습니다.
- **동영상 정보.** 한 번 눌러 동영상 정보를 봅니다.
- **채널 이름으로 검색.** 동영상 카드에서 채널을 누르면 그 채널 이름으로 검색합니다.
- **여러 언어.** 인터페이스는 영어, 한국어, 중국어 간체입니다. Geulo는 Obsidian의 언어 설정을 따릅니다. 언어를 바꾼 뒤에는 플러그인을 다시 불러오세요.

[obsidian-google-calendar](https://github.com/YukiGasai/obsidian-google-calendar)를 참고해 만들었습니다.

## 요구 사항

Google Cloud Console에서 프로젝트를 만들고 YouTube Data API v3를 켜야 합니다.

1. **플러그인 설치.** Obsidian 커뮤니티 플러그인에서 "Geulo"를 찾아 설치합니다.
2. **플러그인 켜기.** Obsidian에서 설정, 커뮤니티 플러그인으로 이동해 Geulo를 켭니다.
3. **API 인증 정보.** 아래 순서대로 Google Cloud Console에서 인증 정보를 받습니다.

### Google Cloud Console과 YouTube Data API v3 설정

YouTube Data API v3는 할당량을 사용합니다. 호출 한 번이 하루 허용량에서 단위를 차감합니다. 현금 요금은 없습니다. 비용은 그 단위입니다.

메뉴의 영어 이름을 먼저 적었습니다. 같은 항목의 한국어 콘솔 이름을 뒤에 적었습니다.

#### 1. 프로젝트 만들기

- [Google Cloud Console](https://console.cloud.google.com/)을 엽니다.
- 프로젝트 목록에서 **New Project**를 선택합니다. 한국어 콘솔에서는 새 프로젝트입니다.
- 프로젝트 이름을 입력하고 **Create**를 누릅니다. 한국어 콘솔에서는 만들기입니다.

#### 2. YouTube Data API v3 사용

- **API & Services**, **Library**로 이동합니다. 한국어 콘솔에서는 API 및 서비스, 라이브러리입니다.
- YouTube Data API v3를 검색해 엽니다.
- **Enable**을 누릅니다. 한국어 콘솔에서는 사용 설정입니다.

#### 3. 사용자 인증 정보 만들기

- **API & Services**, **Credentials**로 이동합니다. 한국어 콘솔에서는 API 및 서비스, 사용자 인증 정보입니다.
- **Create Credentials**에서 **OAuth client ID**를 선택합니다. 한국어 콘솔에서는 사용자 인증 정보 만들기, OAuth 클라이언트 ID입니다.
- 동의 화면을 먼저 설정하라는 안내가 나오면 그 화면을 마칩니다.
- 애플리케이션 유형을 **Web application**으로 하고 이름을 입력합니다. 한국어 콘솔에서는 웹 애플리케이션입니다.
- **Authorized JavaScript origins**에 `http://127.0.0.1:42813`을 추가합니다. 한국어 콘솔에서는 승인된 자바스크립트 원본입니다.
- **Authorized redirect URIs**에 `http://127.0.0.1:42813/callback`을 추가합니다. 한국어 콘솔에서는 승인된 리디렉션 URI입니다.
- **Create**를 누른 뒤 클라이언트 ID와 클라이언트 시크릿을 복사합니다.

#### 4. 로그인할 계정 허용

- 이 플러그인용으로 만든 프로젝트의 Google Cloud Console을 엽니다.
- Google Auth Platform의 **Audience**로 이동합니다. 예전 콘솔의 OAuth 동의 화면입니다.
- 다음 값을 확인합니다.
    - **Publishing status**는 **Testing**입니다. 한국어 콘솔에서는 게시 상태가 테스트입니다.
    - **User type**은 **External**입니다. 한국어 콘솔에서는 사용자 유형이 외부입니다.
- **Test users**에서 **Add users**를 누르고, Obsidian에서 쓸 Google 계정을 넣습니다. 한국어 콘솔에서는 테스트 사용자, 사용자 추가입니다. 예는 `yourname@gmail.com`입니다.
- 저장합니다.

> 테스트 상태에서는 7일 뒤에 다시 연결해야 합니다. 권한을 허용한 날부터 7일 뒤에 Geulo의 YouTube 접근 권한과 갱신 토큰이 만료됩니다. 동영상을 계속 가져오려면 Geulo에서 Google 계정을 다시 연결하세요.
>
> 계속 쓰려면 Google Auth Platform의 Audience에서 **Publish app**을 선택합니다. 한국어 콘솔에서는 앱 게시입니다. 상태를 **In production**으로 바꿉니다. 한국어 콘솔에서는 프로덕션입니다. 그다음 Geulo를 다시 연결해 새 토큰을 받으세요. 테스트 상태의 7일 제한은 이때 없어집니다. 토큰은 그 뒤에도 만료되거나 취소될 수 있습니다. 앱 게시와 Google의 앱 인증은 별개입니다. 인증되지 않은 앱 경고와 인증 요건은 남을 수 있습니다. [Google의 게시 상태 안내](https://support.google.com/cloud/answer/15549945?hl=ko)를 참고하세요.

#### 5. 플러그인에 인증 정보 입력

- Obsidian 설정의 Geulo에서 **Google 연결**을 엽니다.
- 넣는 방법은 두 가지입니다.
    - **JSON 가져오기.** Google Auth Platform의 **Clients**에서 OAuth 클라이언트 JSON을 내려받습니다. Geulo에서 **JSON 가져오기**를 누르고 그 파일을 선택합니다. 클라이언트 유형, 프로젝트, 클라이언트 ID를 확인한 다음 **인증 정보 저장**을 누릅니다. 웹 애플리케이션 JSON과 데스크톱 클라이언트 JSON을 사용할 수 있습니다. 서비스 계정 키는 사용할 수 없습니다. Geulo는 파일을 이 기기에서 읽습니다. 클라이언트 시크릿은 Obsidian SecretStorage에 저장됩니다. 이미 연결된 계정이 있으면 인증 정보를 바꾸기 전에 **연결 해제**를 하세요.
    - **직접 입력.** **Google API 인증 정보**를 펼치고 클라이언트 ID와 클라이언트 시크릿을 각 칸에 입력합니다.
- **Google로 연결**을 눌러 로그인합니다. JSON 저장은 로그인까지 진행하지 않습니다. 이 단계에서는 프로젝트의 API와 동의 설정이 맞는지도 확인하지 않습니다.

#### 6. 로그인이 됐는지 확인

- OAuth가 끝나면 브라우저가 `http://127.0.0.1:42813/callback?code=...&scope=...` 형태의 주소를 엽니다.
- 페이지에 다음 문구가 나옵니다.
    > Authentication successful! Please return to Obsidian.
- 그 탭을 닫으면 Obsidian이 로그인된 상태를 표시합니다.

### 문제 해결

1. **인증 정보.** 설정의 클라이언트 ID와 클라이언트 시크릿이 발급받은 값과 같은지 확인합니다.
2. **승인된 URI.** 승인된 자바스크립트 원본에 [http://127.0.0.1:42813](http://127.0.0.1:42813)이 있는지 확인합니다. 승인된 리디렉션 URI에 [http://127.0.0.1:42813/callback](http://127.0.0.1:42813/callback)이 있는지 확인합니다.
3. Google 프로젝트에 권한을 허용하지 못하면, 로그인 창이 여러 개 열려 있는지 확인합니다. 열려 있으면 모두 닫고 다시 시도합니다.

### 로컬에 저장되는 동영상 목록

좋아요 표시한 동영상은 이 플러그인 폴더의 `liked-videos.json`에 있습니다. 설정은 `data.json`에 따로 있습니다. 플러그인을 켤 때 Geulo가 목록을 메모리로 읽습니다. Geulo는 변경을 비동기로 저장합니다. 여러 변경이 겹치면 저장을 한 번으로 합칩니다. 파일을 바꾸기 전에 직전의 정상 파일을 `liked-videos.json.bak`으로 남깁니다.

Geulo는 새 파일을 쓰고 확인한 뒤에, 브라우저 localStorage에 있던 좋아요 동영상을 옮깁니다. 파일이 올바르지 않으면 읽기를 멈추고 빈 목록으로 덮어쓰지 않습니다. 백업을 되돌리거나 JSON을 직접 고치려면 플러그인을 먼저 끄세요. 그다음 `liked-videos.json`을 바꾸고 플러그인을 다시 켜세요. 다른 기기에서 동기화된 파일이 바뀌어도, 켜져 있는 Geulo의 메모리 목록은 그대로입니다. 동기화 뒤에 플러그인을 다시 불러오세요. 두 기기에서 목록을 동시에 고치면 Geulo는 그 수정을 합치지 않습니다. YouTube에서 바뀐 동영상만 받아 오는 기능도 이 저장 방식에 없습니다.

## AI 요약 설정

1. 플러그인 설정에서 **AI 요약 사용**을 켭니다.
2. 제공자를 고릅니다. **Gemini**는 동영상을 직접 분석합니다. **OpenRouter**와 **OpenAI**는 자막으로 요약합니다.
3. 고른 제공자의 API 키를 입력합니다.
4. OpenRouter 또는 OpenAI이면 모델 ID를 선택하거나 입력합니다.
5. 요약 프롬프트를 바꿀 수 있습니다.
6. 동영상 카드의 요약 버튼으로 요약을 만듭니다.

## 팁

코어 플러그인에서 웹 뷰어를 켜면 Obsidian 안에서 YouTube 동영상을 보며 노트를 쓸 수 있습니다.

## 지원

버그와 기능 요청은 [GitHub Issues](https://github.com/zzunebye/obsidian-google-liked-video/issues)에 남겨 주세요.

Geulo가 마음에 들면 [Buy Me a Coffee](https://www.buymeacoffee.com/junyoungbang)에서 개발을 응원할 수 있습니다.

Reddit, X, 쓰는 커뮤니티에 Geulo를 알려 줄 수 있습니다.

Geulo를 써 주셔서 감사합니다.
