# 리포트 브리프

정출연·컨설팅펌·국가부처·협회가 **그날 새로 발간한 보고서**를 매일 수집해 Claude로 요약하고, 기관을 가로지르는 인사이트를 정리해 보여주는 PWA입니다.

```
GitHub Actions (매일 12:00 KST)
  └ collector/run.js
       1. 기관별 목록 수집 (RSS / HTML)      ← collector/sources.js
       2. 처음 보는 보고서만 골라 본문·PDF 추출
       3. Claude: 보고서별 요약·인사이트 → 일일 종합 브리핑
       4. web/data/*.json 저장 → 커밋
  └ web/ 를 GitHub Pages에 배포 (정적 PWA, 오프라인 지원)
```

## 폴더 구조

| 경로 | 설명 |
|---|---|
| `collector/sources.js` | 수집 기관 설정 (여기만 고치면 기관 추가/삭제) |
| `collector/fetchers.js` | RSS·HTML 목록 파서, 상세 페이지·PDF 텍스트 추출 |
| `collector/summarize.js` | Claude API 호출 (구조화 JSON 출력) |
| `collector/run.js` | 일일 파이프라인 |
| `collector/probe.js` | 기관 설정 점검 도구 |
| `web/` | PWA (index.html, app.js, sw.js, manifest) |
| `web/data/` | 생성된 데이터: `index.json`, `days/YYYY-MM-DD.json`, `state.json`(이미 본 보고서) |

## 로컬 실행

```bash
npm install
claude auth login        # Claude 구독 계정으로 Claude Code CLI 로그인 (한 번만)
npm run collect          # 수집 + 요약
npm run dev              # http://localhost:4173
```

요약 백엔드는 자동으로 고릅니다.

| 조건 | 백엔드 | 비용 |
|---|---|---|
| `ANTHROPIC_API_KEY` 없음 (기본) | Claude Code CLI (`claude -p`) | Claude 구독 사용량에 포함, 추가 과금 없음 |
| `.env` 에 `ANTHROPIC_API_KEY` 있음 | Claude API (`claude-opus-5-5`) | 사용한 토큰만큼 과금 |

강제로 고르려면 `SUMMARY_BACKEND=cli` 또는 `api`, 모델은 `CLAUDE_MODEL` 로 지정합니다.

기타 명령:

- `node collector/run.js --dry-run` — 새로 잡힌 보고서 목록만 출력 (API 호출·저장 없음)
- `npm run preview` (`--no-ai`) — API 키 없이 목록만 저장해서 화면 확인
- `node collector/run.js --only=kdi,kita` — 특정 기관만
- `npm run probe -- kdi --detail` — 기관 설정이 제대로 긁히는지 점검

## 배포 (GitHub Pages)

1. 이 폴더로 GitHub 저장소를 만들고 push
2. 터미널에서 `claude setup-token` 을 실행해 장기 토큰을 만들고, **Settings → Secrets and variables → Actions** 에 `CLAUDE_CODE_OAUTH_TOKEN` 으로 등록 (API로 쓰려면 대신 `ANTHROPIC_API_KEY`)
3. **Settings → Pages → Source** 를 `GitHub Actions` 로 지정
4. **Actions → daily-brief → Run workflow** 로 첫 실행 → 이후 매일 자동
5. 배포된 주소를 휴대폰에서 열고 "홈 화면에 추가"하면 앱처럼 사용

## 푸시 알림

새 보고서가 수집되면 설치한 PWA로 알림이 와요 (Web Push, 서버 없음).

1. 앱 오른쪽 위 🔔 → **알림 켜기** (아이폰은 홈 화면에 추가한 앱에서, iOS 16.4 이상)
2. 화면에 나온 **알림 코드**를 복사해 GitHub **Settings → Secrets → Actions** 에 `PUSH_SUBSCRIPTIONS` 로 등록
3. **Actions → push-test → Run workflow** 로 테스트 알림 확인

- 여러 기기는 코드를 줄바꿈으로 이어서 한 Secret 에 넣어요.
- 발송은 `collector/notify.js`, 키는 `web/push-config.json`(공개키)과 `VAPID_PRIVATE_KEY` Secret(비밀키)이에요.

## 수집 기관 (17곳)

| 분야 | 기관 |
|---|---|
| 정출연·연구기관 | KDI, KIEP, SPRi, 한국금융연구원, 현대경제연구원, KB경영연구소 |
| 국가부처·공공 | 정책브리핑 정책자료(부처 발간 리서치 자료만), 한국은행(금융안정·통계연구·주력산업 모니터링) |
| 컨설팅펌 | McKinsey(RSS), BCG, PwC strategy+business, 삼일PwC, EY한영 |
| 협회·단체 | 한국무역협회 국제무역통상연구원, 대한상공회의소 |

수집 동작 방식:

- 주제는 경제·시장전망·정책·IT·테크·국제정세·부동산·사회·문화 9가지예요. Claude가 주제를 하나 붙이고, 어디에도 안 맞으면(`기타`) 피드에서 뺍니다.
- 처음 추가된 기관은 최근 14일 안의 최신 2건(컨설팅펌은 3건)만 요약하고, 나머지 과거 자료는 '이미 본 것'으로 처리합니다.
- 기관당 1회 최대 5건까지 요약합니다 (`--max-per-source`).
- 행사·인사 같은 보도자료는 Claude가 `is_report: false`로 판단해 피드에서 뺍니다.
- 국가부처·공공은 연구·분석 보고서, 조사·통계, 동향 자료만 넣습니다. 안내서·사례집·도감 등은 제목(`excludeTitle`)으로 먼저 거르고, Claude가 한 번 더 판정합니다.
- 요약은 쉽고 짧게, 해요체로 씁니다 (`collector/summarize.js` 의 `SYSTEM` 프롬프트).
- PDF는 앞 25쪽(최대 4만 자)만 읽습니다. 잘린 경우 카드에 "앞부분 기준 요약"이라고 표시됩니다.
- McKinsey 상세 페이지는 봇 접근을 막아(403) RSS 설명만으로 요약합니다.

### 기관 추가하기

`collector/sources.js` 에 항목을 추가하고 `npm run probe -- <id> --detail` 로 확인하세요.

```js
{
  id: "kiet",
  name: "산업연구원",
  category: "institute",          // institute | consulting | government | association
  type: "html",                   // 또는 "rss"
  url: "https://...목록 페이지",
  selectors: { item: "li.row", title: ".tit", link: "a", date: ".date" },
  idFrom: "seq",                  // URL 안에서 보고서 고유번호가 되는 파라미터
}
```

링크가 `javascript:goDetail('123')` 형태인 사이트는 `linkTemplate` 으로 실제 URL을 만들 수 있습니다 (대한상의, 무역협회 설정 참고).
목록을 JavaScript로 그리는 사이트(산업연구원, BCG, Bain, PwC 등)는 지금 방식으로는 못 읽어서 MVP에서 뺐습니다.

## 비용 감각

- **구독(CLI) 모드**: 추가 비용 없음. 대신 Claude 구독의 사용량 한도를 함께 씁니다 (하루 15~20건 요약 + 종합 1건).
- **API 모드**: `claude-opus-5-5`($4 / $20 per 1M tokens) 기준, 보고서 1건에 입력 약 1.5~2만 토큰 → 하루 15~20건이면 대략 **하루 $1~2** 추정.
