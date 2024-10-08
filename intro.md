사용자가 유튜브에서 좋아요를 누른 영상들을 가져와서 해당 날짜에 따라서 Daily Note에 삽입하는 플러그인.

## 요구사항

### 기능

- 사용자는 개인 API key를 통해 이 플러그인이 사용자 자신의 유튜브 플랫폼 데이터를 가져올 수 있도록 한다.
- 사용자가 유튜브에서 '좋아요'를 누를 경우, 플러그인은 이를 좋아요가 눌린 날짜의 Daily Note에 삽입한다.
- 사용자는 한번에 지금까지 누른 모든 유튜브 영상에 대한 좋아요 데이터를 모두 가져와 해당 날짜의 Daily Note들에 batch-update 할 수 있다.
- 사용자는 Obsidian 오른쪽 View (Sidebar)에서 지금까지 Like한 모든 비디오를 목록으로서 보고 검색할 수 있다.

### 비기능

- 사용자가 API key를 가져와서 설정 창에 입력하면, 플러그인은 자연스럽게 작동해야한다.
- 플러그인은 너무 많은 API 호출을 사용하지 말아야한다.