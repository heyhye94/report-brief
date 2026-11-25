// 목록 수집(RSS / HTML) + 상세 페이지·PDF 본문 추출
import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

export async function fetchRaw(url, { timeoutMs = 25000 } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

export async function fetchText(url) {
  const res = await fetchRaw(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  const m = /charset=([\w-]+)/i.exec(type);
  let charset = m ? m[1].toLowerCase() : "utf-8";
  // 헤더에 없으면 문서 안 meta charset 확인 (EUC-KR 사이트 대응)
  if (!m) {
    const head = buf.subarray(0, 2048).toString("latin1");
    const mm = /charset=["']?([\w-]+)/i.exec(head);
    if (mm) charset = mm[1].toLowerCase();
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

// 2026.11.18 / 2026-11-18 / 2026/11/18 / 2026년 11월 18일 → 2026-11-18
export function parseKoDate(text) {
  if (!text) return null;
  // 문서번호 같은 숫자열이 날짜로 읽히지 않도록, 실제 달력에 있는 날짜만 받는다
  // '2026년 2/4분기' 같은 분기 표기는 날짜가 아니므로 제외
  for (const m of text.matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?!\d)(?!\s*분기)/g)) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (mo >= 1 && mo <= 12 && dt.getUTCDate() === d) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  return null;
}

const KST_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" });
export function toIsoDate(d) {
  if (!d) return null;
  d = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // 날짜만 있으면 그대로
  const t = new Date(d);
  return isNaN(t) || t.getFullYear() < 1990 ? parseKoDate(d) : KST_DATE.format(t);
}

/**
 * 상세 페이지에서 발간일 찾기 (최초 발행일 우선 — 예전 글을 '수정'해 다시 올린 경우 걸러내기 위해)
 * 1) 소스별 selector  2) 메타/구조화 데이터  3) <time>  4) '발간일·등록일 …' 라벨 옆 날짜
 */
export function extractPageDate($, html, source = {}) {
  if (source.detailDate) {
    const d = parseKoDate($(source.detailDate).first().text());
    if (d) return d;
  }
  const meta = (names) => {
    for (const n of names) {
      const v = $(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`).first().attr("content");
      const d = toIsoDate(v);
      if (d) return d;
    }
    return null;
  };
  const first = meta(["firstpublishdate", "citation_publication_date", "DC.date.issued"]);
  if (first) return first;
  const ld = /"datePublished"\s*:\s*"([^"]+)"/.exec(html);
  if (ld && toIsoDate(ld[1])) return toIsoDate(ld[1]);
  const m = meta(["article:published_time", "pwcReleaseDate", "datePublished", "date", "DC.date", "pubdate", "publish_date"]);
  if (m) return m;
  const t = $("time[datetime]").first().attr("datetime") || $("time").first().text();
  if (toIsoDate(t)) return toIsoDate(t);
  const text = clean($("body").text());
  const lab = /(발간일|발행일|게시일|등록일|작성일|공개일|날짜)\s*[:：]?\s*(20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2})/.exec(text);
  return lab ? parseKoDate(lab[2]) : null;
}

/** PDF 문서 정보의 작성일 (D:20261113...) */
function pdfInfoDate(info) {
  const v = info?.info?.CreationDate || info?.info?.ModDate || "";
  const m = /D:(\d{4})(\d{2})(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 소스 설정에 따라 최신 보고서 목록을 반환: [{id,title,url,date,org}] */
export async function fetchList(source) {
  const body = await fetchText(source.url);
  const items = source.type === "rss" ? parseRss(body, source) : parseHtml(body, source);
  if (!source.excludeTitle) return items;
  const ex = new RegExp(source.excludeTitle);
  return items.filter((it) => !ex.test(it.title));
}

function parseRss(xml, source) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $("item, entry").each((_, el) => {
    const $el = $(el);
    const title = clean($el.find("title").first().text());
    let url = clean($el.find("link").first().text()) || $el.find("link").attr("href");
    const date = toIsoDate(
      $el.find("pubDate, published, updated, dc\\:date").first().text()
    );
    const desc = clean(cheerio.load($el.find("description, summary").first().text()).text());
    if (title && url) items.push({ title, url, date, snippet: desc.slice(0, 600) });
  });
  return items.slice(0, source.maxItems ?? 20).map((it) => ({ ...it, id: it.url }));
}

function parseHtml(html, source) {
  const $ = cheerio.load(html);
  const s = source.selectors;
  const items = [];
  $(s.item).each((_, el) => {
    const $el = $(el);
    const $a = s.link ? $el.find(s.link).first() : $el.is("a") ? $el : $el.find("a").first();
    let href = $a.attr("href");
    const title = clean(s.title ? $el.find(s.title).first().text() : $a.text());
    if (source.linkTemplate && href) {
      const m = new RegExp(source.linkTemplate.regex).exec(href + " " + ($a.attr("onclick") || ""));
      const map = source.linkTemplate.map || {};
      href = m
        ? source.linkTemplate.url
            .replace(/\{(\d)\}/g, (_, i) => map[m[+i]] ?? m[+i])
            .replace(/\$(\d)/g, (_, i) => m[+i])
        : null;
    }
    if (s.linkFilter && href && !new RegExp(s.linkFilter).test(href)) return;
    if (!href || !title || href.startsWith("javascript") || href.startsWith("#")) return;
    const url = new URL(href, source.url).toString();
    const rowText = clean(($el.is("a") ? $el.parent() : $el).text());
    const date = source.noDate ? undefined : parseKoDate(s.date ? $el.find(s.date).first().text() : rowText);
    const org = s.org ? clean($el.find(s.org).first().text()) : undefined;
    items.push({ title, url, date, org });
  });
  // 같은 링크 중복 제거
  const seen = new Set();
  return items
    .filter((it) => !seen.has(it.url) && seen.add(it.url))
    .slice(0, source.maxItems ?? 20)
    .map((it) => ({ ...it, id: source.idFrom ? idFrom(it.url, source.idFrom) : it.url }));
}

// 추적용 파라미터(nPage 등)가 붙은 URL에서 고유 ID만 뽑아 중복 판정을 안정화
function idFrom(url, param) {
  const v = new URL(url).searchParams.get(param);
  return v ? `${param}=${v}` : url;
}

/**
 * 상세 페이지 본문 + (있으면) PDF 앞부분 텍스트.
 * 반환 텍스트는 요약 입력으로 쓰며, 잘린 경우 truncated=true 로 알려준다.
 */
export async function fetchDetail(item, source, { maxChars = 40000, pdfPages = 25 } = {}) {
  const out = { pageText: "", pdfText: "", pdfUrl: null, truncated: false };
  if (/\.pdf($|\?)/i.test(item.url)) {
    out.pdfUrl = item.url;
  } else {
    const html = await fetchText(item.url);
    const $ = cheerio.load(html);
    out.date = extractPageDate($, html, source);
    out.pdfUrl = findPdfLink($, item.url, source); // onclick 링크를 읽어야 해서 script 제거 전에
    $("script, style, nav, header, footer, noscript, iframe").remove();
    const main = source.detailSelector ? $(source.detailSelector).first() : $("main, article, #content, .content, body").first();
    out.pageText = clean(main.text()).slice(0, 12000);
  }
  if (out.pdfUrl) {
    try {
      const res = await fetchRaw(out.pdfUrl, { timeoutMs: 60000 });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 4).toString() === "%PDF") {
        const parser = new PDFParse({ data: buf });
        if (!out.date) {
          try { out.pdfDate = pdfInfoDate(await parser.getInfo()); } catch {}
        }
        const info = await parser.getText({ first: pdfPages });
        out.pdfText = clean(info.text);
        out.pdfPages = info.total;
        if (info.total > pdfPages) out.truncated = true;
        await parser.destroy?.();
      }
    } catch (e) {
      out.pdfError = String(e.message || e);
    }
  }
  if (out.pdfText.length > maxChars) {
    out.pdfText = out.pdfText.slice(0, maxChars);
    out.truncated = true;
  }
  return out;
}

function findPdfLink($, base, source) {
  // javascript:fn_downFile('ID','0') 처럼 스크립트로 내려받는 사이트용
  if (source.pdfTemplate) {
    const re = new RegExp(source.pdfTemplate.regex);
    for (const a of $("a[href], [onclick]").toArray()) {
      const m = re.exec(`${$(a).attr("href") || ""} ${$(a).attr("onclick") || ""}`);
      if (m) return new URL(source.pdfTemplate.url.replace(/\$(\d)/g, (_, i) => m[+i]), base).toString();
    }
  }
  const cands = [];
  $("a[href], button[onclick], a[onclick]").each((_, a) => {
    // onclick="location.href='/file/download?...'" 형태도 링크로 취급
    const oc = /location\.href\s*=\s*['"]([^'"]+)['"]/.exec($(a).attr("onclick") || "");
    const href = oc ? oc[1] : $(a).attr("href");
    const text = clean($(a).text()) + " " + ($(a).attr("title") || "");
    if (!href || href.startsWith("javascript")) return;
    let score = 0;
    if (/\.pdf($|\?)/i.test(href)) score += 3;
    if (/down|file|attach/i.test(href)) score += 1;
    if (/pdf|원문|다운로드|본문|download/i.test(text)) score += 2;
    if (/hwp|한글|xlsx|zip/i.test(href + text)) score -= 3;
    if (score >= 3) cands.push({ href: new URL(href, base).toString(), score });
  });
  if (source.pdfSelector) {
    const h = $(source.pdfSelector).first().attr("href");
    if (h) return new URL(h, base).toString();
  }
  cands.sort((a, b) => b.score - a.score);
  return cands[0]?.href ?? null;
}
