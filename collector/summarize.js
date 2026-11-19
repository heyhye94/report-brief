// 보고서 요약·인사이트 / 일일 종합 브리핑 생성
// 백엔드 2가지:
//   - ANTHROPIC_API_KEY 가 있으면 Claude API (사용량만큼 과금)
//   - 없으면 로그인된 Claude Code CLI (`claude -p`) — Claude 구독 사용량으로 처리, 추가 과금 없음
import { spawn } from "node:child_process";

const BACKEND = process.env.SUMMARY_BACKEND || (process.env.ANTHROPIC_API_KEY ? "api" : "cli");
const MODEL = process.env.CLAUDE_MODEL || (BACKEND === "api" ? "claude-opus-5-5" : "");
let client;
export const backendName = BACKEND;

// 피드에 담는 주제. "기타"로 분류되면 피드에서 뺀다.
export const TOPICS = ["경제", "정책", "IT", "테크", "사회", "문화", "국제정세", "부동산", "시장전망"];

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_report", "topic", "one_line", "key_points", "insights", "implications", "keywords", "audience"],
  properties: {
    is_report: {
      type: "boolean",
      description: "연구·분석 보고서, 조사·통계 결과, 동향 분석이면 true. 행사·인사·홍보 보도자료, 안내서·사례집·매뉴얼, 발굴·도감 같은 기록물이면 false",
    },
    topic: {
      type: "string",
      enum: [...TOPICS, "기타"],
      description:
        "가장 가까운 주제 하나. 경제=거시경제·금융·산업·무역, 정책=정부 정책·제도·규제, IT=소프트웨어·디지털 전환·통신·플랫폼, 테크=AI·반도체·로봇·모빌리티 등 신기술, 사회=인구·노동·복지·교육·불평등, 문화=콘텐츠·관광·예술·소비 트렌드, 국제정세=외교·안보·지정학·주요국 정치경제, 부동산=주택·건설·도시·토지, 시장전망=경기·물가·금리·업황 전망. 특정 업종의 실무 노하우, 기업 내부 경영관리·조직문화·리더십 칼럼, 보건의료·농축산 기술처럼 위 주제와 거리가 멀면 기타",
    },
    one_line: { type: "string", description: "핵심 한 문장, 40자 안팎, ~해요체" },
    key_points: { type: "array", items: { type: "string" }, description: "핵심 내용 3개, 각 한 문장, 중요한 수치 포함" },
    insights: { type: "array", items: { type: "string" }, description: "그래서 무슨 의미인지 1~2개, 각 한 문장" },
    implications: { type: "string", description: "실무자가 챙길 점 한두 문장" },
    keywords: { type: "array", items: { type: "string" }, description: "키워드 3개" },
    audience: { type: "string", description: "꼭 읽을 사람 (짧게, 예: 반도체 수출기업)" },
  },
};

const DIGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "themes", "insights", "watch"],
  properties: {
    headline: { type: "string", description: "오늘 보고서 전체를 꿰는 한 줄, 30자 안팎, ~해요체" },
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "report_ids"],
        properties: {
          title: { type: "string", description: "짧은 테마 이름" },
          summary: { type: "string", description: "관련 보고서를 묶어 한두 문장으로, ~해요체" },
          report_ids: { type: "array", items: { type: "string" } },
        },
      },
      description: "공통 테마 2~3개",
    },
    insights: { type: "array", items: { type: "string" }, description: "여러 기관 보고서를 함께 보면 보이는 점 2개, 각 한 문장" },
    watch: { type: "array", items: { type: "string" }, description: "앞으로 지켜볼 것 2개, 각 짧게" },
  },
};

const SYSTEM = `당신은 정책·산업 보고서를 쉽게 풀어 주는 리서치 애널리스트예요. 정부출연연구기관, 컨설팅펌, 정부부처, 협회가 낸 보고서를 읽고 바쁜 사람이 1분 안에 핵심을 잡도록 한국어로 정리해요.
문체와 길이:
- 모든 문장은 "~해요", "~예요", "~있어요" 같은 해요체로 끝내요. "~함", "~임" 같은 명사형 종결이나 "~한다"체는 쓰지 않아요.
- 짧고 쉽게 써요. 한 문장에 한 가지 내용만 담고, 전문 용어는 풀어 쓰거나 꼭 필요할 때만 써요.
- 배경 설명, 수식어, 같은 말 반복은 빼고 핵심만 남겨요.
정확성:
- 원문에 있는 사실과 수치만 써요. 원문에 없는 내용은 추측하지 않아요.
- 영어 보고서도 한국어로 정리해요.
- 인사이트는 요약을 되풀이하지 말고 "그래서 무엇을 뜻하는지"에 답해요.`;

export async function callJson(schema, userContent, maxTokens = 8000) {
  return BACKEND === "api" ? callApi(schema, userContent, maxTokens) : callCli(schema, userContent);
}

async function callApi(schema, userContent, maxTokens) {
  if (!client) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic();
  }
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: userContent }],
  });
  if (res.stop_reason === "refusal") throw new Error("모델이 요약을 거절했습니다");
  if (res.stop_reason === "max_tokens") throw new Error("응답이 max_tokens에서 잘렸습니다");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: JSON.parse(text), usage: res.usage };
}

// Claude Code 헤드리스 모드: 도구 없이, 세션 기록 없이, 구조화 출력(JSON 스키마)으로 호출
function callCli(schema, userContent) {
  const args = [
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--tools", "",
    "--system-prompt", SYSTEM,
    "--json-schema", JSON.stringify(schema),
  ];
  if (MODEL) args.push("--model", MODEL);
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || "claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("claude CLI 시간 초과(5분)")); }, 300000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`claude CLI 실행 실패: ${e.message}`)); });
    child.on("close", () => {
      clearTimeout(timer);
      let res;
      try { res = JSON.parse(out); } catch { return reject(new Error(`claude CLI 응답 해석 실패: ${(err || out).slice(0, 300)}`)); }
      if (res.is_error || !res.structured_output) return reject(new Error(`claude CLI 오류: ${String(res.result).slice(0, 300)}`));
      resolve({ data: res.structured_output, usage: res.usage ?? { input_tokens: 0, output_tokens: 0 } });
    });
    child.stdin.end(userContent);
  });
}

export async function summarizeReport(item, source, detail) {
  const parts = [
    `기관: ${source.name}${item.org ? ` / 발간처: ${item.org}` : ""}`,
    `제목: ${item.title}`,
    `발간일: ${item.date ?? "미상"}`,
    `URL: ${item.url}`,
  ];
  if (item.snippet) parts.push(`\n[목록 설명]\n${item.snippet}`);
  if (detail?.pageText) parts.push(`\n[상세 페이지 본문]\n${detail.pageText}`);
  if (detail?.pdfText) {
    const note = detail.truncated
      ? `(전체 ${detail.pdfPages ?? "?"}쪽 중 앞부분만 발췌 — 요약은 발췌 범위 기준임을 감안)`
      : "";
    parts.push(`\n[PDF 본문 ${note}]\n${detail.pdfText}`);
  }
  if (!detail?.pageText && !detail?.pdfText) parts.push("\n(본문을 가져오지 못해 제목·설명만 제공됨. 과장 없이 확인 가능한 범위만 요약)");
  if (source.category === "government")
    parts.push("\n(정부·공공기관 자료는 연구·분석 보고서, 조사·통계 결과, 경제·산업 동향만 is_report=true로 판단해요. 안내서, 사례집, 매뉴얼, 도감, 홍보물, 정책 홍보성 보도자료는 false예요.)");
  parts.push("\n위 보고서를 스키마에 맞춰 쉽고 짧게, 해요체로 정리해 주세요.");
  return callJson(REPORT_SCHEMA, parts.join("\n"));
}

export async function buildDigest(date, reports) {
  const lines = reports.map(
    (r) =>
      `- id=${r.id} | ${r.sourceName} | ${r.title}\n  요약: ${r.summary.one_line}\n  인사이트: ${r.summary.insights.join(" / ")}`
  );
  const prompt = `${date}에 새로 발간된 보고서 ${reports.length}건입니다.\n\n${lines.join("\n")}\n\n이 보고서들을 묶어 '오늘의 브리핑'을 쉽고 짧게, 해요체로 써 주세요. 공통 테마와 여러 기관을 함께 봐야 보이는 점에 집중해요. report_ids에는 위 id 값을 그대로 써요.`;
  return callJson(DIGEST_SCHEMA, prompt, 8000);
}
