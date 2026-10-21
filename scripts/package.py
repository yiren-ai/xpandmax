"""按固定白名单生成可复现安装包，避免把开发机文件带入发布。"""
from pathlib import Path
import hashlib
import json
import zipfile
import argparse

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "extension/manifest.json", "extension/bridge.js", "extension/content.js",
    "extension/velocity.js", "extension/share.js", "extension/content.css", "extension/translation.js", "README.md", "LICENSE", "PRIVACY.md", "docs/preview.svg",
    "extension/translation-background.js", "extension/translation-options.html", "extension/translation-options.js", "extension/translation-options.css",
    "extension/settings.js", "extension/follow.js", "extension/popup.html", "extension/popup.js", "extension/popup.css",
    "extension/icons/icon16.png", "extension/icons/icon32.png",
    "extension/icons/icon48.png", "extension/icons/icon128.png",
]


def build(store=False):
    version = json.loads((ROOT / "extension/manifest.json").read_text())["version"]
    assert version == json.loads((ROOT / "package.json").read_text())["version"]
    suffix = "-chrome-web-store" if store else ""
    output = ROOT / "dist" / f"xpandmax-{version}{suffix}.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            if store and not name.startswith("extension/") and name not in ["LICENSE", "PRIVACY.md"]:
                continue
            source = ROOT / name
            if source.is_symlink() or not source.is_file():
                raise ValueError(f"发布文件缺失或为符号链接：{name}")
            archive_name = name.removeprefix("extension/") if store else name
            entry = zipfile.ZipInfo(archive_name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, source.read_bytes())
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    checksum_file = "STORE-SHA256SUMS.txt" if store else "SHA256SUMS.txt"
    (output.parent / checksum_file).write_text(f"{digest}  {output.name}\n")
    print(f"{output.name}: SHA-256 {digest}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", action="store_true", help="生成 manifest.json 位于根目录的商店包")
    build(store=parser.parse_args().store)
