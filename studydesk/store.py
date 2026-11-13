"""The library folder: library.json, tracker.json, pdfs/<id>.pdf and daily backups. Standard library only.

Spec: docs/disk-storage.md. Writes are atomic (temp file + os.replace), and the revision token is the
file's mtime and size, so several studydesk processes on different ports can share one folder.
tracker.json (submissions, projects, my papers: docs/trackers.md) is a separate file with its own rev, so
studydesk 1.2.0, which rewrites library.json with papers only, can't drop it.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import BinaryIO

FORMAT = "pdfdesk-library"
FORMAT_VERSION = 1
TRACKER_FORMAT = "studydesk-tracker"
TRACKER_FORMAT_VERSION = 1
TRACKER_KEYS = ("lists", "submissions", "projects", "myPapers")
# Images on tracker entries: only these types, and the file must start the way its type says.
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
MAX_IMAGE = 10 << 20


def image_type_ok(ctype: str, head: bytes) -> bool:
    return {
        "image/png": head.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": head.startswith(b"\xff\xd8\xff"),
        "image/webp": head[:4] == b"RIFF" and head[8:12] == b"WEBP",
        "image/gif": head[:6] in (b"GIF87a", b"GIF89a"),
    }.get(ctype, False)
KEEP_BACKUPS = 14
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
CHUNK = 1 << 20


class Conflict(Exception):
    """The library changed since the client last read it."""

    def __init__(self, rev: str, papers: list | dict | None):
        super().__init__("library changed")
        self.rev = rev
        self.papers = papers  # the tracker dict for tracker.json


def default_dir() -> Path:
    """$STUDYDESK_DATA, else ~/StudyDesk. A PDFDesk library (~/PDFDesk or $PDFDESK_DATA) is used as it is
    while there is no ~/StudyDesk, so people coming from pdfdesk keep their library without moving it (D-013)."""
    env = os.environ.get("STUDYDESK_DATA") or os.environ.get("PDFDESK_DATA")
    if env:
        return Path(env)
    new, old = Path.home() / "StudyDesk", Path.home() / "PDFDesk"
    if not new.exists() and (old / "library.json").exists():
        return old
    return new


def _replace(tmp: str, target: Path) -> None:
    # On Windows the replace fails while another process has the target open; that is brief, so retry.
    for attempt in range(20):
        try:
            os.replace(tmp, target)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def _atomic_write(target: Path, chunks) -> None:
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".tmp-", suffix=target.suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            for chunk in chunks:
                f.write(chunk)
            f.flush()
            os.fsync(f.fileno())
        _replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class Store:
    def __init__(self, root: Path):
        self.root = Path(root).expanduser().resolve()
        self.lib = self.root / "library.json"
        self.tracker = self.root / "tracker.json"
        self.pdfs = self.root / "pdfs"
        self.backups = self.root / "backups"
        self.images = self.root / "images"
        self.lock = threading.Lock()
        self.pdfs.mkdir(parents=True, exist_ok=True)
        self.backups.mkdir(exist_ok=True)

    # ---------- library.json ----------
    def rev(self) -> str:
        return self._rev(self.lib)

    @staticmethod
    def _rev(path: Path) -> str:
        try:
            st = path.stat()
        except FileNotFoundError:
            return "0"
        return f"{st.st_mtime_ns}-{st.st_size}"

    def read(self) -> tuple[str, list | None]:
        with self.lock:
            return self._read()

    def _read(self) -> tuple[str, list | None]:
        try:
            with open(self.lib, "rb") as f:
                st = os.fstat(f.fileno())
                data = json.loads(f.read().decode("utf-8"))
        except FileNotFoundError:
            return "0", None
        papers = data.get("papers") if isinstance(data, dict) else None
        return f"{st.st_mtime_ns}-{st.st_size}", papers if isinstance(papers, list) else None

    def write(self, base_rev: str, papers: list) -> str:
        if not isinstance(papers, list):
            raise ValueError("papers must be a list")
        with self.lock:
            if base_rev != self.rev():
                rev, current = self._read()
                raise Conflict(rev, current)
            self._backup(self.lib, "library")
            doc = {
                "format": FORMAT,
                "formatVersion": FORMAT_VERSION,
                "savedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "papers": papers,
            }
            _atomic_write(self.lib, [json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")])
            return self.rev()

    def _backup(self, src: Path, prefix: str) -> None:
        if not src.exists():
            return
        today = self.backups / f"{prefix}-{datetime.date.today().isoformat()}.json"
        if not today.exists():
            shutil.copy2(src, today)
            old = sorted(self.backups.glob(f"{prefix}-*.json"))[:-KEEP_BACKUPS]
            for p in old:
                try:
                    p.unlink()
                except OSError:
                    pass

    # ---------- tracker.json ----------
    def tracker_rev(self) -> str:
        return self._rev(self.tracker)

    def read_tracker(self) -> tuple[str, dict | None]:
        with self.lock:
            return self._read_tracker()

    def _read_tracker(self) -> tuple[str, dict | None]:
        try:
            with open(self.tracker, "rb") as f:
                st = os.fstat(f.fileno())
                data = json.loads(f.read().decode("utf-8"))
        except FileNotFoundError:
            return "0", None
        if not isinstance(data, dict):
            return f"{st.st_mtime_ns}-{st.st_size}", None
        return f"{st.st_mtime_ns}-{st.st_size}", {k: data[k] if isinstance(data.get(k), list) else [] for k in TRACKER_KEYS}

    def write_tracker(self, base_rev: str, tracker: dict) -> str:
        if not isinstance(tracker, dict) or not all(isinstance(tracker.get(k, []), list) for k in TRACKER_KEYS):
            raise ValueError("tracker must be an object of lists")
        with self.lock:
            if base_rev != self.tracker_rev():
                rev, current = self._read_tracker()
                raise Conflict(rev, current)
            self._backup(self.tracker, "tracker")
            doc = {
                "format": TRACKER_FORMAT,
                "formatVersion": TRACKER_FORMAT_VERSION,
                "savedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                **{k: tracker.get(k, []) for k in TRACKER_KEYS},
            }
            _atomic_write(self.tracker, [json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")])
            return self.tracker_rev()

    # ---------- PDFs ----------
    def pdf_path(self, pid: str) -> Path:
        if not ID_RE.match(pid):
            raise KeyError(pid)
        return self.pdfs / f"{pid}.pdf"

    def read_pdf(self, pid: str) -> bytes | None:
        path = self.pdf_path(pid)
        with self.lock:
            try:
                return path.read_bytes()
            except FileNotFoundError:
                return None

    def write_pdf(self, pid: str, stream: BinaryIO, length: int) -> None:
        path = self.pdf_path(pid)

        def chunks():
            left = length
            while left > 0:
                block = stream.read(min(CHUNK, left))
                if not block:
                    raise ValueError("upload ended early")
                left -= len(block)
                yield block

        # Stream to a temp file first (outside the lock), then swap it in under the lock.
        fd, tmp = tempfile.mkstemp(dir=self.pdfs, prefix=".tmp-", suffix=".pdf")
        try:
            with os.fdopen(fd, "wb") as f:
                for block in chunks():
                    f.write(block)
                f.flush()
                os.fsync(f.fileno())
            with self.lock:
                _replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    # ---------- images (tracker entries) ----------
    def _image_files(self, iid: str) -> list[Path]:
        if not ID_RE.match(iid):
            raise KeyError(iid)
        return [self.images / f"{iid}{ext}" for ext in IMAGE_TYPES.values()]

    def read_image(self, iid: str) -> tuple[bytes, str] | None:
        files = self._image_files(iid)
        with self.lock:
            for path, ctype in zip(files, IMAGE_TYPES):
                try:
                    return path.read_bytes(), ctype
                except FileNotFoundError:
                    continue
        return None

    def write_image(self, iid: str, data: bytes, ctype: str) -> None:
        files = self._image_files(iid)
        if ctype not in IMAGE_TYPES or not image_type_ok(ctype, data[:16]):
            raise ValueError("not a PNG, JPEG, WebP or GIF image")
        if len(data) > MAX_IMAGE:
            raise ValueError("image too large")
        self.images.mkdir(exist_ok=True)
        target = self.images / f"{iid}{IMAGE_TYPES[ctype]}"
        with self.lock:
            _atomic_write(target, [data])
            for other in files:
                if other != target:
                    try:
                        other.unlink()
                    except FileNotFoundError:
                        pass

    def delete_image(self, iid: str) -> None:
        files = self._image_files(iid)
        with self.lock:
            for path in files:
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass

    def delete_pdf(self, pid: str) -> None:
        path = self.pdf_path(pid)
        with self.lock:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
