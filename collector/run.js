// 일일 수집 파이프라인
//   node collector/run.js            수집 → 요약 → web/data 갱신
//   node collector/run.js --dry-run  새 보고서 목록만 출력 (API 호출·저장 없음)
//   node collector/run.js --no-ai    API 호출 없이 신규 목록만 저장 (요약 없음)
//   옵션: --only=kdi,kiep  --max-per-source=5
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { SOURCES, CATEGORIES } from "./sources.js";
import { fetchList, fetchDetail } from "./fetchers.js";

const DATA_DIR = path.resolve(import.meta.dirname, "../web/data");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const DRY = !!args["dry-run"];
const NO_AI = !!args["no-ai"]; // API 키 없이 목록만 저장 (요약은 비워 둠)
const MAX_PER_SOURCE = Number(args["max-per-source"] ?? 5);
const SEED_PER_SOURCE = 2; // 처음 추가된 기관은 최신 2건만 요약하고 나머지는 '본 것'으로 처리
const only = args.only ? String(args.only).split(",") : null;

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");
}
const shortId = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10);

async function main() {
  const statePath = path.join(DATA_DIR, "state.json");
  const state = await readJson(statePath, { seen: {} });
  const sources = SOURCES.filter((s) => !only || only.includes(s.id));

  // 1) 목록 수집 & 신규 판별
  const queue = [];
  const health = {};
  for (const source of sources) {
    try {
      const items = await fetchList(source);
      const seen = new Set(state.seen[source.id] || []);
      const isFirst = !state.seen[source.id];
      let fresh = items.filter((it) => !seen.has(it.id));
      if (isFirst) {
        // 첫 수집: 최근 14일 이내(날짜 미상 포함) 최신 2건만
        const cutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
        fresh = fresh.filter((it) => !it.date || it.date >= cutoff).slice(0, source.seed ?? SEED_PER_SOURCE);
      }
      fresh = fresh.slice(0, MAX_PER_SOURCE);
      health[source.id] = { ok: true, listed: items.length, new: fresh.length };
      console.log(`${source.id}: 목록 ${items.length}건, 신규 ${fresh.length}건${isFirst ? " (첫 수집)" : ""}`);
      for (const it of fresh) queue.push({ item: it, source });
      if (!DRY) {
        // 목록에 보인 항목은 모두 '본 것'으로 기록 (첫 수집 시 과거 자료 폭주 방지)
        state.seen[source.id] = [...new Set([...items.map((i) => i.id), ...seen])].slice(0, 500);
      }
    } catch (e) {
      health[source.id] = { ok: false, error: e.message };
      console.warn(`⚠️  ${source.id}: ${e.message}`);
    }
  }

  if (DRY) {
    for (const { item, source } of queue) console.log(`  [${source.id}] ${item.date ?? ""} ${item.title}`);
    return;
  }

  // 2) 본문 추출 & 요약
  const { summarizeReport, buildDigest, backendName } = NO_AI ? {} : await import("./summarize.js");
  if (!NO_AI) console.log(`요약 백엔드: ${backendName === "api" ? "Claude API" : "Claude Code CLI(구독)"}`);
  const dayPath = path.join(DATA_DIR, "days", `${today}.json`);
  const day = await readJson(dayPath, { date: today, reports: [], digest: null });
  const usage = { input: 0, output: 0 };

  for (const { item, source } of queue) {
    let detail = null;
    if (!source.skipDetail && !NO_AI) {
      try {
        detail = await fetchDetail(item, source);
      } catch (e) {
        console.warn(`   본문 실패 [${source.id}] ${item.title}: ${e.message}`);
      }
    }
    try {
      const { data, usage: u } = NO_AI
        ? { data: { is_report: true, pending: true }, usage: { input_tokens: 0, output_tokens: 0 } }
        : await summarizeReport(item, source, detail);
      usage.input += u.input_tokens;
      usage.output += u.output_tokens;
      if (!data.is_report || data.topic === "기타") {
        const rid = shortId(source.id + item.id);
        day.reports = day.reports.filter((r) => r.id !== rid); // 미리보기로 들어간 항목도 제거
        console.log(`   – ${data.is_report ? "관심 주제 밖" : "보고서 아님"}, 제외: ${item.title}`);
        continue;
      }
      const { is_report, topic, ...summary } = data;
      // 모델이 문자열 전체를 따옴표로 감싸는 경우 정리
      for (const k of ["one_line", "implications", "audience"])
        if (typeof summary[k] === "string") summary[k] = summary[k].trim().replace(/^["“](.*)["”]$/s, "$1");
      day.reports.push({
        id: shortId(source.id + item.id),
        sourceId: source.id,
        sourceName: source.name,
        category: source.category,
        topic: topic ?? null,
        org: item.org || null,
        title: item.title,
        url: item.url,
        pdfUrl: detail?.pdfUrl ?? null,
        publishedAt: item.date ?? null,
        partial: !!detail?.truncated,
        summary: summary.pending ? null : summary,
      });
      console.log(`   ✓ ${source.id}: ${item.title}`);
    } catch (e) {
      console.warn(`   요약 실패 [${source.id}] ${item.title}: ${e.message}`);
      // 실패한 항목은 다음 실행에서 재시도하도록 '본 것' 목록에서 제거
      state.seen[source.id] = (state.seen[source.id] || []).filter((id) => id !== item.id);
    }
  }

  // 3) 일일 종합 브리핑
  // 같은 날 재실행 시 중복 제거
  day.reports = [...new Map(day.reports.map((r) => [r.id, r])).values()];
  if (!NO_AI && day.reports.filter((r) => r.summary).length >= 2) {
    try {
      const { data, usage: u } = await buildDigest(today, day.reports.filter((r) => r.summary));
      usage.input += u.input_tokens;
      usage.output += u.output_tokens;
      day.digest = data;
    } catch (e) {
      console.warn(`종합 브리핑 실패: ${e.message}`);
    }
  }
  day.generatedAt = new Date().toISOString();

  // 4) 저장
  if (day.reports.length) await writeJson(dayPath, day);
  if (!NO_AI) await writeJson(statePath, state); // 미리보기 모드는 '본 것' 기록을 남기지 않음

  const index = await readJson(path.join(DATA_DIR, "index.json"), { days: [] });
  const days = index.days.filter((d) => d.date !== today);
  if (day.reports.length) days.unshift({ date: today, count: day.reports.length, headline: day.digest?.headline ?? null });
  days.sort((a, b) => b.date.localeCompare(a.date));
  await writeJson(path.join(DATA_DIR, "index.json"), {
    updatedAt: new Date().toISOString(),
    categories: CATEGORIES,
    sources: SOURCES.map(({ id, name, category, url }) => ({ id, name, category, url, health: health[id] ?? null })),
    days: days.slice(0, 120),
  });

  console.log(`\n완료: ${today} 보고서 ${day.reports.length}건 | 토큰 in ${usage.input} / out ${usage.output}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
