# Trackers: submissions, projects, my papers (plan)

Status: **being built, step by step** (progress under Build order). Agreed 2026-11-13; kept simple on purpose, see Decisions at the end.

StudyDesk today records what you read. The trackers record what you *make* and where it goes:

- **Submissions**: places you could send a paper (journals, special issues, book chapter calls, conferences), with their deadlines, costs, indexing and status.
- **Projects**: work you are doing now (research, software, open source, courses), with its status, its latest update, GitHub and other links, and what comes next.
- **My papers**: your own manuscripts. They connect the two: a project produces papers, and each paper has 1st, 2nd and 3rd choice submissions.

All three share **lists** (you make as many as you like and order each one by priority) and one **Upcoming** view of every date that matters.

## What the user sees

Sidebar, below the library:

```
Submissions          Projects
  Upcoming             Active
  Q1 journals          StudyDesk work
  Conferences 2027     Thesis
  Free until March     + New list
  + New list
My papers
```

- **A list** shows its entries in priority order; drag to reorder (the position is the priority). Filters across the top.
- **Upcoming** shows every dated item across all lists, nearest first: submission deadlines, zero-APC last dates, conference abstract/paper/camera-ready dates, project milestones, my-paper target dates. Overdue entries are marked, and those within 7 days are flagged.
- **Overview** gains two cards: the next 5 dates from Upcoming, and active projects with their last update (stale ones marked).
- **Adding** starts from a link (paste it, fill the rest). No scraping of conference or journal pages: they vary too much, and lookups are limited to fixed hosts (D-011).

## Submissions

One entry per call/venue. Conferences are the same entry with extra dates, so there is one tracker, filterable to conferences only.

| Field | Notes |
|---|---|
| Kind | Journal, Special issue, Book chapter, Conference |
| Title, link | Link required; title defaults to the link's host if left empty |
| Image | Optional screenshot or flyer of the call |
| Details | Markdown, same renderer as paper notes |
| Topics | Tags, with the same tag picker as papers |
| Indexing | Scopus / Not Scopus / Unknown (room for Web of Science etc. later) |
| Papers to target | 1st, 2nd, 3rd choice (from My papers) |
| Submission deadline | Date, optional time, optional AoE (Anywhere on Earth) |
| APC | Amount + currency, or Free |
| Zero-APC last date | Free to publish until this date |
| Status | Considering, Preparing, Submitted, Under review, Revision requested, Accepted, Rejected, Withdrawn, Missed |
| Mark as submitted | One click: sets status, date submitted, and which paper went in |
| Conference only | Abstract deadline, full-paper deadline, notification, camera-ready, conference dates, place |

Filters: kind, indexing, status, topic, targeted paper, "free to publish now".

## Projects

For someone who runs research and software side by side. The key thing is **the last status**: what happened most recently and what comes next, visible without opening the project.

| Field | Notes |
|---|---|
| Name, summary | Summary is one line, shown on the card |
| Kind | Research, Software, Open source, Course, Work, Personal |
| Status | Idea, Planning, Active, Paused, Blocked, Done, Dropped |
| Updates | A dated log: "13 Nov: released 1.2.0 on PyPI". The newest is the card's "last update", with its age. A status change adds a line by itself |
| Next step | One line, optional due date |
| Milestones | Title, due date, done. Due dates feed Upcoming |
| GitHub | Repo link, shown as `owner/name`. Typed by you; the app does not contact GitHub |
| Other links | Label + URL: docs, demo, PyPI, Overleaf, dataset, Drive, issue tracker… |
| Version | Current version for software (e.g. 1.2.0) |
| Dates | Started, target finish |
| Tags | Tech stack or topics, same tag picker |
| People | Collaborators, free text |
| Image | Optional (logo, diagram, screenshot) |
| Notes | Markdown |
| Linked | Papers from the library (the reading behind the project) and My papers it produces |

- **Stale marker**: an Active project with no update in 14 days is marked on its card and on Overview.
- **Project page**: header with status and link buttons, then "Add update" (one line, Enter saves) above the update log, next step, milestones, linked papers, notes.

## My papers

Small on purpose: title, status (Idea, Drafting, Ready, Submitted, Under review, Revising, Accepted, Published), target date, optional draft PDF, project, notes. Its page shows its 1st/2nd/3rd choice submissions and where it was actually submitted, with outcomes. This is what makes "paper to target" a real link instead of free text.

## Data

**A separate file, `tracker.json`, next to `library.json`.** Not inside `library.json`: studydesk 1.2.0 rewrites that file with papers only, so opening the folder with 1.2.0 again would silently delete every tracker entry. A separate file is ignored by older versions.

```
~/StudyDesk/
├─ library.json        (unchanged)
├─ tracker.json        {"format":"studydesk-tracker","formatVersion":1,"savedAt":…, lists, submissions, projects, myPapers}
├─ images/<id>.<ext>   optional images (png, jpg, webp; size-capped)
├─ pdfs/<id>.pdf       my-paper drafts go here too, under their own ids
└─ backups/tracker-YYYY-MM-DD.json
```

The format id is new, so it can use the StudyDesk name; D-013 only fixes the existing ids.

```jsonc
{
  "lists": [{"id":"…","section":"submissions","name":"Q1 journals","order":["sub-id", "…"]}],
  "submissions": [{
    "id":"…","list":"list-id","kind":"journal",        // journal|special|chapter|conference
    "title":"…","url":"https://…","image":null,       // image id or null
    "details":"markdown…","topics":["llm"],
    "indexing":"scopus",                                // scopus|none|unknown
    "targets":["mypaper-1","mypaper-2",null],           // 1st, 2nd, 3rd choice
    "deadline":{"date":"2027-01-15","time":"23:59","aoe":true},
    "apc":{"amount":1800,"currency":"USD"},             // or {"free":true}
    "zeroApcUntil":"2026-12-31",
    "conf":{"abstract":null,"paper":null,"notification":null,"cameraReady":null,"from":null,"to":null,"place":""},
    "status":"considering",
    "submitted":{"date":"…","paper":"mypaper-1"},       // or null
    "addedAt":0,"updatedAt":0
  }],
  "projects": [{
    "id":"…","list":"list-id","name":"…","summary":"…","kind":"software","status":"active",
    "updates":[{"id":"…","at":0,"text":"Released 1.2.0","status":null}],
    "next":{"text":"…","due":null},
    "milestones":[{"id":"…","title":"…","due":"2026-12-01","done":false}],
    "github":"owner/name","links":[{"label":"PyPI","url":"…"}],"version":"1.2.0",
    "started":"2026-11-03","targetDate":null,"tags":[],"people":"","image":null,"notes":"",
    "papers":["library-paper-id"],"myPapers":["mypaper-id"],
    "addedAt":0,"updatedAt":0
  }],
  "myPapers": [{"id":"…","title":"…","status":"drafting","targetDate":null,"hasFile":false,"project":null,"notes":"","addedAt":0,"updatedAt":0}]
}
```

- **Server**: `GET/PUT /api/tracker` with the same rev check, atomic write, daily backup and Host/Origin rules as `/api/library`; `GET/PUT/DELETE /api/image/<id>` like PDFs (same id pattern, content type checked, size cap).
- **Two windows**: a 409 merges three ways like papers do (`mergeTracker3` in `app.js`): by id, a change made on only one side wins, and removals are honoured unless the other side changed that entry. An entry changed in both windows takes this window's version, except that a project's update log and milestones are unioned by id, and a list's order keeps entries the other window added.
- **Browser-storage mode**: a new localStorage key `studydesk.tracker.v1`; images in the existing IndexedDB under prefixed ids.
- **Code**: `Store.read_tracker` / `write_tracker` in `studydesk/store.py`; the `tracker storage` section of `app.js` (`TK` is the tracker, `tsave()` / `tsaveSoon()` its save, `TDISK` the disk state). `GET /api/info` also returns `trackerRev`, so coming back to a window picks up tracker changes made elsewhere.
- **Export / import**: the zip adds `tracker.json`, `images/` and `tracker.md` (readable). Import merges with the rules above. Older StudyDesk versions ignore the extra files.
- `data-model.md` gets these tables before Phase 2, so the SQLite schema includes them.

## Build order

One commit per step, pushed, shown working (e2e + screenshot). Docs in one commit at the end.

Each step leaves the app working, so building can stop after any of them.

- [x] 1. `tracker.json` store, `/api/tracker`, merge, browser-storage fallback, unit tests (no UI yet)
- [x] 2. Lists and submissions: add, edit, delete, mark as submitted. Sidebar *Submissions* section, list view (`subsHTML`), form (`showSubForm` / `subSave`), list create/rename/delete. Test: `scripts/e2e/trackers.mjs`
- [x] 3. Reorder by drag (the priority number is the handle), arrows and Alt+↑/↓; filters for kind, indexing, status, topic, free to publish now (`S.ui.tkF`, per browser, shared by all lists)
- [x] 4. Projects: list view (`projsHTML`), project page (`projectHTML`) with update log, status select, next step, milestones; form (`showProjForm` / `projSave`) with GitHub and other links; stale marker and filter. Linking library papers and My papers comes with step 5
- [ ] 5. My papers, and linking them to submissions and projects
- [ ] 6. Upcoming view and the two Overview cards
- [ ] 7. Images
- [ ] 8. Export / import of the tracker
- [ ] 9. Docs: README, About `FEATURES`, CHANGELOG, roadmap, architecture, data-model (each step also updates the docs it touches)

Later, if wanted: search across trackers.

## Decisions (2026-11-13)

1. **My papers** is its own small list, and "papers to target" links to it.
2. **GitHub details are typed by hand.** No fetching from api.github.com, so D-011's host list stays as it is.
3. **One list per entry.** Filters do the cross-cutting views.
4. **No calendar export.** Upcoming and Overview are where dates show.
5. Status steps, section names (Submissions, Projects, My papers) and the 14-day stale marker stay as written above; change them later if they don't fit in use.
