#!/usr/bin/env python3
"""Fetch the supplied website archive, build it if needed, and stage its static files."""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import urllib.parse
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_URL = os.environ.get("SOURCE_URL")
RUNNER_TEMP = pathlib.Path(os.environ.get("RUNNER_TEMP", "/tmp"))
SOURCE_ROOT = RUNNER_TEMP / "downloaded-site"
DOWNLOAD = RUNNER_TEMP / "website-source-download"
WEB_ASSETS = ROOT / "android/app/src/main/assets/www"

if not SOURCE_URL:
    raise SystemExit("SOURCE_URL is required")

for path in (SOURCE_ROOT, WEB_ASSETS):
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)

subprocess.run(
    ["curl", "--fail", "--location", "--retry", "3", "--retry-delay", "2", "--show-error", SOURCE_URL, "--output", str(DOWNLOAD)],
    check=True,
)


def safe_target(root: pathlib.Path, member: str) -> pathlib.Path:
    resolved_root = root.resolve()
    target = (root / member).resolve()
    if target != resolved_root and resolved_root not in target.parents:
        raise SystemExit(f"Unsafe archive path rejected: {member}")
    return target


if zipfile.is_zipfile(DOWNLOAD):
    with zipfile.ZipFile(DOWNLOAD) as archive:
        for info in archive.infolist():
            safe_target(SOURCE_ROOT, info.filename)
        archive.extractall(SOURCE_ROOT)
elif tarfile.is_tarfile(DOWNLOAD):
    with tarfile.open(DOWNLOAD) as archive:
        members = archive.getmembers()
        for item in members:
            safe_target(SOURCE_ROOT, item.name)
            if item.issym() or item.islnk():
                raise SystemExit(f"Archive link rejected: {item.name}")
        archive.extractall(SOURCE_ROOT, members=members)
else:
    data = DOWNLOAD.read_bytes()
    head = data[:65536].lower()
    if b"<html" not in head and b"<!doctype html" not in head:
        raise SystemExit("Download is not a ZIP/TAR archive or a single HTML file")
    (SOURCE_ROOT / "index.html").write_bytes(data)

excluded_dirs = {"node_modules", ".git", ".next", ".gradle", "dist", "build", "out"}
packages = []
for current, dirs, files in os.walk(SOURCE_ROOT):
    dirs[:] = [name for name in dirs if name not in excluded_dirs]
    if "package.json" not in files:
        continue
    package_root = pathlib.Path(current)
    try:
        package = json.loads((package_root / "package.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        continue
    build_script = package.get("scripts", {}).get("build")
    depth = len(package_root.relative_to(SOURCE_ROOT).parts)
    packages.append((0 if build_script else 1, depth, package_root, bool(build_script)))

project_root = sorted(packages, key=lambda row: (row[0], row[1], str(row[2])))[0][2] if packages else SOURCE_ROOT
selected = next((row for row in packages if row[2] == project_root), None)

# Emit a minimal site inventory and the data/API code to Actions annotations for offline-port planning.
details = [f"Project root: {project_root}"]
if (project_root / "package.json").is_file():
    package = json.loads((project_root / "package.json").read_text(encoding="utf-8"))
    details.append("package.json: " + json.dumps({key: package.get(key) for key in ("name", "scripts", "dependencies", "devDependencies") if key in package}, ensure_ascii=False))
all_sources = []
for current, dirs, files in os.walk(project_root):
    dirs[:] = [name for name in dirs if name not in {"node_modules", ".git", ".next", "dist", "build", "out"}]
    for filename in files:
        path = pathlib.Path(current) / filename
        rel = path.relative_to(project_root).as_posix()
        if rel.startswith(("src/app/api/", "src/db/")) or rel in {"src/lib/books.ts", "src/lib/settings.ts", "src/lib/book-input.ts"}:
            all_sources.append((rel, path))
details.append("API/data file list: " + ", ".join(rel for rel, _ in all_sources))
for rel, path in sorted(all_sources):
    if path.suffix in {".ts", ".tsx", ".js", ".json", ".sql"} and path.stat().st_size < 15000:
        details.append(f"--- {rel} ---\n" + path.read_text(encoding="utf-8", errors="replace")[:1800])
encoded_details = urllib.parse.quote("\n".join(details)[:10000], safe="")
print(f"::notice title=Downloaded site API and database summary::{encoded_details}", flush=True)

if selected and selected[3]:
    print(f"Frontend project: {project_root}", flush=True)
    if (project_root / "package-lock.json").exists():
        install = ["npm", "ci"]
    elif (project_root / "pnpm-lock.yaml").exists():
        install = ["corepack", "pnpm", "install", "--frozen-lockfile"]
    elif (project_root / "yarn.lock").exists():
        install = ["corepack", "yarn", "install", "--frozen-lockfile"]
    else:
        install = ["npm", "install"]
    for command in (install, ["npm", "run", "build"]):
        result = subprocess.run(command, cwd=project_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        print(result.stdout, flush=True)
        if result.returncode:
            tail = "\n".join(result.stdout.splitlines()[-16:])
            raise SystemExit(f"Command failed ({result.returncode}): {' '.join(command)}\n{tail}")

web_root = None
for dirname in ("dist", "build", "out", "www", "public"):
    candidate = project_root / dirname
    if (candidate / "index.html").is_file():
        web_root = candidate
        break
if web_root is None and (project_root / "index.html").is_file():
    web_root = project_root
if web_root is None:
    indexes = []
    for current, dirs, files in os.walk(SOURCE_ROOT):
        dirs[:] = [name for name in dirs if name not in {"node_modules", ".git", ".next"}]
        if "index.html" in files:
            candidate = pathlib.Path(current)
            indexes.append((len(candidate.relative_to(SOURCE_ROOT).parts), str(candidate), candidate))
    if indexes:
        web_root = sorted(indexes)[0][2]
if web_root is None:
    raise SystemExit("No index.html was found in the downloaded site or its build output")

ignored_dirs = {"node_modules", ".git", ".next", ".env", ".env.local", ".env.production"}
for current, dirs, files in os.walk(web_root):
    dirs[:] = [name for name in dirs if name not in ignored_dirs and not name.startswith(".env")]
    relative = pathlib.Path(current).relative_to(web_root)
    destination = WEB_ASSETS / relative
    destination.mkdir(parents=True, exist_ok=True)
    for filename in files:
        if filename.startswith(".env") or filename == "package.json" or filename.endswith(".map"):
            continue
        shutil.copy2(pathlib.Path(current) / filename, destination / filename)

if not (WEB_ASSETS / "index.html").is_file():
    raise SystemExit("Selected website output did not contain index.html")
count = sum(len(files) for _, _, files in os.walk(WEB_ASSETS))
print(f"Packaged site output: {web_root}")
print(f"Files copied into Android assets: {count}")
