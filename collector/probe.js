// 소스 설정 점검: node collector/probe.js [sourceId...] [--detail]
import { SOURCES } from "./sources.js";
import { fetchList, fetchDetail } from "./fetchers.js";

const args = process.argv.slice(2);
const withDetail = args.includes("--detail");
const ids = args.filter((a) => !a.startsWith("--"));
const targets = ids.length ? SOURCES.filter((s) => ids.includes(s.id)) : SOURCES;

for (const s of targets) {
  try {
    const items = await fetchList(s);
    console.log(`\n✅ ${s.id} (${items.length})`);
    for (const it of items.slice(0, 3)) console.log(`   ${it.date ?? "----------"} ${it.org ? `[${it.org}] ` : ""}${it.title.slice(0, 60)}  ${it.url.slice(0, 90)}`);
    if (withDetail && items[0]) {
      const d = await fetchDetail(items[0], s);
      console.log(`   detail: page ${d.pageText.length}자, pdf ${d.pdfText.length}자 (${d.pdfPages ?? "-"}p) ${d.pdfUrl ?? "PDF 없음"} ${d.pdfError ?? ""}`);
    }
  } catch (e) {
    console.log(`\n❌ ${s.id}: ${e.message}`);
  }
}
