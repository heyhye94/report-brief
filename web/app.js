const $ = (s, el = document) => el.querySelector(s);
const state = { index: null, day: null, cat: "all", topic: "all", q: "" };

const CAT_ICON = { institute: "🔬", consulting: "💼", government: "🏢", association: "🤝" };
const TOPICS = [
  ["경제", "📈"], ["시장전망", "🔭"], ["정책", "🏛️"], ["IT", "💻"], ["테크", "🤖"],
  ["국제정세", "🌏"], ["부동산", "🏠"], ["사회", "👥"], ["문화", "🎭"],
];
const TOPIC_ICON = Object.fromEntries(TOPICS);
const CAT_SHORT = { institute: "연구기관", consulting: "컨설팅", government: "부처·공공", association: "협회" };
const catVar = (c) => `var(--c-${c}, var(--muted))`;

// 읽은 보고서 기록 (이 기기에만 저장)
const READ_KEY = "rb-read";
const readSet = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); } catch { return new Set(); }
})();
function markRead(id) {
  if (readSet.has(id)) return;
  readSet.add(id);
  try { localStorage.setItem(READ_KEY, JSON.stringify([...readSet].slice(-2000))); } catch {}
  const card = document.getElementById(`r-${id}`);
  if (card) {
    card.classList.add("is-read");
    if (!$(".read-mark", card)) $(".meta", card).append(el("span", { class: "read-mark" }, "✓ 읽음"));
  }
  renderProgress();
}

const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, dd] = d.split("-").map(Number);
  const wd = "일월화수목금토"[new Date(y, m - 1, dd).getDay()];
  return `${m}월 ${dd}일 (${wd})`;
};

async function getJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

function el(tag, attrs = {}, ...children) {
  const n = typeof tag === "string" ? document.createElement(tag) : tag; // 기존 요소에 자식 추가도 허용
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style") n.style.cssText = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) n.append(c);
  return n;
}
const ul = (items, cls) => el("ul", { class: cls }, items.map((t) => el("li", {}, t)));

async function init() {
  updateOnline();
  addEventListener("online", updateOnline);
  addEventListener("offline", updateOnline);
  $("#list").replaceChildren(el("div", { class: "skeleton" }), el("div", { class: "skeleton" }));

  $("#searchBtn").addEventListener("click", toggleSearch);
  $("#search").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); renderList(); });
  const toTop = $("#toTop");
  toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));
  addEventListener("scroll", () => { toTop.hidden = scrollY < 900; }, { passive: true });

  try {
    state.index = await getJson("data/index.json");
  } catch {
    $("#list").replaceChildren();
    showHeroMessage("아직 데이터가 없어요", "첫 수집이 끝나면 여기에 오늘의 브리핑이 나와요.");
    return;
  }

  const sel = $("#daySelect");
  sel.replaceChildren(...state.index.days.map((d) => el("option", { value: d.date }, `${fmtDate(d.date)} · ${d.count}건`)));
  sel.addEventListener("change", () => loadDay(sel.value));
  $("#prevDay").addEventListener("click", () => step(1));
  $("#nextDay").addEventListener("click", () => step(-1));

  renderSources();
  if (state.index.updatedAt) $("#updated").textContent = `마지막 업데이트 ${new Date(state.index.updatedAt).toLocaleString("ko-KR")}`;

  const want = new URLSearchParams(location.search).get("d");
  const first = state.index.days.find((d) => d.date === want)?.date ?? state.index.days[0]?.date;
  if (first) loadDay(first);
  else {
    $("#list").replaceChildren();
    showHeroMessage("조용한 날이에요", "아직 수집된 보고서가 없어요.");
  }
}

function showHeroMessage(eyebrow, text) {
  $("#hero").replaceChildren(el("p", { class: "eyebrow" }, eyebrow), el("h2", {}, text));
  $("#themes").hidden = true;
  $("#extras").hidden = true;
}

function toggleSearch() {
  const row = $("#searchRow");
  const open = row.hidden;
  row.hidden = !open;
  $("#searchBtn").setAttribute("aria-expanded", String(open));
  if (open) $("#search").focus();
  else if (state.q) { state.q = ""; $("#search").value = ""; renderList(); }
}

function step(delta) {
  const days = state.index.days.map((d) => d.date);
  const i = days.indexOf(state.day?.date) + delta;
  if (i >= 0 && i < days.length) loadDay(days[i]);
}

async function loadDay(date) {
  $("#daySelect").value = date;
  const days = state.index.days.map((d) => d.date);
  const i = days.indexOf(date);
  $("#dayLabel").textContent = i === 0 ? `${fmtDate(date)} · 최신` : fmtDate(date);
  $("#prevDay").disabled = i >= days.length - 1;
  $("#nextDay").disabled = i <= 0;
  history.replaceState(null, "", i === 0 ? location.pathname : `?d=${date}`);
  try {
    state.day = await getJson(`data/days/${date}.json`);
  } catch {
    showHeroMessage(fmtDate(date), "이 날짜의 데이터를 불러오지 못했어요.");
    $("#list").replaceChildren();
    return;
  }
  state.cat = "all";
  state.topic = "all";
  renderHero();
  renderThemes();
  renderExtras();
  renderChips();
  renderList();
}

function renderHero() {
  const { day, index } = state;
  const d = day.digest;
  const total = day.reports.length;
  const byCat = {};
  for (const r of day.reports) byCat[r.category] = (byCat[r.category] || 0) + 1;
  const cats = Object.keys(index.categories).filter((c) => byCat[c]);
  const minutes = Math.max(1, Math.round(total * 0.5));

  $("#hero").replaceChildren(
    el("div", { class: "hero-tags" },
      el("span", { class: "pill hot" }, `새 보고서 ${total}건`),
      el("span", { class: "pill" }, `⏱ 약 ${minutes}분이면 다 읽어요`)
    ),
    el("p", { class: "eyebrow" }, d ? "오늘의 한 줄" : `${fmtDate(day.date)} 브리핑`),
    el("h2", {}, d?.headline ?? (day.reports.some((r) => r.summary) ? "오늘 나온 보고서를 확인해 보세요." : "목록을 모았어요. AI 요약은 다음 실행 때 채워져요.")),
    el("div", { class: "mix", role: "img", "aria-label": cats.map((c) => `${index.categories[c]} ${byCat[c]}건`).join(", ") },
      cats.map((c) => el("span", { style: `flex:${byCat[c]};background:${catVar(c)}` }))
    ),
    el("div", { class: "mix-legend" },
      cats.map((c) => el("span", {}, el("i", { style: `background:${catVar(c)}` }), `${CAT_SHORT[c] ?? index.categories[c]} ${byCat[c]}`))
    )
  );
}

function renderThemes() {
  const d = state.day.digest;
  const box = $("#themes");
  if (!d?.themes?.length) { box.hidden = true; return; }
  const titleOf = Object.fromEntries(state.day.reports.map((r) => [r.id, r.title]));
  box.hidden = false;
  const track = el("div", { class: "carousel" });
  const slide = (dir) => {
    const w = track.querySelector(".theme")?.offsetWidth ?? track.clientWidth;
    track.scrollBy({ left: dir * (w + 12), behavior: "smooth" });
  };
  const prev = el("button", { class: "icon-btn", "aria-label": "이전 테마", onclick: () => slide(-1) }, "‹");
  const next = el("button", { class: "icon-btn", "aria-label": "다음 테마", onclick: () => slide(1) }, "›");
  const nav = el("div", { class: "car-nav" }, prev, next);
  const sync = () => {
    const max = track.scrollWidth - track.clientWidth;
    nav.hidden = max <= 4;
    prev.disabled = track.scrollLeft <= 4;
    next.disabled = track.scrollLeft >= max - 4;
  };
  track.addEventListener("scroll", sync, { passive: true });
  addEventListener("resize", sync);
  requestAnimationFrame(sync);
  box.replaceChildren(
    el("div", { class: "sec-title" }, el("h3", {}, "오늘의 테마"), nav),
    el(track, {},
      d.themes.map((t, i) =>
        el("article", { class: "theme" },
          el("span", { class: "theme-no" }, String(i + 1)),
          el("strong", {}, t.title),
          el("p", {}, t.summary),
          el("div", { class: "refs" },
            t.report_ids.filter((id) => titleOf[id]).map((id) =>
              el("button", { class: "ref", onclick: () => jumpTo(id) }, titleOf[id].length > 34 ? titleOf[id].slice(0, 34) + "…" : titleOf[id])
            )
          )
        )
      )
    )
  );
}

function renderExtras() {
  const d = state.day.digest;
  const box = $("#extras");
  if (!d || (!d.insights?.length && !d.watch?.length)) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(
    d.insights?.length ? el("div", { class: "box insights" }, el("h4", {}, "💡 같이 보면 보이는 것"), ul(d.insights)) : null,
    d.watch?.length ? el("div", { class: "box watch" }, el("h4", {}, "👀 앞으로 지켜볼 것"), ul(d.watch)) : null
  );
}

function jumpTo(id) {
  state.cat = "all"; state.topic = "all"; state.q = ""; $("#search").value = "";
  renderChips(); renderList();
  const card = document.getElementById(`r-${id}`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.querySelector("details")?.setAttribute("open", "");
  card.classList.remove("flash");
  void card.offsetWidth;
  card.classList.add("flash");
}

function chip(label, n, selected, onclick) {
  return el("button", { class: "chip", role: "tab", "aria-selected": String(selected), onclick }, label, el("span", { class: "n" }, String(n)));
}

function renderChips() {
  const reports = state.day.reports;
  const tCounts = {};
  for (const r of reports) if (r.topic) tCounts[r.topic] = (tCounts[r.topic] || 0) + 1;
  const pick = (t) => () => { state.topic = t; renderChips(); renderList(); };
  $("#topicChips").replaceChildren(
    chip("전체 주제", reports.length, state.topic === "all", pick("all")),
    ...TOPICS.filter(([t]) => tCounts[t]).map(([t, ic]) => chip(`${ic} ${t}`, tCounts[t], state.topic === t, pick(t)))
  );
  const counts = { all: state.day.reports.length };
  for (const r of state.day.reports) counts[r.category] = (counts[r.category] || 0) + 1;
  const cats = [["all", "모든 발간처"], ...Object.keys(state.index.categories).map((k) => [k, `${CAT_ICON[k] ?? ""} ${CAT_SHORT[k] ?? state.index.categories[k]}`])];
  $("#chips").replaceChildren(
    ...cats.filter(([k]) => counts[k]).map(([k, label]) =>
      el("button", {
        class: "chip", role: "tab", "aria-selected": String(state.cat === k),
        onclick: () => { state.cat = k; renderChips(); renderList(); },
      }, label, el("span", { class: "n" }, String(counts[k])))
    )
  );
}

function renderProgress() {
  if (!state.day) return;
  const ids = state.day.reports.map((r) => r.id);
  const done = ids.filter((id) => readSet.has(id)).length;
  $("#progressFill").style.width = ids.length ? `${(done / ids.length) * 100}%` : "0";
  $("#progressText").textContent = done === ids.length && ids.length ? "🎉 오늘 보고서 다 읽었어요" : `${done} / ${ids.length} 읽음`;
}

function matches(r) {
  if (state.cat !== "all" && r.category !== state.cat) return false;
  if (state.topic !== "all" && r.topic !== state.topic) return false;
  if (!state.q) return true;
  const s = r.summary;
  const hay = [r.title, r.sourceName, r.org, r.topic, s?.one_line, ...(s?.keywords ?? [])].join(" ").toLowerCase();
  return hay.includes(state.q);
}

function card(r) {
  const s = r.summary;
  const read = readSet.has(r.id);
  const label = state.index.categories[r.category] ?? r.category;
  const more = s && el("details", {
    class: "more",
    ontoggle: (e) => { if (e.target.open) markRead(r.id); },
  },
    el("summary", {}, el("span", {}, "자세히 보기"), el("span", { class: "chev", "aria-hidden": "true" }, "▾")),
    el("div", { class: "more-body" },
      s.key_points?.length ? el("div", {}, el("h5", {}, "📌 핵심만 쏙"), el("ol", { class: "points" }, s.key_points.map((t) => el("li", {}, t)))) : null,
      s.insights?.length ? el("div", { class: "callout so" }, el("h5", {}, "💡 그래서 뭐가 중요해요?"), ul(s.insights)) : null,
      s.implications ? el("div", { class: "callout todo" }, el("h5", {}, "✅ 챙길 점"), el("p", {}, s.implications)) : null,
      s.audience ? el("p", { class: "aud" }, "👤 이런 분께 추천해요 · ", el("b", {}, s.audience)) : null,
      r.partial ? el("p", { class: "partial" }, "※ 분량이 많아 PDF 앞부분만 보고 요약했어요.") : null
    )
  );

  return el("article", { class: `card${read ? " is-read" : ""}`, id: `r-${r.id}`, "data-cat": r.category },
    el("div", { class: "meta" },
      r.topic ? el("button", { class: "topic-tag", onclick: () => { state.topic = r.topic; state.cat = "all"; renderChips(); renderList(); $("#bar").scrollIntoView({ behavior: "smooth", block: "start" }); } }, `${TOPIC_ICON[r.topic] ?? ""} ${r.topic}`) : null,
      el("span", { class: "badge" }, `${CAT_ICON[r.category] ?? ""} ${CAT_SHORT[r.category] ?? label}`),
      el("span", { class: "source" }, r.org ? `${r.sourceName.replace(/\(.*\)/, "").trim()} · ${r.org}` : r.sourceName),
      r.publishedAt ? el("time", { class: "date", datetime: r.publishedAt }, r.publishedAt.slice(5).replace("-", ".")) : null,
      read ? el("span", { class: "read-mark" }, "✓ 읽음") : null
    ),
    el("p", { class: `oneline${s ? "" : " pending"}` }, s ? s.one_line : "AI 요약을 기다리고 있어요"),
    el("h3", { class: "title" }, el("a", { href: r.url, target: "_blank", rel: "noopener" }, r.title)),
    more,
    el("div", { class: "card-foot" },
      el("div", { class: "tags" },
        (s?.keywords ?? []).map((k) =>
          el("button", { class: "tag", onclick: () => searchFor(k) }, `#${k}`)
        )
      ),
      el("div", { class: "links" },
        r.pdfUrl ? el("a", { href: r.pdfUrl, target: "_blank", rel: "noopener" }, "PDF") : null,
        el("a", { class: "primary", href: r.url, target: "_blank", rel: "noopener", onclick: () => markRead(r.id) }, "원문 ↗")
      )
    )
  );
}

function searchFor(k) {
  $("#searchRow").hidden = false;
  $("#searchBtn").setAttribute("aria-expanded", "true");
  $("#search").value = k;
  state.q = k.toLowerCase();
  state.cat = "all";
  state.topic = "all";
  renderChips();
  renderList();
  $("#bar").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderList() {
  const items = state.day.reports.filter(matches);
  $("#list").replaceChildren(...items.map(card));
  const empty = $("#empty");
  empty.hidden = items.length > 0;
  empty.textContent = state.q ? `“${state.q}”에 맞는 보고서가 없어요 🤔` : "이 조건에 맞는 새 보고서가 없어요.";
  renderProgress();
}

function renderSources() {
  const { sources, categories } = state.index;
  $("#sourceList").replaceChildren(...sources.map((s) => {
    const h = s.health;
    const status = !h ? "" : h.ok ? " — 정상" : " — 수집 실패";
    return el("li", { class: h && !h.ok ? "bad" : null },
      el("a", { href: s.url, target: "_blank", rel: "noopener" }, s.name), ` (${categories[s.category]})${status}`);
  }));
}

function updateOnline() {
  $("#offline").hidden = navigator.onLine;
}

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

init();
