// 새 보고서 푸시 알림 (Web Push)
//   node collector/notify.js            .last-run.json 결과로 알림 발송
//   node collector/notify.js --test     테스트 알림 발송
// 필요한 환경변수: VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTIONS(앱에서 만든 알림 코드, 여러 개면 줄바꿈으로 구분)
import fs from "node:fs/promises";
import path from "node:path";
import webpush from "web-push";

const root = path.resolve(import.meta.dirname, "..");
const APP_URL = process.env.APP_URL || "https://heyhye94.github.io/report-brief/";
const test = process.argv.includes("--test");

const { vapidPublicKey } = JSON.parse(await fs.readFile(path.join(root, "web/push-config.json"), "utf8"));
const privateKey = process.env.VAPID_PRIVATE_KEY;
const raw = process.env.PUSH_SUBSCRIPTIONS || "";
if (!privateKey || !raw.trim()) {
  console.log("푸시 알림 설정이 없어 건너뛰어요 (VAPID_PRIVATE_KEY / PUSH_SUBSCRIPTIONS)");
  process.exit(0);
}
webpush.setVapidDetails("https://github.com/heyhye94/report-brief", vapidPublicKey, privateKey);

// 앱의 알림 코드 = 구독 정보 JSON 을 base64url 로 인코딩한 문자열
const subs = raw.split(/\s+/).filter(Boolean).map((code) => {
  try { return JSON.parse(Buffer.from(code, "base64url").toString("utf8")); } catch { return null; }
}).filter((s) => s?.endpoint);
if (!subs.length) { console.log("알림 코드를 해석하지 못했어요. 앱에서 코드를 다시 복사해 등록해 주세요."); process.exit(1); }

let payload;
if (test) {
  payload = { title: "리포트 브리프", body: "알림이 잘 연결됐어요 🎉", url: APP_URL, tag: "test" };
} else {
  const r = JSON.parse(await fs.readFile(path.join(root, ".last-run.json"), "utf8"));
  if (!r.newCount) { console.log("새 보고서가 없어 알림을 보내지 않아요"); process.exit(0); }
  const names = r.added.slice(0, 2).map((a) => `· ${a.title.length > 40 ? a.title.slice(0, 40) + "…" : a.title}`);
  payload = {
    title: `새 보고서 ${r.newCount}건이 도착했어요`,
    body: [r.headline, ...names].filter(Boolean).join("\n"),
    url: APP_URL,
    tag: `brief-${r.date}`,
  };
}

let ok = 0;
for (const sub of subs) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 * 60 * 12 });
    ok++;
  } catch (e) {
    console.warn(`발송 실패 (${e.statusCode ?? ""}): ${e.body || e.message}`.slice(0, 200));
    if (e.statusCode === 404 || e.statusCode === 410) console.warn("→ 만료된 알림 코드예요. 앱에서 알림을 다시 켜고 새 코드를 등록해 주세요.");
  }
}
console.log(`푸시 알림 ${ok}/${subs.length}건 발송`);
