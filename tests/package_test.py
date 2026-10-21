"""检查发布包内容和重复构建，不依赖开发机身份或真实账号数据。"""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
import zipfile
import struct

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("package_script", ROOT / "scripts/package.py")
packaging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packaging)


class PackageTests(unittest.TestCase):
    def test_exact_files_and_source_match(self):
        output = packaging.build()
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(set(archive.namelist()), {
                "extension/manifest.json", "extension/bridge.js", "extension/content.js",
                "extension/velocity.js", "extension/share.js", "extension/content.css", "extension/translation.js", "README.md", "LICENSE", "PRIVACY.md", "docs/preview.svg",
                "extension/translation-background.js", "extension/translation-options.html", "extension/translation-options.js", "extension/translation-options.css",
                "extension/settings.js", "extension/follow.js", "extension/popup.html", "extension/popup.js", "extension/popup.css",
                "extension/icons/icon16.png", "extension/icons/icon32.png",
                "extension/icons/icon48.png", "extension/icons/icon128.png",
            })
            for name in archive.namelist():
                self.assertEqual(archive.read(name), (ROOT / name).read_bytes())
            manifest = json.loads(archive.read("extension/manifest.json"))
            self.assertEqual(manifest["version"], json.loads((ROOT / "package.json").read_text())["version"])

    def test_reproducible_and_checksum(self):
        output = packaging.build()
        first = output.read_bytes()
        packaging.build()
        self.assertEqual(first, output.read_bytes())
        expected = hashlib.sha256(first).hexdigest()
        self.assertEqual((output.parent / "SHA256SUMS.txt").read_text(), f"{expected}  {output.name}\n")

    def test_store_root_manifest_and_all_references(self):
        output = packaging.build(store=True)
        with zipfile.ZipFile(output) as archive:
            names = set(archive.namelist())
            self.assertEqual(names, {"manifest.json", "bridge.js", "content.js", "velocity.js", "share.js", "content.css", "translation.js", "translation-background.js", "translation-options.html", "translation-options.js", "translation-options.css", "settings.js", "follow.js", "popup.html", "popup.js", "popup.css",
                                    "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png",
                                    "LICENSE", "PRIVACY.md"})
            manifest = json.loads(archive.read("manifest.json"))
            self.assertIn(manifest['action']['default_popup'], names)
            self.assertIn(manifest['background']['service_worker'], names)
            self.assertIn(manifest['options_page'], names)
            for script in manifest["content_scripts"]:
                for name in script["js"] + script.get("css", []):
                    self.assertIn(name, names)
            for size, name in manifest["icons"].items():
                data = archive.read(name)
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(struct.unpack(">II", data[16:24]), (int(size), int(size)))
            for name in names:
                source = ROOT / name if name in ["LICENSE", "PRIVACY.md"] else ROOT / "extension" / name
                self.assertEqual(archive.read(name), source.read_bytes())

    def test_store_checksum_and_reproducibility(self):
        output = packaging.build(store=True)
        first = output.read_bytes()
        packaging.build(store=True)
        self.assertEqual(first, output.read_bytes())
        self.assertEqual((output.parent / "STORE-SHA256SUMS.txt").read_text(),
                         f"{hashlib.sha256(first).hexdigest()}  {output.name}\n")


if __name__ == "__main__":
    unittest.main()
