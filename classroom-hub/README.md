# 통합 교실 컨트롤 허브

컨트롤러 UI · HUD(학생 화면) · 소리센터 · 참여게임 · 호출, 5개 모듈이 Firebase 실시간 state를
공유하는 통합 교실 관리 시스템입니다. 모두 정적 HTML 파일이라 GitHub Pages에 그대로 올려서 씁니다.

## 파일 구성

```
classroom-hub/
├── controller.html      교사용 컨트롤러 (프리셋/직접 설정, 시작·일시정지·재개·종료, TTS 방송)
├── hud.html              학생 화면 — 대기화면(시계·급식·시간표·학사일정) ↔ 활동 진행화면 ↔ 호출 알림화면
├── sound-center.html     마이크 기반 소음 레벨 표시(캐릭터 표정) + 기준 초과 시 음성 경고
├── participation.html    모둠/학생 포인트판 + 랜덤 뽑기
├── call.html              교무실 등에서 HUD로 호출을 보내는 발신 화면
├── shared/
│   ├── classroom-hub-common.js   Firebase 초기화, 학교/학급 상수, Firestore 헬퍼
│   └── neis.js                   NEIS Open API(급식/시간표/학사일정/학교코드조회) 래퍼
└── README.md
```

## 1) Firebase 프로젝트 설정

1. [Firebase 콘솔](https://console.firebase.google.com)에서 새 프로젝트를 만듭니다.
   (기존 `tool-1afe7`처럼 이미 쓰고 있는 프로젝트를 재사용해도 됩니다 — 새 컬렉션만 추가되는 방식이라 안전합니다.)
2. **Firestore Database**를 네이티브 모드로 활성화합니다.
3. **Authentication → Sign-in method**에서 **익명(Anonymous)** 로그인을 켭니다.
   (학생 화면·교사 화면 모두 별도 로그인 없이 익명 인증으로 Firestore에 접근합니다.)
4. 프로젝트 설정 → "내 앱" → 웹 앱 추가 후 SDK 설정값을 복사합니다.
5. `shared/classroom-hub-common.js` 상단의 `firebaseConfig` 객체를 그 값으로 교체합니다.

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

값을 넣기 전까지는 각 페이지 상단에 "Firebase 설정값 미입력" 배너가 뜨고, 실시간 동기화 없이
화면 UI만 미리 볼 수 있는 상태로 동작합니다.

### Firestore 보안 규칙 예시

콘솔 → Firestore Database → 규칙 에 아래처럼 설정하세요(익명 로그인 사용자만 읽고 쓸 수 있게 제한).

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /classroomHub_state/{doc}       { allow read, write: if request.auth != null; }
    match /classroomHub_presets/{doc}     { allow read, write: if request.auth != null; }
    match /classroomHub_participation/{doc} { allow read, write: if request.auth != null; }
    match /calls/{doc}                    { allow read, write: if request.auth != null; }
  }
}
```

## 2) NEIS Open API 인증키 발급 (급식·시간표·학사일정용)

1. [open.neis.go.kr](https://open.neis.go.kr) 접속 후 회원가입 · 로그인합니다.
2. 상단 메뉴에서 **인증키 신청**으로 들어갑니다.
3. 활용 목적에 "학급 HUD 대기화면에 급식/시간표/학사일정 표시" 정도로 간단히 작성 후 신청합니다.
4. 승인되면 마이페이지에서 인증키(KEY)를 확인할 수 있습니다.
5. `shared/neis.js`의 `NEIS_KEY` 값을 발급받은 키로 교체합니다.

키 없이도 호출 자체는 되지만, 트래픽 제한이 매우 낮아 여러 반에서 동시에 쓰면 바로 막힐 수
있으니 실사용 전에는 꼭 발급을 권장합니다.

> **CORS 관련 참고**: 브라우저에서 NEIS API를 직접 호출하는 방식이라, NEIS 서버 상태에 따라
> 간헐적으로 CORS가 막히는 사례가 보고됩니다. 이런 경우 Firebase Cloud Functions 등으로
> 아주 간단한 프록시(요청을 그대로 NEIS에 전달만 하는 함수) 하나를 두고, `shared/neis.js`의
> `NEIS_BASE` 값만 그 프록시 주소로 바꿔주면 해결됩니다.

## 3) 학교 / 학급 구조 설정

`shared/classroom-hub-common.js`의 아래 값을 학교 상황에 맞게 수정하세요.

```js
export const SCHOOL = {
  name: "한일여자고등학교",   // NEIS 학교코드 조회에 쓰이는 학교명
  atptOfcdcScCode: "",        // (선택) 학교코드 조회가 안 될 때 수동 입력
  sdSchulCode: ""
};

export const CLASSES_PER_GRADE = {
  1: [1,2,3,4,5,6,7,8,9,10],
  2: [1,2,3,4,5,6,7,8,9,10],
  3: [1,2,3,4,5,6,7,8,9,10]
};
```

`hud.html`은 최초 접속 시 NEIS에서 학교명으로 학교코드를 자동 조회해 브라우저에 캐시해둡니다.
학교명이 여러 건으로 검색되면(동명 학교) 첫 번째 결과를 사용하므로, 콘솔 로그를 확인하고
필요하면 `atptOfcdcScCode` / `sdSchulCode`를 직접 채워 넣어 확정하는 걸 권장합니다.

## 4) 사용 흐름

- **hud.html** — 교실 스마트 TV/모니터에 띄워두는 화면입니다. 학급은
  `hud.html?grade=2&class=9` 처럼 URL 파라미터로 지정하는 걸 권장합니다(TV마다 다른 학급 표시 가능).
  평소엔 대기화면(시계·급식·시간표·학사일정) → 컨트롤러가 활동을 시작하면 진행화면 →
  호출이 오면 즉시 알림화면으로 전환되고, "확인했어요"를 누르면 원래 화면으로 돌아갑니다.
- **controller.html** — 교사가 태블릿/PC에서 프리셋 선택 또는 직접 설정으로 활동을 시작·일시정지·
  재개·종료하고, 즉시 음성 안내(TTS)를 HUD에 보낼 수 있습니다.
- **sound-center.html / participation.html** — 같은 교실의 보조 화면(빔프로젝터, 태블릿 등)으로 열어두고 씁니다.
- **call.html** — 교무실·행정실 PC에서 열어 교사명/근무위치/메시지와 대상 학급(전체 또는 특정 학급들)을
  선택해 호출을 보냅니다. 대상 HUD가 즉시 알림화면으로 전환됩니다.

모든 페이지는 `?grade=`, `?class=` URL 파라미터 또는 브라우저 localStorage로 학급을 공유하므로,
한 번 설정해두면 컨트롤러/소리센터/참여게임은 마지막으로 선택한 학급을 그대로 이어서 씁니다.

## 5) 배포

이 저장소는 이미 GitHub Pages로 배포되어 있으므로, `classroom-hub/` 폴더를 커밋·푸시하면
`https://<도메인>/classroom-hub/controller.html` 같은 경로로 바로 접속할 수 있습니다.
