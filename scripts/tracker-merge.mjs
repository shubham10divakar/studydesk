// Merge rules for the tracker (mergeTracker3 in app.js), run on the functions pulled out of app.js. No browser needed.
//   node scripts/tracker-merge.mjs   (from the repo root)
import { readFileSync } from "node:fs";
const src = readFileSync(process.argv[2] || "prototype/app.js", "utf8");
const grab = name => { const i = src.indexOf(`function ${name}(`); let d = 0, j = src.indexOf("{", i); for (; j < src.length; j++){ if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; } return src.slice(i, j + 1); };
const f = new Function(`const jsn = x => JSON.stringify(x);\n${grab("mergeById3")}\n${grab("mergeTracker3")}\nreturn {mergeById3, mergeTracker3};`)();
let fails = 0; const ok = (c, w) => { console.log(c ? "PASS" : "FAIL", w); if (!c) fails++; };
const E = () => ({lists:[], submissions:[], projects:[], myPapers:[]});
const base = {...E(), lists:[{id:"L", name:"Q1", order:["a","b"]}], submissions:[{id:"a", title:"A"}, {id:"b", title:"B"}, {id:"c", title:"C"}],
  projects:[{id:"p", name:"P", status:"active", updates:[{id:"u1", at:1, text:"start"}], milestones:[]}]};
const theirs = JSON.parse(JSON.stringify(base)), mine = JSON.parse(JSON.stringify(base));
theirs.submissions[0].title = "A (theirs)";            // changed only there
mine.submissions[1].title = "B (mine)";                 // changed only here
theirs.submissions = theirs.submissions.filter(x => x.id !== "c");   // removed there, untouched here
mine.submissions.push({id:"d", title:"D new here"});     // added here
theirs.submissions.push({id:"e", title:"E new there"});  // added there
theirs.lists[0].order.push("e"); mine.lists[0].order = ["b","a","d"];   // both reorder/add
theirs.projects[0].updates.unshift({id:"u2", at:3, text:"there"}); mine.projects[0].updates.unshift({id:"u3", at:2, text:"here"}); mine.projects[0].status = "paused";
const out = f.mergeTracker3(base, theirs, mine), S = id => out.submissions.find(x => x.id === id);
ok(S("a").title === "A (theirs)", "a change made only in the other window is kept");
ok(S("b").title === "B (mine)", "a change made only here is kept");
ok(!S("c"), "an entry removed in the other window stays removed");
ok(S("d") && S("e"), "entries added on either side are both kept");
ok(JSON.stringify(out.lists[0].order) === '["b","a","d","e"]', `list order: this window's, plus what the other added (${out.lists[0].order})`);
const p = out.projects[0];
ok(p.status === "paused" && p.updates.map(u => u.id).join() === "u2,u3,u1", `project edited in both: updates unioned newest first (${p.updates.map(u => u.id)}), this window's status`);
const m2 = JSON.parse(JSON.stringify(base)); m2.submissions = m2.submissions.filter(x => x.id !== "a");
const t2 = JSON.parse(JSON.stringify(base)); t2.submissions[0].title = "A edited there";
ok(f.mergeTracker3(base, t2, m2).submissions.some(x => x.id === "a"), "deleted here but edited there: the edit survives");
process.exit(fails ? 1 : 0);
