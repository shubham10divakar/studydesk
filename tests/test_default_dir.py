"""Where the library folder is by default, including the move from PDFDesk (decisions.md D-013)."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from studydesk.store import default_dir


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

    def test_pdfdesk_library_is_used_as_it_is(self):
        old = self.pdfdesk_library()
        self.assertEqual(default_dir(), old)

    def test_empty_pdfdesk_folder_is_ignored(self):
        (self.home / "PDFDesk").mkdir()
        self.assertEqual(default_dir(), self.home / "StudyDesk")

    def test_studydesk_folder_wins_once_it_exists(self):
        self.pdfdesk_library()
        (self.home / "StudyDesk").mkdir()
        self.assertEqual(default_dir(), self.home / "StudyDesk")

    def test_environment_variables(self):
        os.environ["PDFDESK_DATA"] = str(self.home / "old-env")
        self.assertEqual(default_dir(), self.home / "old-env")
        os.environ["STUDYDESK_DATA"] = str(self.home / "new-env")
        self.assertEqual(default_dir(), self.home / "new-env")


if __name__ == "__main__":
    unittest.main()
