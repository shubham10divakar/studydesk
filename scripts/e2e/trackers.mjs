// Trackers (docs/trackers.md): lists and submissions, saved to tracker.json, merged across two windows.
// Starts its own studydesk on a throwaway folder (deleted and recreated), so run Chrome with a fresh --user-data-dir:
//   chrome --headless=new --remote-debugging-port=9352 --user-data-dir=<temp dir> about:blank
//   node scripts/e2e/trackers.mjs 9352 <abs empty work dir> [outDir]      (from the repo root)
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
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
  check(JSON.stringify(await A.js(`[...document.querySelectorAll('.tk-grip')].map(r => r.textContent)`)) === '["1","2"]' && await A.js(`${byText(".tk-nav .nav-i", "/Where to submit/")}.querySelector('.ct').textContent`) === "0", "moving an entry to another list: it joins the end of that list's priority order");
  await A.shot("tk-list");

  // ---------- reorder: arrows, drag by the number, Alt+arrow ----------
  const titles = () => A.js(`[...document.querySelectorAll('.tk-t')].map(b => b.textContent.split(" ")[0])`);
  const lid = await A.js(`document.querySelector('[data-act="sub-new"]').dataset.v`);
  check(await A.js(`document.querySelectorAll('.tk-row')[0].querySelector('[data-act="tk-up"]').disabled && document.querySelectorAll('.tk-row')[1].querySelector('[data-act="tk-down"]').disabled`), "the first row can't move up and the last can't move down");
  await A.click(`document.querySelectorAll('.tk-row')[0].querySelector('[data-act="tk-down"]')`);
  check(JSON.stringify(await titles()) === '["Journal","ExampleConf"]' && await A.js(`!!document.activeElement.closest('.tk-row')?.innerText.includes("ExampleConf")`), "Move down swaps the two and keeps focus on the moved entry");
  await wait(600);
  const ord = (await disk()).lists.find(l => l.id === lid).order, subs = (await disk()).submissions;
  check(ord.map(id => subs.find(x => x.id === id).title.split(" ")[0]).join() === "Journal,ExampleConf", "the new order is saved to disk");
  await A.js(`(() => { const rows = document.querySelectorAll('.tk-row'), dt = new DataTransfer(), g = rows[1].querySelector('.tk-grip'), r0 = rows[0].getBoundingClientRect();
    g.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer:dt}));
    rows[0].dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer:dt, clientY:r0.top + 5}));
    rows[0].dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:dt, clientY:r0.top + 5})); })()`); await wait(300);
  check(JSON.stringify(await titles()) === '["ExampleConf","Journal"]' && JSON.stringify(await A.js(`[...document.querySelectorAll('.tk-grip')].map(g => g.textContent)`)) === '["1","2"]', "dragging the second entry by its number onto the top half of the first puts it first");
  await A.js(`document.querySelectorAll('.tk-t')[0].focus()`);
  for (const type of ["keyDown", "keyUp"]) await A.cdp("Input.dispatchKeyEvent", { type, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, modifiers: 1 }); await wait(300);
  check(JSON.stringify(await titles()) === '["Journal","ExampleConf"]' && await A.js(`document.activeElement.classList.contains('tk-t') && /ExampleConf/.test(document.activeElement.textContent)`), "Alt+↓ on an entry moves it down, focus stays on it");

  // ---------- filters ----------
  await A.click(btn("tk-subs", "all"));
  await A.fill("tfTopic", "llm-evaluation"); await wait(200);
  check(JSON.stringify(await titles()) === '["Journal"]' && /Showing 1 of 2 entries/.test(await A.js(`document.querySelector('.sub').textContent`)), "filtering by topic: only matching entries, and the count says 1 of 2");
  await A.click(byText(".tk-nav .nav-i", "/Conferences 2027/"));
  check(JSON.stringify(await titles()) === '["Journal"]' && await A.js(`document.querySelector('#tfTopic').value`) === "llm-evaluation" && JSON.stringify(await A.js(`[...document.querySelectorAll('.tk-grip')].map(g => g.textContent)`)) === '["1"]', "filters carry over to a list, which keeps showing the true priority number");
  await A.click(btn("tkf-clear")); await A.fill("tfSt", "open"); await wait(200);
  check(JSON.stringify(await titles()) === '["ExampleConf"]', "Not submitted yet hides the one already submitted");
  await A.fill("tfSt", ""); await A.fill("tfKind", "chapter"); await wait(200);
  check(await A.js(`/match these filters/.test(document.querySelector('.empty').textContent)`), "no matches: says so, with Clear filters");
  await A.click(btn("tkf-clear"));
  check((await titles()).length === 2 && !(await A.js(`!!document.querySelector('.tk-flt [data-act="tkf-clear"]')`)), "Clear filters shows everything again");

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
  // ---------- projects ----------
  await A.click(btn("tk-projs", "all"));
  check(await A.js(`/All projects/.test(document.querySelector('.page-h').textContent) && /dated log of what happened/.test(document.querySelector('.empty').textContent)`), "All projects opens, with an explanation when empty");
  await A.click(btn("proj-new"));
  await A.click(btn("proj-save"));
  check(/Give the project a name/.test(await A.js(`document.querySelector('#pfMsg').textContent`)), "a project needs a name");
  await A.fill("pfName", "StudyDesk"); await A.fill("pfSum", "Local-first reading desk for papers"); await A.click(btn("pf-kind", "software"));
  await A.fill("pfGit", "github.com/someone/studydesk"); await A.click(btn("proj-save"));
  check(/should start with https/.test(await A.js(`document.querySelector('#pfMsg').textContent`)), "a repository link without https:// is refused with a reason");
  await A.fill("pfGit", "https://github.com/someone/studydesk.git"); await A.fill("pfVer", "1.2.0");
  await A.click(btn("pl-add")); await A.js(`(() => { const r = document.querySelector('#pfLinks .pf-link'); r.querySelector('[data-pl=label]').value = "PyPI"; r.querySelector('[data-pl=url]').value = "https://pypi.org/project/studydesk/"; })()`);
  await A.fill("pfNotes", "Ship the trackers. See p. 3 of the plan.");
  await A.click(btn("proj-save")); await wait(400);
  check(await A.js(`/StudyDesk/.test(document.querySelector('.page-h').textContent) && /My projects/.test(document.querySelector('.pj-nav').textContent)`), "saving opens the project's page; the first project makes a list called My projects");
  const links = await A.js(`[...document.querySelectorAll('.pj-links a')].map(a => a.textContent.trim())`);
  check(links[0] === "someone/studydesk ↗" && links[1] === "PyPI ↗", `GitHub shows as owner/name, other links by their label (${links})`);
  check(await A.js(`!document.querySelector('.pj-notes [data-act="goto"]') && /p\. 3/.test(document.querySelector('.pj-notes').textContent)`), "notes are rendered, and p. N stays plain text (there are no pages here)");
  await A.js(`document.querySelector('#puText').focus()`); await A.fill("puText", "Built the submissions tracker"); await A.key("Enter");
  await A.fill("puText", "Released 1.2.0 on PyPI"); await A.click(btn("pu-add"));
  check(JSON.stringify(await A.js(`[...document.querySelectorAll('.pu-t')].map(e => e.textContent.trim())`)) === '["Released 1.2.0 on PyPI","Built the submissions tracker"]' && await A.js(`document.activeElement.id`) === "puText", "updates are added with Enter or the button, newest first, ready for the next one");
  await A.fill("pjStatus", "paused"); await wait(300);
  check(/Status changed to\s*Paused/.test(await A.js(`document.querySelector('.pu-t').textContent`)), "changing the status logs it");
  await A.fill("pjStatus", "active"); await wait(300);
  await A.fill("pnText", "Write the My papers step"); await A.fill("pnDue", iso(2)); await A.click(btn("pn-save"));
  await A.fill("pmTitle", "Trackers in a release"); await A.fill("pmDue", iso(3)); await A.click(btn("pm-add"));
  await A.fill("pmTitle", "Desktop app"); await A.click(btn("pm-add"));
  check(await A.js(`document.querySelectorAll('.pm').length`) === 2 && /Trackers in a release/.test(await A.js(`document.querySelector('.pm').textContent`)), "milestones are added, dated ones first");
  await A.shot("tk-project");
  await A.click(btn("tk-projs", "all"));
  const card = await A.js(`document.querySelector('.tk-row').innerText`);
  check(/Status changed to Active/.test(card) && /Today/.test(card) && /Next: Write the My papers step/.test(card) && /Milestone: Trackers in a release/.test(card) && /v1\.2\.0/.test(card) && /someone\/studydesk/.test(card), "the card shows the latest update and when, the next step, the next milestone, version and repo");
  check(await A.js(`!!document.querySelector('.tk-row .tk-m .warn')`), "a milestone due within a week is flagged on the card");
  await A.click(btn("proj-open", await A.js(`document.querySelector('.tk-row').dataset.id`)));
  await A.js(`document.querySelector('.pm input[type=checkbox]').click()`); await wait(300);
  check(await A.js(`!!document.querySelector('.pm.done') && /Trackers in a release/.test(document.querySelector('.pm.done').textContent)`), "ticking a milestone marks it done");

  // a project nobody has touched for 20 days, written by another window
  const cur = await (await fetch(app + "api/tracker")).json(), ml = cur.tracker.lists.find(l => l.section === "projects");
  cur.tracker.projects.push({ id: "oldproj01", list: ml.id, name: "Thesis chapter 3", kind: "research", status: "active", addedAt: Date.now() - 40 * 864e5, updatedAt: Date.now() - 20 * 864e5,
    updates: [{ id: "u-old", at: Date.now() - 20 * 864e5, text: "Drafted the related work", status: null }], milestones: [], links: [], tags: [] });
  ml.order.push("oldproj01");
  check((await fetch(app + "api/tracker", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRev: cur.rev, tracker: cur.tracker }) })).ok, "(another window saves a project last updated 20 days ago)");
  await A.js(`window.dispatchEvent(new Event("focus"))`); await wait(900);
  await A.click(btn("tk-projs", ml.id));
  check(/No update in 20 days/.test(await A.js(`${byText(".tk-row", "/Thesis chapter 3/")}.innerText`)) && await A.js(`!!document.querySelector('.pj-nav .tk-dot')`), "an active project with no update for 20 days is marked, and its list gets a dot");
  await A.fill("tpSt", "stale"); await wait(200);
  check(JSON.stringify(await A.js(`[...document.querySelectorAll('.tk-t')].map(b => b.textContent)`)) === '["Thesis chapter 3"]', "the No update in 14+ days filter finds it");
  await A.click(btn("tpf-clear"));
  await A.click(`${byText(".tk-row", "/Thesis chapter 3/")}.querySelector('[data-act="tk-up"]')`);
  check(JSON.stringify(await A.js(`[...document.querySelectorAll('.tk-t')].map(b => b.textContent)`)) === '["Thesis chapter 3","StudyDesk"]', "projects reorder like submissions");

  // both windows log an update on the same project at once
  const pid = await A.js(`${byText(".tk-row", "/StudyDesk/")}.dataset.id`);
  await wait(800);
  await B.js(`window.dispatchEvent(new Event("focus"))`); await wait(900);
  await B.click(btn("tk-projs", "all")); await B.click(btn("proj-open", pid));
  await A.click(btn("proj-open", pid));
  await B.fill("puText", "Update from window B"); await B.click(btn("pu-add")); await wait(700);
  await A.fill("puText", "Update from window A"); await A.click(btn("pu-add")); await wait(1200);
  const pj = (await disk()).projects.find(x => x.id === pid);
  check(["Update from window A", "Update from window B", "Released 1.2.0 on PyPI"].every(t => pj.updates.some(u => u.text === t)), "two windows adding updates to the same project: both are kept, nothing lost");

  // delete
  await A.click(btn("proj-edit", pid)); await A.click(btn("proj-del")); await A.click(btn("proj-del-yes")); await wait(800);
  check(!(await disk()).projects.some(x => x.id === pid) && /Projects/.test(await A.js(`document.querySelector('.eyebrow').textContent`)), "deleting a project removes it and returns to its list");

  // ---------- my papers, and linking them ----------
  await A.click(btn("mypapers"));
  check(/pick them as the 1st, 2nd or 3rd choice/.test(await A.js(`document.querySelector('.empty').textContent`)), "My papers opens, with an explanation when empty");
  await A.click(btn("tk-subs", "all")); await A.click(byText(".tk-t", "/Chapter call from window B/"));
  check(/Add the papers you're writing under My papers/.test(await A.js(`document.querySelector('#sfForm').textContent`)), "with no papers yet, the submission form says where to add them");
  await A.click(btn("modal-close"));
  const pdfPath = join(work, "draft.pdf"), pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  writeFileSync(pdfPath, pdfBytes);
  await A.click(btn("mypapers")); await A.click(btn("mp-new"));
  await A.fill("mfTitle", "LLM evaluation survey"); await A.fill("mfProj", await A.js(`[...document.querySelectorAll('#mfProj option')].find(o => /Thesis/.test(o.textContent)).value`));
  await A.fill("mfTarget", iso(10));
  const doc = await A.cdp("DOM.getDocument"); const fi = await A.cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#mfFile" });
  await A.cdp("DOM.setFileInputFiles", { nodeId: fi.nodeId, files: [pdfPath] });
  await A.click(btn("mp-save")); await wait(800);
  await A.click(btn("mp-new")); await A.fill("mfTitle", "Benchmark paper"); await A.click(btn("mp-save")); await wait(400);
  const mps = (await disk()).myPapers, survey = mps.find(m => /survey/.test(m.title)), bench = mps.find(m => /Benchmark/.test(m.title));
  check(mps.length === 2 && survey.hasFile && survey.project === "oldproj01", "two papers saved; the survey belongs to the thesis project and has its draft");
  check(existsSync(join(lib, "pdfs", `${survey.id}.pdf`)) && readFileSync(join(lib, "pdfs", `${survey.id}.pdf`)).equals(pdfBytes), "the draft PDF is in the library folder, byte for byte");
  check(/Project: Thesis chapter 3/.test(await A.js(`${byText(".tk-row", "/survey/")}.innerText`)) && /Open draft PDF/.test(await A.js(`${byText(".tk-row", "/survey/")}.innerText`)), "the paper's row links its project and its draft");

  await A.click(btn("tk-subs", "all")); await A.click(byText(".tk-t", "/Chapter call from window B/"));
  await A.fill("sfT0", survey.id); await A.fill("sfT1", bench.id); await A.click(btn("sub-save")); await wait(400);
  check(/For\s*1st LLM evaluation survey\s*2nd Benchmark paper/i.test(await A.js(`${byText(".tk-row", "/Chapter call/")}.innerText`)), "a submission shows which of my papers it's for, 1st and 2nd choice");
  await A.fill("tfPaper", bench.id); await wait(200);
  check(JSON.stringify(await A.js(`[...document.querySelectorAll('.tk-t')].map(b => b.textContent)`)) === '["Chapter call from window B"]', "filtering by one of my papers shows the submissions aimed at it");
  await A.click(btn("tkf-clear"));
  await A.click(btn("mypapers"));
  check(/Aimed at\s*1st Chapter call from window B/i.test(await A.js(`${byText(".tk-row", "/survey/")}.innerText`)) && /Aimed at\s*2nd Chapter call/i.test(await A.js(`${byText(".tk-row", "/Benchmark/")}.innerText`)), "each paper lists where it's aimed, with the choice");
  await A.click(btn("tk-subs", "all"));
  await A.click(`${byText(".tk-row", "/Chapter call/")}.querySelector('[data-act="sub-mark"]')`);
  check(/with “LLM evaluation survey”/.test(await A.js(`document.querySelector('#toast').textContent`)) && /Sent\s*LLM evaluation survey/i.test(await A.js(`${byText(".tk-row", "/Chapter call/")}.innerText`)), "Mark as submitted records the 1st choice as the paper sent");
  await A.click(btn("mypapers"));
  const srow = await A.js(`${byText(".tk-row", "/survey/")}.innerText`);
  check(/Submitted to\s*Chapter call from window B\s*Submitted/i.test(srow) && !/Aimed at/i.test(srow), "the paper says where it was submitted and how that stands (no longer listed as aimed there)");
  check(/^Submitted/.test(srow) && /^Drafting/.test(await A.js(`${byText(".tk-row", "/Benchmark/")}.innerText`)), "sending it moved the paper from Drafting to Submitted; the 2nd choice paper stays as it was");
  await A.shot("tk-mypapers");

  await A.click(`${byText(".tk-row", "/survey/")}.querySelector('[data-act="proj-open"]')`);
  check(/LLM evaluation survey/.test(await A.js(`document.querySelector('.pp-list').textContent`)), "the project page lists the papers it produces");
  const first = await A.js(`document.querySelector('#ppAdd option:nth-child(2)').value`), firstTitle = await A.js(`document.querySelector('#ppAdd option:nth-child(2)').textContent`);
  await A.fill("ppAdd", first); await A.click(btn("pp-add"));
  await wait(600);
  check(await A.js(`!!document.querySelector('.pp-list [data-act="open"][data-v="${first}"]')`) && (await disk()).projects.find(x => x.id === "oldproj01").papers.includes(first), `a library paper can be linked as reading for the project (${firstTitle})`);
  await A.click(btn("pp-del", first));
  check(!(await A.js(`!!document.querySelector('.pp-list [data-act="open"][data-v="${first}"]')`)), "and unlinked again");

  await A.click(btn("mypapers")); await A.click(byText(".tk-t", "/Benchmark/")); await A.click(btn("mp-del")); await A.click(btn("mp-del-yes")); await wait(800);
  const after = await disk();
  check(after.myPapers.length === 1 && JSON.stringify(after.submissions.find(x => /Chapter/.test(x.title)).targets) === JSON.stringify([survey.id, null, null]), "deleting a paper clears it from submissions' choices and keeps the others");

  // ---------- upcoming, and the overview cards ----------
  {
    const cur = await (await fetch(app + "api/tracker")).json(), T = cur.tracker, wl = T.lists.find(l => l.section === "submissions");
    const sub = (id, o) => ({ id, list: wl.id, kind: "journal", title: id, url: "https://example.org/" + encodeURIComponent(id), topics: [], indexing: "unknown", status: "considering", addedAt: Date.now(), updatedAt: Date.now(), ...o });
    T.submissions.push(
      sub("Open journal", { deadline: { date: iso(4) }, zeroApcUntil: iso(40) }),
      sub("Open conf", { kind: "conference", deadline: { date: iso(20) }, conf: { abstract: iso(12), from: iso(90), place: "Kyoto" } }),
      sub("Sent conf", { kind: "conference", status: "review", deadline: { date: iso(-5) }, submitted: { date: iso(-6), paper: null }, conf: { notification: iso(8) } }),
      sub("Closed call", { deadline: { date: iso(-3) } }),
      sub("Free journal", { apc: { free: true }, zeroApcUntil: iso(5) }));
    T.lists.find(l => l.id === wl.id).order.push("Open journal", "Open conf", "Sent conf", "Closed call", "Free journal");
    const th = T.projects.find(p => p.id === "oldproj01");
    th.milestones = [{ id: "m-late", title: "Send draft to supervisor", due: iso(-2), done: false }, { id: "m-done", title: "Outline", due: iso(1), done: true }];
    T.myPapers.push({ id: "mp-bench2", title: "Benchmark 2", status: "drafting", targetDate: iso(25), addedAt: Date.now() });
    check((await fetch(app + "api/tracker", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRev: cur.rev, tracker: T }) })).ok, "(dated entries written to the tracker)");
  }
  await A.js(`window.dispatchEvent(new Event("focus"))`); await wait(900);
  check(await A.js(`document.querySelector('[data-act="upcoming"] .ct')?.textContent`) === "2", "the sidebar's Upcoming count is what's overdue or due within 7 days (2)");
  await A.click(btn("upcoming"));
  const groups = await A.js(`Object.fromEntries([...document.querySelectorAll('.wrap > .sec')].map(s => [s.querySelector('h2').textContent, [...s.querySelectorAll('.up-i')].map(i => i.querySelector('.up-w').textContent + ": " + i.querySelector('.up-t').textContent)]))`);
  check(JSON.stringify(groups.Overdue) === JSON.stringify(["Milestone: Send draft to supervisor (Thesis chapter 3)"]), `Overdue: an unfinished milestone past its date (${groups.Overdue})`);
  check(JSON.stringify(groups["This week"]) === JSON.stringify(["Submission deadline: Open journal"]), `This week: the deadline 4 days away (${groups["This week"]})`);
  check(JSON.stringify(groups["Next 30 days"]) === JSON.stringify(["Notification: Sent conf", "Abstract deadline: Open conf", "Paper deadline: Open conf", "Paper target: Benchmark 2"]), `Next 30 days, in date order (${groups["Next 30 days"]})`);
  check(JSON.stringify(groups.Later) === JSON.stringify(["Free to publish until: Open journal", "Conference starts: Open conf, Kyoto"]), `Later (${groups.Later})`);
  const allT = JSON.stringify(groups);
  check(!/Closed call|Outline|Free journal|deadline: Sent conf/.test(allT), "left out: closed deadlines, a submitted paper's own deadline, done milestones, and zero-APC dates for calls with no APC");
  check(/2 days overdue/.test(await A.js(`document.querySelector('.up-n.over').textContent`)), "overdue items say by how much");
  await A.shot("tk-upcoming");
  await A.click(byText(".up-i", "/Abstract deadline/"));
  check(await A.js(`document.querySelector('#sfTitle')?.value`) === "Open conf", "clicking a date opens that entry");
  await A.click(btn("modal-close"));
  await A.click(btn("home"));
  const home = await A.js(`[...document.querySelectorAll('.sec h2')].map(h => h.textContent)`);
  check(home.includes("Coming up") && home.includes("Projects"), "the overview gets Coming up and Projects");
  check(await A.js(`[...document.querySelectorAll('.sec')].find(s => /Coming up/.test(s.textContent)).querySelectorAll('.up-i').length`) === 5 && /Thesis chapter 3/.test(await A.js(`[...document.querySelectorAll('.sec')].find(s => s.querySelector('h2')?.textContent === "Projects").textContent`)), "Coming up shows the next 5; Projects shows the active one with its stale marker");
  await A.shot("tk-overview");

  // ---------- images ----------
  {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR42mNkYPhfz0AEYBxVSF+FjAwM/xkYGBgAKZgD/Sq4mSkAAAAASUVORK5CYII=", "base64");
    const pngPath = join(work, "flyer.png"), txtPath = join(work, "notes.txt");
    writeFileSync(pngPath, png); writeFileSync(txtPath, "not an image");
    const setFile = async (T, sel, path) => { const d = await T.cdp("DOM.getDocument"); const n = await T.cdp("DOM.querySelector", { nodeId: d.root.nodeId, selector: sel }); await T.cdp("DOM.setFileInputFiles", { nodeId: n.nodeId, files: [path] }); await wait(300); };
    const imgFiles = () => existsSync(join(lib, "images")) ? readdirSync(join(lib, "images")).filter(f => !f.startsWith(".")) : [];
    await A.click(btn("tk-subs", "all")); await A.click(byText(".tk-t", "/^Open journal$/"));
    await setFile(A, "#xfImgIn", txtPath);
    check(/isn't a PNG, JPEG, WebP or GIF/.test(await A.js(`document.querySelector('#sfMsg').textContent`)) && !(await A.js(`!!document.querySelector('.img-prev')`)), "a file that isn't an image is refused, with a reason");
    await setFile(A, "#xfImgIn", pngPath);
    check(await A.js(`!!document.querySelector('.img-prev img[src^="blob:"]') && /Replace image/.test(document.querySelector('#xfImg').textContent)`), "choosing an image shows a preview before saving");
    await A.click(btn("sub-save")); await wait(800);
    const sub1 = (await disk()).submissions.find(x => x.title === "Open journal");
    check(sub1.image && sub1.image.type === "image/png" && readFileSync(join(lib, "images", `${sub1.image.id}.png`)).equals(png), "saved: the image is a file in images/, and the entry points to it");
    check(await A.js(`(() => { const i = ${byText(".tk-row", "/Open journal/")}.querySelector('.tk-thumb img'); return !!i && i.complete && i.naturalWidth === 16; })()`), "the row shows it as a thumbnail");
    await A.shot("tk-images");
    await A.click(`${byText(".tk-row", "/Open journal/")}.querySelector('.tk-thumb')`); await wait(300);
    check(await A.js(`(() => { const i = document.querySelector('.img-view img'); return !!i && i.naturalWidth === 16; })()`), "clicking the thumbnail shows the image");
    await A.click(btn("modal-close"));
    await A.click(byText(".tk-t", "/^Open journal$/")); await setFile(A, "#xfImgIn", pngPath); await A.click(btn("sub-save")); await wait(800);
    const sub2 = (await disk()).submissions.find(x => x.title === "Open journal");
    check(sub2.image.id !== sub1.image.id && JSON.stringify(imgFiles()) === JSON.stringify([`${sub2.image.id}.png`]), "replacing the image stores the new one and deletes the old file");
    await A.click(btn("tk-projs", "all")); await A.click(btn("proj-open", "oldproj01")); await A.click(btn("proj-edit", "oldproj01"));
    await A.js(`(() => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png.toString("base64"))}), c => c.charCodeAt(0))], "shot.png", {type:"image/png"})); document.querySelector('#pfName').dispatchEvent(new ClipboardEvent("paste", {bubbles:true, cancelable:true, clipboardData:dt})); })()`); await wait(300);
    check(await A.js(`!!document.querySelector('#pfForm .img-prev img[src^="blob:"]')`), "pasting a screenshot into the project form sets its image");
    await A.click(btn("proj-save")); await wait(900);
    check(await A.js(`(() => { const i = document.querySelector('.pj-img img'); return !!i && i.naturalWidth === 16; })()`) && imgFiles().length === 2, "the project page shows the image; it's saved next to the other");
    await A.click(btn("proj-edit", "oldproj01")); await A.click(btn("img-rm"));
    check(await A.js(`!document.querySelector('#pfForm .img-prev') && /Choose image/.test(document.querySelector('#xfImg').textContent)`), "Remove takes the image off the form");
    await A.click(btn("proj-save")); await wait(800);
    check(!(await A.js(`!!document.querySelector('.pj-img')`)) && imgFiles().length === 1 && !(await disk()).projects.find(p => p.id === "oldproj01").image, "saved without it: the file is deleted and the entry has no image");
    await A.click(btn("tk-subs", "all")); await A.click(byText(".tk-t", "/^Open journal$/")); await A.click(btn("sub-del")); await A.click(btn("sub-del-yes")); await wait(800);
    check(imgFiles().length === 0, "deleting an entry deletes its image");

    // browser mode (static server): images go to IndexedDB and come back after a reload
    const st = spawn("node", ["scripts/serve.mjs", "5198"], { stdio: "ignore" }); await wait(1200);
    try {
      const C = await tab("http://localhost:5198/");
      await C.click(btn("tk-subs", "all")); await C.click(btn("sub-new"));
      await C.fill("sfUrl", "https://static.example.org/call"); await C.fill("sfTitle", "Browser-mode call");
      await setFile(C, "#xfImgIn", pngPath); await C.click(btn("sub-save")); await wait(600);
      await C.cdp("Page.reload"); await wait(2000); await C.click(btn("tk-subs", "all")); await wait(400);
      check(await C.js(`(() => { const i = document.querySelector('.tk-thumb img'); return !!i && i.src.startsWith("blob:") && i.naturalWidth === 16; })()`) && await C.js(`JSON.parse(localStorage.getItem("studydesk.tracker.v1")).submissions[0].title`) === "Browser-mode call", "on a static server the tracker is in localStorage and the image in IndexedDB; both survive a reload");
      check(!C.errs.length, `no script errors in browser mode (${C.errs.join(" | ")})`);
      C.close();
    } finally { st.kill(); }
  }

  await A.cdp("Page.reload"); await wait(2000);
  check(await A.js(`document.querySelector('.tk-nav').innerText.includes("Where to submit")`), "after a reload the sidebar still lists it");
  check(!A.errs.length && !B.errs.length, `no script errors (${[...A.errs, ...B.errs].join(" | ")})`);
  A.close(); B.close();
} catch (e) { console.log("FAIL", e.message); fails++; }
finally { srv.kill(); }
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
