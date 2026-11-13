// Trackers (docs/trackers.md): lists and submissions, saved to tracker.json, merged across two windows.
// Starts its own studydesk on a throwaway folder (deleted and recreated), so run Chrome with a fresh --user-data-dir:
//   chrome --headless=new --remote-debugging-port=9352 --user-data-dir=<temp dir> about:blank
//   node scripts/e2e/trackers.mjs 9352 <abs empty work dir> [outDir]      (from the repo root)
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [port, work, out] = process.argv.slice(2);
const APP_PORT = 5197, app = `http://localhost:${APP_PORT}/`, lib = join(work, "lib");
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log(ok ? "PASS" : "FAIL", what); if (!ok) fails++; };
rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
const srv = spawn("python", ["-m", "studydesk", "--port", String(APP_PORT), "--data-dir", lib, "--no-browser"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(app + "api/info"); break; } catch (e) { await wait(250); } }

// ---------- DevTools helpers, one connection per tab ----------
async function tab(url) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pend = new Map(), errs = [];
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, m => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async e => { const r = await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || e); return r.result.value; };
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(1800);
  const click = async sel => { await js(`(() => { const el = ${sel}; if (!el) throw new Error("no element: " + ${JSON.stringify(sel)}); el.click(); })()`); await wait(250); };
  const fill = async (id, v) => { await js(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input", {bubbles:true})); i.dispatchEvent(new Event("change", {bubbles:true})); })()`); };
  const key = async k => { for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: k, windowsVirtualKeyCode: { Escape: 27, Enter: 13 }[k] }); await wait(200); };
  const shot = async n => { if (out) writeFileSync(join(out, `${n}.png`), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64")); };
  return { cdp, js, click, fill, key, shot, errs, close: () => ws.close(), id: t.id };
}
const btn = (act, v) => `document.querySelector('[data-act="${act}"]${v !== undefined ? `[data-v="${v}"]` : ""}')`;
const byText = (sel, re) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e => ${re}.test(e.textContent))`;
const disk = async () => (await (await fetch(app + "api/tracker")).json()).tracker;
const iso = d => { const t = new Date(Date.now() + d * 864e5); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };

try {
  const A = await tab(app);
  await A.click(btn("tk-subs", "all"));
  check(await A.js(`/All submissions/.test(document.querySelector('.page-h').textContent) && /Keep track of the journals/.test(document.querySelector('.empty').textContent)`), "All submissions opens from the sidebar, with an explanation when empty");
  check(!existsSync(join(lib, "tracker.json")), "nothing is written before you add anything");

  // ---------- add a journal ----------
  await A.click(btn("sub-new"));
  check(await A.js(`!!document.querySelector('#sfForm') && document.querySelector('#sfConf').hidden`), "Add submission opens the form; conference dates are hidden for a journal");
  await A.fill("sfTitle", "Journal of Machine Learning Things"); await A.click(btn("sub-save"));
  check(await A.js(`/starting with https/.test(document.querySelector('#sfMsg').textContent) && !!document.querySelector('#sfForm')`), "saving without a link says what's missing and keeps the form open");
  await A.fill("sfUrl", "https://www.example-journal.org/call-for-papers");
  await A.click(btn("sf-index", "scopus"));
  await A.js(`document.querySelector('#tagIn-sub').focus()`); await A.fill("tagIn-sub", "llm-evaluation,"); await wait(200);
  await A.fill("sfDue", iso(5)); await A.fill("sfApc", "1,800"); await A.fill("sfCur", "usd"); await A.fill("sfZero", iso(3));
  await A.fill("sfDetails", "Scope: **evaluation** of language models. 12 pages max.");
  await A.js(`document.querySelector('#tagIn-sub').focus()`); await wait(150);
  await A.key("Escape");
  check(await A.js(`!document.querySelector('#modal').hidden && document.querySelector('#tagSug-sub').hidden`), "Escape in the topic box closes its suggestions, not the form");
  await A.key("Escape");
  check(await A.js(`!document.querySelector('#modal').hidden && /Press Cancel/.test(document.querySelector('#sfMsg').textContent)`), "Escape again doesn't throw away a half-filled form; it says to press Cancel");
  await A.shot("tk-form");
  await A.click(btn("sub-save")); await wait(500);
  const row = `document.querySelector('.tk-row')`;
  check(await A.js(`/All submissions/.test(document.querySelector('.page-h').textContent) && /Where to submit/.test(document.querySelector('.tk-nav').textContent)`), "the first entry makes a list called Where to submit; you stay on All submissions");
  const txt = await A.js(`${row}.innerText`);
  check(/Journal of Machine Learning Things/.test(txt) && /Scopus/.test(txt) && /example-journal\.org/.test(txt) && /\$1,800/.test(txt) && /llm-evaluation/.test(txt), `the row shows name, Scopus, link host, APC and topic`);
  check(await A.js(`${row}.querySelector('.tk-due').classList.contains('soon') && /in 5 days/.test(${row}.querySelector('.tk-due').textContent)`), "a deadline 5 days away reads “in 5 days” and is flagged as soon");
  check(await A.js(`!!${row}.querySelector('.tk-m .warn') && /Free to publish until/.test(${row}.innerText)`), "a zero-APC date within a week is flagged");
  check(await A.js(`${row}.querySelector('a').target === "_blank"`), "the link opens in a new tab");

  // ---------- a conference with AoE and an abstract deadline, in a new list ----------
  await A.click(btn("list-new", "submissions")); await A.fill("lfName", "Conferences 2027"); await A.key("Enter"); await wait(300);
  check(await A.js(`/Conferences 2027/.test(document.querySelector('.page-h').textContent) && /This list is empty/.test(document.querySelector('.empty').textContent)`), "New list (Enter saves) opens the empty list");
  await A.click(btn("sub-new", await A.js(`document.querySelector('[data-act="sub-new"]').dataset.v`)));
  await A.click(btn("sf-kind", "conference"));
  check(await A.js(`!document.querySelector('#sfConf').hidden`), "choosing Conference shows its dates");
  await A.fill("sfUrl", "https://conf.example.org/2027/cfp"); await A.fill("sfTitle", "ExampleConf 2027");
  await A.fill("sfDue", iso(20)); await A.fill("sfTime", "23:59"); await A.js(`document.querySelector('#sfAoe').checked = true`);
  await A.fill("sfAbs", iso(13)); await A.fill("sfFrom", iso(90)); await A.fill("sfTo", iso(93)); await A.fill("sfPlace", "Lisbon");
  await A.js(`document.querySelector('#sfFree').click()`); await wait(100);
  check(await A.js(`document.querySelector('#sfApc').disabled`), "No APC disables the amount");
  await A.click(btn("sub-save")); await wait(400);
  const ctxt = await A.js(`${row}.innerText`);
  check(/23:59 AoE/.test(ctxt) && /Abstract .*in 13 days/.test(ctxt) && /Lisbon/.test(ctxt) && /No APC/.test(ctxt), `the conference row shows the AoE time, the abstract deadline, the place and No APC`);
  check(await A.js(`${byText(".tk-nav .nav-i", "/Conferences 2027/")}.querySelector('.ct').textContent === "1" && ${byText(".tk-nav .nav-i", "/Where to submit/")}.querySelector('.ct').textContent === "1" && ${btn("tk-subs", "all")}.querySelector('.ct').textContent === "2"`), "sidebar counts per list and in total");

  // ---------- All submissions: nearest deadline first, with the list name ----------
  await A.click(btn("tk-subs", "all"));
  check(JSON.stringify(await A.js(`[...document.querySelectorAll('.tk-t')].map(b => b.textContent)`)) === '["Journal of Machine Learning Things","ExampleConf 2027"]' && /in Conferences 2027/.test(await A.js(`document.querySelectorAll('.tk-row')[1].innerText`)), "All submissions: nearest deadline first, each row says its list");

  // ---------- mark as submitted, edit, move, delete ----------
  await A.click(`${byText(".tk-row", "/Machine Learning Things/")}.querySelector('[data-act="sub-mark"]')`);
  const mt = await A.js(`${byText(".tk-row", "/Machine Learning Things/")}.innerText`);
  check(/Submitted/.test(mt) && !/Mark as submitted/.test(mt) && !(await A.js(`${byText(".tk-row", "/Machine Learning Things/")}.querySelector('.tk-due.soon')`)), "Mark as submitted: status and date shown, the button and the soon flag go away");
  await A.click(`${byText(".tk-t", "/Machine Learning Things/")}`);
  check(await A.js(`document.querySelector('#sfStatus').value === "submitted" && !document.querySelector('#sfSubWrap').hidden && document.querySelector('#sfSubOn').value === ${JSON.stringify(iso(0))}`), "the edit form shows Submitted with today's date");
  await A.fill("sfList", await A.js(`[...document.querySelectorAll('#sfList option')].find(o => /Conferences/.test(o.textContent)).value`));
  await A.click(btn("sub-save")); await wait(300);
  await A.click(byText(".tk-nav .nav-i", "/Conferences 2027/"));
  check(JSON.stringify(await A.js(`[...document.querySelectorAll('.tk-rank')].map(r => r.textContent)`)) === '["1","2"]' && await A.js(`${byText(".tk-nav .nav-i", "/Where to submit/")}.querySelector('.ct').textContent`) === "0", "moving an entry to another list: it joins the end of that list's priority order");
  await A.shot("tk-list");

  const d1 = await disk();
  check(d1 && d1.submissions.length === 2 && d1.lists.length === 2 && d1.submissions.find(x => x.kind === "conference").deadline.aoe === true && d1.submissions.find(x => x.kind === "journal").apc.amount === 1800, "tracker.json on disk has both entries and lists");
  check(JSON.parse(readFileSync(join(lib, "tracker.json"), "utf8")).format === "studydesk-tracker", "tracker.json carries its format id");

  // ---------- two windows: B adds while A is stale ----------
  const B = await tab(app);
  await B.click(btn("tk-subs", "all")); await B.click(btn("sub-new"));
  await B.fill("sfUrl", "https://books.example.com/chapter-call"); await B.fill("sfTitle", "Chapter call from window B"); await B.click(btn("sf-kind", "chapter"));
  await B.click(btn("sub-save")); await wait(800);
  await A.click(btn("sub-new", await A.js(`document.querySelector('[data-act="sub-new"]').dataset.v`)));
  await A.fill("sfUrl", "https://special.example.net/issue"); await A.fill("sfTitle", "Special issue from window A"); await A.click(btn("sf-kind", "special"));
  await A.click(btn("sub-save")); await wait(1200);
  const d2 = await disk();
  check(["Chapter call from window B", "Special issue from window A"].every(t => d2.submissions.some(x => x.title === t)) && d2.submissions.length === 4, "two windows adding at once: both entries end up on disk");
  await A.cdp("Page.bringToFront"); await A.js(`window.dispatchEvent(new Event("focus"))`); await wait(800);
  await A.click(btn("tk-subs", "all"));
  check(await A.js(`document.querySelectorAll('.tk-row').length`) === 4, "window A shows window B's entry too");

  // ---------- delete an entry, then a list with entries ----------
  await A.click(byText(".tk-t", "/Special issue from window A/")); await A.click(btn("sub-del"));
  check(await A.js(`/can't be undone/.test(document.querySelector('#sfFoot').textContent)`), "Delete asks first, in the form");
  await A.click(btn("sub-del-yes")); await wait(300);
  check(await A.js(`document.querySelectorAll('.tk-row').length`) === 3, "the entry is deleted");
  await A.click(byText(".tk-nav .nav-i", "/Conferences 2027/")); await A.click(btn("list-del", await A.js(`document.querySelector('[data-act="list-del"]').dataset.v`)));
  check(/also deletes the 2 entries/.test(await A.js(`document.querySelector('.mdl').textContent`)), "deleting a list says how many entries go with it");
  await A.click(`document.querySelector('[data-act="list-del-yes"]')`); await wait(900);
  const d3 = await disk();
  check(d3.lists.length === 1 && d3.submissions.length === 1 && d3.submissions[0].title === "Chapter call from window B", "the list and its entries are gone from disk; the rest stays");
  await A.cdp("Page.reload"); await wait(2000);
  check(await A.js(`document.querySelector('.tk-nav').innerText.includes("Where to submit")`), "after a reload the sidebar still lists it");
  check(!A.errs.length && !B.errs.length, `no script errors (${[...A.errs, ...B.errs].join(" | ")})`);
  A.close(); B.close();
} catch (e) { console.log("FAIL", e.message); fails++; }
finally { srv.kill(); }
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
