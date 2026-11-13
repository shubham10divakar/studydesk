"""Where the library folder is by default (decisions.md D-015): always StudyDesk, never a PDFDesk folder."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from studydesk.store import default_dir, old_library


class DefaultDirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        env = {k: v for k, v in os.environ.items() if k not in ("STUDYDESK_DATA", "PDFDESK_DATA")}
        self.patches = [mock.patch.dict(os.environ, env, clear=True),
                        mock.patch.object(Path, "home", return_value=self.home)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def pdfdesk_library(self):
        old = self.home / "PDFDesk"
        old.mkdir()
        (old / "library.json").write_text("{}", encoding="utf-8")
        return old

    def test_new_install_uses_studydesk(self):
        self.assertEqual(default_dir(), self.home / "StudyDesk")
        self.assertIsNone(old_library(default_dir()))

    def test_pdfdesk_library_is_never_used(self):
        old = self.pdfdesk_library()
        self.assertEqual(default_dir(), self.home / "StudyDesk")
        self.assertEqual(old_library(default_dir()), old, "but it is found, so the command can say how to bring it over")

    def library(self, papers):
        new = self.home / "StudyDesk"
        new.mkdir(exist_ok=True)
        (new / "library.json").write_text(json.dumps({"papers": papers}), encoding="utf-8")
        return new

    def test_hint_stays_while_only_examples(self):
        old = self.pdfdesk_library()
        new = self.library([{"id": "a", "sample": True}])
        self.assertEqual(old_library(new), old)

    def test_no_hint_once_studydesk_has_your_papers(self):
        self.pdfdesk_library()
        new = self.library([{"id": "a", "sample": True}, {"id": "b", "title": "Mine"}])
        self.assertIsNone(old_library(new))

    def test_no_hint_when_using_pdfdesk_on_purpose(self):
        old = self.pdfdesk_library()
        self.assertIsNone(old_library(old))

    def test_environment_variables(self):
        os.environ["PDFDESK_DATA"] = str(self.home / "old-env")
        self.assertEqual(default_dir(), self.home / "StudyDesk", "PDFDESK_DATA is ignored")
        os.environ["STUDYDESK_DATA"] = str(self.home / "new-env")
        self.assertEqual(default_dir(), self.home / "new-env")


if __name__ == "__main__":
    unittest.main()
