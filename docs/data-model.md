# Data model

## Prototype JSON

The same paper objects are stored in two places depending on the mode (architecture.md § Where your data lives):
- under `studydesk`: `papers` in `<library folder>/library.json`, wrapped as `{"format":"pdfdesk-library","formatVersion":1,"savedAt":"…","papers":[…]}`; `ui` in `localStorage["pdfdesk.ui.v1"]`;
- on a static server: the whole object below in `localStorage["researchdesk.v1"]`.

```jsonc
{
  "papers": [{
    "id": "k3j2h1ab",
    "sample": false,            // true for seeded example papers
    "hasFile": true,            // PDF blob present in IndexedDB under the same id
    "title": "…", "authors": "…", "year": 2017, "venue": "NeurIPS",
    "pages": 15,
    "status": "reading",        // inbox|planned|reading|paused|completed|revisit
    "tags": ["transformers"],
    "notes": "markdown…",
    "highlights": [{
      "id": "…", "page": 4, "color": "yellow",   // yellow|green|blue|pink
      "text": "selected text",
      "rects": [{"x":0.1,"y":0.2,"w":0.5,"h":0.015}],  // page-relative, null if unknown
      "prefix": "…text just before", "suffix": "text just after…",  // up to 48 chars each, for re-anchoring
      "lost": true,                                // only when a replaced PDF no longer contains the text
      "comment": "", "at": 1762170000000
    }],
    "sessions": [{
      "id": "…", "date": 1762170000000,          // session start (ms)
      "from": 9, "to": 12, "minutes": 35, "note": "…"
    }],
    "bookmarks": [5],
    "target": {"page": 13, "date": "2026-11-04"}, // or null
    "arxiv": "1706.03762", "doi": "", "url": "https://arxiv.org/abs/1706.03762",  // set when added by arXiv ID, DOI or link
    "abstract": "",                               // pasted or typed; a paper added by link often has only this and its url
    "addedAt": 0, "lastOpened": 0, "lastPage": 12, "maxPage": 12
  }],
  "ui": {"view":"home","filter":"all","tab":"notes","nmode":"preview","hlFilter":"all","zoom":1,"q":"",
         "lastExport": 1762190000000}   // set by Export library; shown on the About page
}
```

## Trackers JSON (`tracker.json`)

Submissions, projects and my papers ([trackers.md](trackers.md)) are one document apart from the papers:
- under `studydesk`: `<library folder>/tracker.json`, wrapped as `{"format":"studydesk-tracker","formatVersion":1,"savedAt":"…", …the four collections}`, with its own rev (`GET/PUT /api/tracker`); images in `images/<image-id>.<ext>`, my papers' drafts in `pdfs/<my-paper-id>.pdf`;
- on a static server: `localStorage["studydesk.tracker.v1"]`; images in IndexedDB `researchdesk` / `files` under `img:<image-id>`, drafts under the paper's id.

It is never written into `library.json`: studydesk 1.2.0 rewrites that file with papers only and would drop it.

```jsonc
{
  "lists": [{"id":"…", "section":"submissions", "name":"Q1 journals", "order":["entry-id", "…"], "addedAt":0}],   // section: submissions|projects; order = priority
  "submissions": [{
    "id":"…", "list":"list-id", "kind":"journal",          // journal|special|chapter|conference
    "title":"…", "url":"https://…", "topics":["llm"], "details":"markdown…",
    "indexing":"scopus",                                    // scopus|none|unknown
    "deadline":{"date":"2027-01-15", "time":"23:59", "aoe":true},   // time optional (end of day); aoe = UTC−12
    "apc":{"amount":1800, "currency":"USD"},                // or {"free":true}, or null when unknown
    "zeroApcUntil":"2026-12-31",
    "conf":{"abstract":"", "notification":"", "cameraReady":"", "from":"", "to":"", "place":""},   // conferences; the paper deadline is "deadline"
    "targets":["my-paper-id", null, null],                  // 1st, 2nd, 3rd choice
    "status":"considering",                                 // considering|preparing|submitted|review|revision|accepted|rejected|withdrawn|missed
    "submitted":{"date":"2026-11-13", "paper":"my-paper-id"},        // or null; set for submitted and later
    "image":{"id":"…", "type":"image/png"},                 // or null; a new id for every upload
    "addedAt":0, "updatedAt":0
  }],
  "projects": [{
    "id":"…", "list":"list-id", "name":"…", "summary":"…",
    "kind":"software",                                      // research|software|opensource|course|work|personal
    "status":"active",                                      // idea|planning|active|blocked|paused|done|dropped
    "updates":[{"id":"…", "at":0, "text":"Released 1.2.0", "status":null}],   // newest first; a status change logs {"status":"paused","text":""}
    "next":{"text":"…", "due":"2026-11-20"},                // or null
    "milestones":[{"id":"…", "title":"…", "due":"2026-12-01", "done":false}],
    "github":"https://github.com/owner/name", "links":[{"label":"PyPI", "url":"https://…"}], "version":"1.2.0",
    "started":"2026-11-03", "targetDate":"", "tags":[], "people":"", "notes":"markdown…",
    "papers":["library-paper-id"],                          // library papers read for it
    "image":null, "addedAt":0, "updatedAt":0
  }],
  "myPapers": [{
    "id":"…", "title":"…", "status":"drafting",             // idea|drafting|ready|submitted|review|revising|accepted|published
    "targetDate":"", "project":"project-id",                // or null; a project's own papers are found by this field
    "hasFile":false, "notes":"", "addedAt":0, "updatedAt":0
  }]
}
```

`ui` gains `tkList` (the list open in Submissions or Projects), `tkItem` (the open project), `tkF` and `tpF` (filters).

## Proposed SQLite schema (desktop)

```sql
CREATE TABLE paper (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  authors       TEXT,             -- display string; normalise later if needed
  year          INTEGER,
  venue         TEXT,
  doi           TEXT,
  arxiv_id      TEXT,
  file_path     TEXT,             -- relative to library root
  file_hash     TEXT,             -- sha256, detects replaced PDFs
  page_count    INTEGER,
  status        TEXT NOT NULL DEFAULT 'inbox'
                CHECK (status IN ('inbox','planned','reading','paused','completed','revisit')),
  last_page     INTEGER DEFAULT 1,
  max_page      INTEGER DEFAULT 0,
  added_at      INTEGER NOT NULL,
  last_opened   INTEGER
);

CREATE TABLE status_change (     -- lifecycle history
  id INTEGER PRIMARY KEY, paper_id TEXT REFERENCES paper(id) ON DELETE CASCADE,
  from_status TEXT, to_status TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE paper_tag (paper_id TEXT REFERENCES paper(id) ON DELETE CASCADE,
                        tag_id INTEGER REFERENCES tag(id) ON DELETE CASCADE,
                        PRIMARY KEY (paper_id, tag_id));

CREATE TABLE note (               -- one main note per paper for now
  paper_id TEXT PRIMARY KEY REFERENCES paper(id) ON DELETE CASCADE,
  body_md  TEXT NOT NULL DEFAULT '', updated_at INTEGER
);

CREATE TABLE highlight (
  id          TEXT PRIMARY KEY,
  paper_id    TEXT REFERENCES paper(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,
  color       TEXT NOT NULL,
  text        TEXT NOT NULL,
  prefix      TEXT,               -- ~32 chars before, for re-anchoring
  suffix      TEXT,               -- ~32 chars after
  rects_json  TEXT,               -- page-relative rects
  file_hash   TEXT,               -- PDF version the rects belong to
  comment     TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE session (
  id         TEXT PRIMARY KEY,
  paper_id   TEXT REFERENCES paper(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  page_from  INTEGER, page_to INTEGER,
  active_sec INTEGER NOT NULL,
  note       TEXT
);

CREATE TABLE bookmark (paper_id TEXT REFERENCES paper(id) ON DELETE CASCADE, page INTEGER,
                       label TEXT, PRIMARY KEY (paper_id, page));

CREATE TABLE target (paper_id TEXT PRIMARY KEY REFERENCES paper(id) ON DELETE CASCADE,
                     page INTEGER, due_date TEXT);

CREATE TABLE paper_link (         -- research connections between papers
  from_id TEXT REFERENCES paper(id) ON DELETE CASCADE,
  to_id   TEXT REFERENCES paper(id) ON DELETE CASCADE,
  kind    TEXT,                   -- builds-on | compares | same-method | contradicts …
  note    TEXT,
  PRIMARY KEY (from_id, to_id, kind)
);

CREATE VIRTUAL TABLE search USING fts5(paper_id UNINDEXED, kind, page UNINDEXED, body);
-- rows for: extracted page text, highlights, notes

-- trackers (tracker.json); dates are ISO 'YYYY-MM-DD' text, as in the JSON
CREATE TABLE tracker_list (id TEXT PRIMARY KEY, section TEXT NOT NULL CHECK (section IN ('submissions','projects')),
                           name TEXT NOT NULL, added_at INTEGER);
CREATE TABLE submission (
  id TEXT PRIMARY KEY, list_id TEXT REFERENCES tracker_list(id) ON DELETE CASCADE, rank INTEGER,
  kind TEXT NOT NULL, title TEXT, url TEXT NOT NULL, details_md TEXT, indexing TEXT,
  deadline_date TEXT, deadline_time TEXT, deadline_aoe INTEGER DEFAULT 0,
  apc_amount REAL, apc_currency TEXT, apc_free INTEGER DEFAULT 0, zero_apc_until TEXT,
  conf_abstract TEXT, conf_notification TEXT, conf_camera_ready TEXT, conf_from TEXT, conf_to TEXT, conf_place TEXT,
  status TEXT NOT NULL, submitted_date TEXT, submitted_paper TEXT REFERENCES my_paper(id) ON DELETE SET NULL,
  image_path TEXT, added_at INTEGER, updated_at INTEGER
);
CREATE TABLE submission_target (submission_id TEXT REFERENCES submission(id) ON DELETE CASCADE,
                                choice INTEGER CHECK (choice IN (1,2,3)), my_paper_id TEXT REFERENCES my_paper(id) ON DELETE CASCADE,
                                PRIMARY KEY (submission_id, choice));
CREATE TABLE project (
  id TEXT PRIMARY KEY, list_id TEXT REFERENCES tracker_list(id) ON DELETE CASCADE, rank INTEGER,
  name TEXT NOT NULL, summary TEXT, kind TEXT, status TEXT NOT NULL, github TEXT, version TEXT,
  started TEXT, target_date TEXT, people TEXT, notes_md TEXT, next_text TEXT, next_due TEXT,
  image_path TEXT, added_at INTEGER, updated_at INTEGER
);
CREATE TABLE project_update (id TEXT PRIMARY KEY, project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
                             at INTEGER NOT NULL, text TEXT, status TEXT);
CREATE TABLE milestone (id TEXT PRIMARY KEY, project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
                        title TEXT NOT NULL, due TEXT, done INTEGER DEFAULT 0);
CREATE TABLE project_link (project_id TEXT REFERENCES project(id) ON DELETE CASCADE, label TEXT, url TEXT NOT NULL);
CREATE TABLE project_paper (project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
                            paper_id TEXT REFERENCES paper(id) ON DELETE CASCADE, PRIMARY KEY (project_id, paper_id));
CREATE TABLE my_paper (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, target_date TEXT,
                       project_id TEXT REFERENCES project(id) ON DELETE SET NULL, file_path TEXT, notes_md TEXT,
                       added_at INTEGER, updated_at INTEGER);
-- topics and project tags reuse tag via submission_tag / project_tag join tables like paper_tag
```

Reading-calendar queries come straight from `session` (`GROUP BY date(started_at/1000,'unixepoch','localtime')`).
