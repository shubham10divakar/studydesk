"""Tests for the library folder and its HTTP API. Run: python -m unittest discover tests"""

from __future__ import annotations

import functools
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from studydesk.cli import Handler, Server, static_dir
from studydesk.store import Store


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "lib")
        handler = functools.partial(Handler, directory=str(static_dir()))
        self.srv = Server(("127.0.0.1", 0), handler)
        self.port = self.srv.server_address[1]
        self.srv.verbose = False
        self.srv.store = self.store
        self.srv.allowed_hosts = {f"localhost:{self.port}", f"127.0.0.1:{self.port}"}
        self.srv.allowed_origins = {f"http://{h}" for h in self.srv.allowed_hosts}
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def req(self, method, path, body=None, headers=None, host=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": host or f"localhost:{self.port}", **(headers or {})}
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data

    def j(self, *a, **k):
        status, data = self.req(*a, **k)
        return status, json.loads(data) if data else None

    def test_empty_folder(self):
        st, info = self.j("GET", "/api/info")
        self.assertEqual(st, 200)
        self.assertEqual(info["app"], "studydesk")
        self.assertEqual(info["rev"], "0")
        self.assertEqual(Path(info["dataDir"]), self.store.root)
        self.assertEqual(self.j("GET", "/api/library"), (200, {"rev": "0", "papers": None}))

    def test_save_and_conflict(self):
        papers = [{"id": "a1", "title": "One", "notes": "héllo"}]
        st, r = self.j("PUT", "/api/library", {"baseRev": "0", "papers": papers})
        self.assertEqual(st, 200)
        rev1 = r["rev"]
        self.assertEqual(self.j("GET", "/api/library")[1], {"rev": rev1, "papers": papers})
        doc = json.loads((self.store.root / "library.json").read_text(encoding="utf-8"))
        self.assertEqual((doc["format"], doc["formatVersion"], doc["papers"]), ("pdfdesk-library", 1, papers))
        # a second window still holding rev "0" gets the current library back instead of overwriting it
        st, r = self.j("PUT", "/api/library", {"baseRev": "0", "papers": []})
        self.assertEqual(st, 409)
        self.assertEqual(r, {"rev": rev1, "papers": papers})
        st, r = self.j("PUT", "/api/library", {"baseRev": rev1, "papers": papers + [{"id": "b2", "title": "Two"}]})
        self.assertEqual(st, 200)
        self.assertNotEqual(r["rev"], rev1)
        # the first save of the day leaves a backup of the previous file
        self.assertEqual(len(list((self.store.root / "backups").glob("library-*.json"))), 1)
        self.assertFalse(list(self.store.root.glob(".tmp-*")), "no temp files left behind")

    def test_bad_library_body(self):
        self.assertEqual(self.j("PUT", "/api/library", {"papers": []})[0], 400)
        self.assertEqual(self.j("PUT", "/api/library", {"baseRev": "0", "papers": "nope"})[0], 400)
        self.assertEqual(self.req("PUT", "/api/library", b"not json", {"Content-Type": "application/json"})[0], 400)

    def test_pdf_roundtrip(self):
        pdf = b"%PDF-1.4\n" + bytes(range(256)) * 4000 + b"\n%%EOF"
        self.assertEqual(self.req("PUT", "/api/pdf/abc_12-x", pdf, {"Content-Type": "application/pdf"})[0], 200)
        self.assertEqual((self.store.pdfs / "abc_12-x.pdf").read_bytes(), pdf)
        self.assertEqual(self.req("GET", "/api/pdf/abc_12-x"), (200, pdf))
        self.assertEqual(self.req("DELETE", "/api/pdf/abc_12-x")[0], 200)
        self.assertEqual(self.req("GET", "/api/pdf/abc_12-x")[0], 404)

    def test_ids_cannot_escape_the_folder(self):
        for bad in ("..%2F..%2Fsecret", "..%5C..%5Csecret", "a.b", "a%20b", "x" * 65):
            self.assertIn(self.req("GET", f"/api/pdf/{bad}")[0], (400, 404), bad)
            self.assertIn(self.req("PUT", f"/api/pdf/{bad}", b"x")[0], (400, 404), bad)
        outside = [p for p in Path(self.tmp.name).rglob("*") if p.is_file() and self.store.root not in p.parents]
        self.assertEqual(outside, [], "nothing was written outside the library folder")
        self.assertEqual(list(self.store.pdfs.iterdir()), [])

    def test_other_sites_are_refused(self):
        self.assertEqual(self.req("GET", "/api/library", host="evil.example:80")[0], 403)    # DNS rebinding
        self.assertEqual(self.req("GET", "/", host="evil.example")[0], 403)
        self.assertEqual(self.req("PUT", "/api/library", {"baseRev": "0", "papers": []}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.req("OPTIONS", "/api/library", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "PUT"})[0], 403)
        # the app's own address, under either name, is fine
        self.assertEqual(self.req("GET", "/api/info", headers={"Origin": f"http://127.0.0.1:{self.port}"}, host=f"127.0.0.1:{self.port}")[0], 200)

    def test_open_folder(self):
        import studydesk.cli as cli
        opened = []
        real, cli.open_folder = cli.open_folder, opened.append
        try:
            me = {"Origin": f"http://localhost:{self.port}", "Content-Type": "application/json"}
            self.assertEqual(self.req("POST", "/api/open-folder", b"{}", me)[0], 200)
            self.assertEqual(opened, [self.store.root])
            # anything that doesn't prove it's the app itself is refused, and nothing is opened
            self.assertEqual(self.req("POST", "/api/open-folder", b"{}", {"Content-Type": "application/json"})[0], 403)
            self.assertEqual(self.req("POST", "/api/open-folder", b"{}", {"Origin": me["Origin"], "Content-Type": "text/plain"})[0], 403)
            self.assertEqual(self.req("POST", "/api/open-folder", b"{}", {**me, "Origin": "https://evil.example"})[0], 403)
            self.assertEqual(self.req("POST", "/api/open-folder", b"{}", me, host="evil.example")[0], 403)
            self.assertEqual(len(opened), 1)
        finally:
            cli.open_folder = real

    def test_static_app_still_served(self):
        st, body = self.req("GET", "/")
        self.assertEqual(st, 200)
        self.assertIn(b"StudyDesk", body)

    def test_tracker_save_and_conflict(self):
        self.assertEqual(self.j("GET", "/api/tracker"), (200, {"rev": "0", "tracker": None}))
        self.assertEqual(self.j("GET", "/api/info")[1]["trackerRev"], "0")
        tr = {"lists": [{"id": "l1", "section": "submissions", "name": "Q1 journals", "order": ["s1"]}],
              "submissions": [{"id": "s1", "list": "l1", "title": "Journal of Things", "details": "héllo"}],
              "projects": [], "myPapers": []}
        st, r = self.j("PUT", "/api/tracker", {"baseRev": "0", "tracker": tr})
        self.assertEqual(st, 200)
        rev1 = r["rev"]
        self.assertEqual(self.j("GET", "/api/tracker")[1], {"rev": rev1, "tracker": tr})
        self.assertEqual(self.j("GET", "/api/info")[1]["trackerRev"], rev1)
        doc = json.loads((self.store.root / "tracker.json").read_text(encoding="utf-8"))
        self.assertEqual((doc["format"], doc["formatVersion"], doc["submissions"]), ("studydesk-tracker", 1, tr["submissions"]))
        # the tracker has its own rev: saving it doesn't touch library.json, and the library's rev doesn't block it
        self.assertFalse((self.store.root / "library.json").exists())
        self.assertEqual(self.j("PUT", "/api/library", {"baseRev": "0", "papers": []})[0], 200)
        st, r = self.j("PUT", "/api/tracker", {"baseRev": "0", "tracker": {}})
        self.assertEqual((st, r), (409, {"rev": rev1, "tracker": tr}))
        # missing collections are saved as empty lists
        st, r = self.j("PUT", "/api/tracker", {"baseRev": rev1, "tracker": {"projects": [{"id": "p1"}]}})
        self.assertEqual(st, 200)
        self.assertEqual(self.j("GET", "/api/tracker")[1]["tracker"], {"lists": [], "submissions": [], "projects": [{"id": "p1"}], "myPapers": []})
        self.assertEqual(len(list((self.store.root / "backups").glob("tracker-*.json"))), 1)
        self.assertFalse(list(self.store.root.glob(".tmp-*")), "no temp files left behind")

    def test_bad_tracker_body(self):
        self.assertEqual(self.j("PUT", "/api/tracker", {"tracker": {}})[0], 400)
        self.assertEqual(self.j("PUT", "/api/tracker", {"baseRev": "0", "tracker": []})[0], 400)
        self.assertEqual(self.j("PUT", "/api/tracker", {"baseRev": "0", "tracker": {"projects": "nope"}})[0], 400)
        self.assertEqual(self.req("PUT", "/api/tracker", {"baseRev": "0", "tracker": {}}, {"Origin": "https://evil.example"})[0], 403)
        self.assertFalse((self.store.root / "tracker.json").exists())

    def test_image_roundtrip(self):
        png = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 10
        jpg = b"\xff\xd8\xff\xe0" + b"x" * 500
        self.assertEqual(self.req("PUT", "/api/image/img01", png, {"Content-Type": "image/png"})[0], 200)
        self.assertEqual((self.store.root / "images" / "img01.png").read_bytes(), png)
        self.assertEqual(self.req("GET", "/api/image/img01"), (200, png))
        # replacing it with another type leaves one file
        self.assertEqual(self.req("PUT", "/api/image/img01", jpg, {"Content-Type": "image/jpeg"})[0], 200)
        self.assertEqual(sorted(p.name for p in (self.store.root / "images").iterdir()), ["img01.jpg"])
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request("GET", "/api/image/img01", headers={"Host": f"localhost:{self.port}"})
        r = c.getresponse()
        r.read()
        c.close()
        self.assertEqual((r.getheader("Content-Type"), r.getheader("X-Content-Type-Options")), ("image/jpeg", "nosniff"))
        self.assertEqual(self.req("DELETE", "/api/image/img01")[0], 200)
        self.assertEqual(self.req("GET", "/api/image/img01")[0], 404)

    def test_only_real_images(self):
        html = b"<html><script>alert(1)</script></html>"
        self.assertEqual(self.req("PUT", "/api/image/x1", html, {"Content-Type": "image/png"})[0], 415)        # says PNG, isn't
        self.assertEqual(self.req("PUT", "/api/image/x1", html, {"Content-Type": "text/html"})[0], 415)
        self.assertEqual(self.req("PUT", "/api/image/x1", b"<svg/>", {"Content-Type": "image/svg+xml"})[0], 415)  # SVG can carry script
        self.assertIn(self.req("PUT", "/api/image/..%2Fx", b"\x89PNG\r\n\x1a\n", {"Content-Type": "image/png"})[0], (400, 404))
        # an upload declared bigger than 10 MB is refused before it's read
        self.assertEqual(self.req("PUT", "/api/image/x1", b"\x89PNG\r\n\x1a\n", {"Content-Type": "image/png", "Content-Length": str((10 << 20) + 1)})[0], 413)
        self.assertEqual(self.req("PUT", "/api/image/x1", b"\x89PNG\r\n\x1a\n", {"Content-Type": "image/png", "Origin": "https://evil.example"})[0], 403)
        imgs = self.store.root / "images"
        self.assertFalse(imgs.exists() and any(imgs.iterdir()), "nothing was stored")

    def test_two_processes_share_a_folder(self):
        # a second Store on the same folder (another studydesk on another port) sees the first one's writes
        other = Store(self.store.root)
        rev = other.write("0", [{"id": "z9", "title": "From port B"}])
        self.assertEqual(self.j("GET", "/api/library")[1], {"rev": rev, "papers": [{"id": "z9", "title": "From port B"}]})
        self.assertEqual(self.j("PUT", "/api/library", {"baseRev": "0", "papers": []})[0], 409)


if __name__ == "__main__":
    unittest.main()
