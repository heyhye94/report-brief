// 수집 대상 기관 설정
// type: "rss" | "html"
// html 은 selectors.item(행) 안에서 title/link/date/org 를 찾는다. 생략 시 행의 첫 링크·텍스트·날짜 패턴을 자동 사용.
// linkTemplate: 링크가 javascript:goDetail('123') 형태일 때 정규식 캡처로 실제 URL을 만든다.
// idFrom: URL 중 고유 ID가 되는 쿼리 파라미터 (페이지 번호 등이 바뀌어도 같은 보고서로 인식)

export const CATEGORIES = {
  institute: "정출연·연구기관",
  consulting: "컨설팅펌",
  government: "국가부처·공공",
  association: "협회·단체",
};

export const SOURCES = [
  // ── 정출연·연구기관 ─────────────────────────────
  {
    id: "kdi",
    name: "KDI 한국개발연구원",
    category: "institute",
    type: "html",
    url: "https://www.kdi.re.kr/research/reportList",
    selectors: { item: "li:has(> a[href*='reportView?pub_no='])", title: ".rpt_tit strong", link: "a[href*='reportView?pub_no=']" },
    idFrom: "pub_no",
  },
  {
    id: "kiep",
    name: "KIEP 대외경제정책연구원",
    category: "institute",
    type: "html",
    url: "https://www.kiep.go.kr/gallery.es?mid=a10101010000&bid=0001",
    selectors: { item: "div.desc", title: "strong.title", link: "a[href*='act=view']" },
    idFrom: "list_no",
  },
  {
    id: "spri",
    name: "SPRi 소프트웨어정책연구소",
    category: "institute",
    type: "html",
    url: "https://spri.kr/posts?code=data_all",
    selectors: { item: "a[href*='/posts/view/']" },
  },
  {
    id: "kif",
    name: "한국금융연구원",
    category: "institute",
    type: "html",
    url: "https://www.kif.re.kr/kif4/publication/pub_list?mid=10",
    selectors: { item: "a[href*='pub_detail']" },
    idFrom: "cno",
  },

  {
    id: "hri",
    name: "현대경제연구원",
    category: "institute",
    type: "html",
    url: "https://www.hri.co.kr/kor/main",
    selectors: { item: "a[href*='/kor/report/view/']", title: ".inner .txt" },
    noDate: true, // 목록에 날짜가 없고 '26-19호' 같은 호수가 날짜로 잘못 읽힘
    maxItems: 15,
  },
  {
    id: "kb-research",
    name: "KB경영연구소",
    category: "institute",
    type: "html",
    url: "https://www.kbfg.com/kbresearch/report/reportList.do",
    selectors: { item: "li:has(> a[href*='reportView.do?reportId='])", title: "h3", date: "dd" },
    idFrom: "reportId",
    pdfTemplate: { regex: "fn_downFile\\('(\\w+)',\\s*'(\\d+)'\\)", url: "/kbresearch/cmm/fms/FileDown.do?atchFileId=$1&fileSn=$2" },
    maxItems: 15,
  },
  // ── 국가부처·공공 ───────────────────────────────
  {
    id: "korea-expdoc",
    name: "정책브리핑 정책자료(부처 발간 보고서)",
    category: "government",
    type: "html",
    url: "https://www.korea.kr/archive/expDocList.do",
    selectors: { item: "tr:has(td.subject a)", link: "td.subject a", org: "td:nth-child(2)" },
    idFrom: "docId",
    maxItems: 30,
    // 리서치 자료만: 안내서·사례집·도감·발굴보고서·홍보물 등은 제목으로 1차 제외 (최종 판정은 Claude)
    excludeTitle: "안내서|가이드|매뉴얼|사례집|도감|자료집|질의|응답집|바로알기|발굴|홍보|소식지|웹진|매거진|제\\d+호|업무계획|백서",
  },
  {
    id: "bok-finstab",
    name: "한국은행 금융안정 조사연구",
    category: "government",
    type: "rss",
    url: "https://www.bok.or.kr/portal/bbs/B0000257/news.rss?menuNo=200327",
  },
  {
    id: "bok-stat",
    name: "한국은행 통계연구자료",
    category: "government",
    type: "rss",
    url: "https://www.bok.or.kr/portal/bbs/B0000233/news.rss?menuNo=200707",
  },
  {
    id: "bok-industry",
    name: "한국은행 주력산업 모니터링",
    category: "government",
    type: "rss",
    url: "https://www.bok.or.kr/portal/bbs/B0000357/news.rss?menuNo=201127",
  },

  // ── 컨설팅펌 ────────────────────────────────────
  {
    id: "mckinsey",
    name: "McKinsey & Company",
    category: "consulting",
    seed: 3, // 컨설팅 자료를 넉넉히: 첫 수집 시 최신 3건
    type: "rss",
    url: "https://www.mckinsey.com/insights/rss",
    skipDetail: true, // 상세 페이지가 봇 차단(403) → RSS 설명으로 요약
    maxItems: 15,
  },
  {
    id: "ey-korea",
    name: "EY한영",
    category: "consulting",
    seed: 3, // 컨설팅 자료를 넉넉히: 첫 수집 시 최신 3건
    type: "html",
    url: "https://www.ey.com/ko_kr/insights",
    selectors: { item: "a[href^='/ko_kr/insights/']", linkFilter: "^/ko_kr/insights/[^/]+/[^/]+$" },
    maxItems: 15,
  },
  {
    id: "bcg",
    name: "BCG",
    category: "consulting",
    seed: 3, // 컨설팅 자료를 넉넉히: 첫 수집 시 최신 3건
    type: "html",
    url: "https://www.bcg.com/publications",
    selectors: { item: "a[href*='/publications/20']", linkFilter: "^https://www\\.bcg\\.com/publications/20\\d\\d/[^/?#]+$" },
    maxItems: 15,
  },
  {
    id: "strategy-business",
    name: "PwC strategy+business",
    category: "consulting",
    seed: 3, // 컨설팅 자료를 넉넉히: 첫 수집 시 최신 3건
    type: "html",
    url: "https://www.strategy-business.com/",
    selectors: { item: "a[href*='/article/']", linkFilter: "^https://www\\.strategy-business\\.com/article/[^/?#]+$" },
    maxItems: 15,
  },
  {
    id: "samil-pwc",
    name: "삼일PwC",
    category: "consulting",
    seed: 3, // 컨설팅 자료를 넉넉히: 첫 수집 시 최신 3건
    type: "html",
    url: "https://www.pwc.com/kr/ko/insights.html",
    selectors: { item: "a[href*='/kr/ko/insights/']", linkFilter: "/kr/ko/insights/(samil-insight|industry-focus|global-trends)/[^/]+\\.html$" },
    maxItems: 15,
  },

  // ── 협회·단체 ───────────────────────────────────
  {
    id: "kita",
    name: "한국무역협회 국제무역통상연구원",
    category: "association",
    type: "html",
    url: "https://www.kita.net/researchTrade/report/reportMain/reportMainList.do",
    selectors: { item: "li:has(.subject a)", link: ".subject a", title: ".subject a" },
    linkTemplate: {
      regex: "goDetailPage\\('(\\d+)',\\s*'(\\w+)'\\)",
      url: "https://www.kita.net/researchTrade/report/{2}Detail.do?no=$1",
      map: {
        TRADE_FOCUS: "tradeFocus/tradeFocus",
        TRADE_BRIEF: "tradeBrief/tradeBrief",
        TRADE_REPORT: "commerceReport/commerceReport",
        ISSUE_BRIEF: "issueBrief/issueBrief",
      },
    },
    idFrom: "no",
  },
  {
    id: "kcci",
    name: "대한상공회의소",
    category: "association",
    type: "html",
    url: "https://www.korcham.net/nCham/Service/Economy/appl/KcciReportList.asp",
    selectors: { item: "tr:has(td.tl a)", link: "td.tl a", date: ".date" },
    linkTemplate: {
      regex: "goDetail\\('(\\d+)','(\\w+)'\\)",
      url: "https://www.korcham.net/nCham/Service/Economy/appl/KcciReportDetail.asp?SEQ_NO_C010=$1&CHAM_CD=$2",
    },
    idFrom: "SEQ_NO_C010",
  },
];
