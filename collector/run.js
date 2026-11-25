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

const KST = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" });
const today = KST.format(new Date());
// 발간 42시간 이내 자료만 포함. 발간일은 '날짜'만 알 수 있으므로 그날 0시(KST)가
// 지금으로부터 42시간 안에 있는 날짜만 받는다 → 낮 12시 실행이면 어제·오늘 발간분
const WINDOW_HOURS = 42;
const cutoff = KST.format(new Date(Date.now() - (WINDOW_HOURS - 24) * 3600e3));
const normTitle = (t) => (t || "").toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");

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
      // 목록에 날짜가 있으면 42시간 기준을 바로 적용 (날짜 없는 항목은 상세 페이지에서 확인)
      const old = fresh.filter((it) => it.date && it.date < cutoff).length;
      fresh = fresh.filter((it) => !it.date || it.date >= cutoff);
      if (isFirst) fresh = fresh.slice(0, source.seed ?? SEED_PER_SOURCE);
      fresh = fresh.slice(0, MAX_PER_SOURCE);
      if (old) console.log(`   (${cutoff} 이전 발간 ${old}건 제외)`);
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
  const added = []; // 이번 실행에서 새로 요약된 보고서 (푸시 알림용)

  // 다른 날짜에 이미 실린 보고서는 다시 싣지 않음 (같은 링크·ID·제목)
  const known = { ids: new Set(), urls: new Set(), titles: new Set() };
  const remember = (r) => { known.ids.add(r.id); known.urls.add(r.url); known.titles.add(normTitle(r.title)); };
  for (const f of await fs.readdir(path.join(DATA_DIR, "days")).catch(() => [])) {
    if (f === `${today}.json`) continue;
    for (const r of (await readJson(path.join(DATA_DIR, "days", f), { reports: [] })).reports) remember(r);
  }
  for (const r of day.reports) remember(r);
  const retry = (source, item) => { state.seen[source.id] = (state.seen[source.id] || []).filter((id) => id !== item.id); };

  for (const { item, source } of queue) {
    const rid = shortId(source.id + item.id);
    if (known.urls.has(item.url) || known.titles.has(normTitle(item.title)) || (known.ids.has(rid) && !day.reports.some((r) => r.id === rid))) {
      console.log(`   – 이미 실린 보고서, 제외: ${item.title}`);
      continue;
    }
    let detail = null;
    if (!source.skipDetail && (!NO_AI || !item.date)) {
      try {
        detail = await fetchDetail(item, source);
      } catch (e) {
        console.warn(`   본문 실패 [${source.id}] ${item.title}: ${e.message}`);
      }
    }
    const date = item.date ?? detail?.date ?? detail?.pdfDate ?? null;
    if (!date) {
      console.log(`   – 발간일 확인 불가, 제외: ${item.title}`);
      if (!detail) retry(source, item); // 페이지를 못 읽었으면 다음 실행에서 다시 확인
      continue;
    }
    if (date < cutoff) {
      console.log(`   – ${date} 발간(42시간 경과), 제외: ${item.title}`);
      continue;
    }
    item.date = date;
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
      remember(day.reports.at(-1));
      if (!summary.pending) added.push({ title: item.title, sourceName: source.name, topic: topic ?? null });
      console.log(`   ✓ ${source.id}: ${item.title}`);
    } catch (e) {
      console.warn(`   요약 실패 [${source.id}] ${item.title}: ${e.message}`);
      // 실패한 항목은 다음 실행에서 재시도하도록 '본 것' 목록에서 제거
      retry(source, item);
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

  // GitHub Actions 다음 단계(푸시 알림)에 결과 전달
  const result = { date: today, newCount: added.length, headline: day.digest?.headline ?? null, added };
  await writeJson(path.join(import.meta.dirname, "../.last-run.json"), result);
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `new_count=${added.length}\n`);

  console.log(`\n완료: ${today} 보고서 ${day.reports.length}건 | 토큰 in ${usage.input} / out ${usage.output}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
