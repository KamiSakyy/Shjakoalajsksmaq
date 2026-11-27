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

# Emit separate, short Actions annotations for the DB/API implementation and frontend callers.
all_sources = []
for current, dirs, files in os.walk(project_root):
    dirs[:] = [name for name in dirs if name not in {"node_modules", ".git", ".next", "dist", "build", "out"}]
    for filename in files:
        path = pathlib.Path(current) / filename
        rel = path.relative_to(project_root).as_posix()
        if rel.startswith(("src/app/api/", "src/db/", "src/lib/", "src/app/", "src/components/")):
            all_sources.append((rel, path))
lib_files = sorted(path.relative_to(project_root).as_posix() for path in (project_root / "src/lib").glob("*") if path.is_file())
app_files = sorted(path.relative_to(project_root).as_posix() for path in (project_root / "src/app").rglob("*") if path.is_file() and ".next" not in path.parts)[:100]
component_files = sorted(path.relative_to(project_root).as_posix() for path in (project_root / "src/components").rglob("*") if path.is_file())[:120]
print("::notice title=Application source layout::" + urllib.parse.quote(", ".join(lib_files + app_files + component_files), safe=""), flush=True)
print("::notice title=API and database files::" + urllib.parse.quote(", ".join(rel for rel, _ in all_sources), safe=""), flush=True)
priority_files = ["src/components/library.tsx", "src/components/editor.tsx", "src/app/project/[id]/page.tsx", "src/components/book-panels.tsx", "src/lib/client.ts", "src/lib/books.ts"]
ordered_sources = sorted(all_sources, key=lambda item: (priority_files.index(item[0]) if item[0] in priority_files else len(priority_files), item[0]))
for rel, path in ordered_sources[:6]:
    if path.suffix in {".ts", ".tsx", ".js", ".json", ".sql"}:
        content = path.read_text(encoding="utf-8", errors="replace")[:5000 if rel in priority_files else 1200]
        print(f"::notice title=Source {urllib.parse.quote(rel, safe='')}::{urllib.parse.quote(content, safe='')}", flush=True)
excerpts = []
for base in (project_root / "src/app", project_root / "src/components"):
    if not base.is_dir():
        continue
    for current, dirs, files in os.walk(base):
        dirs[:] = [name for name in dirs if name not in {"node_modules", ".next"}]
        for filename in files:
            path = pathlib.Path(current) / filename
            if path.suffix not in {".ts", ".tsx", ".js", ".jsx"} or path.stat().st_size > 30000:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for line in text.splitlines():
                if any(token in line for token in ("api<", "router.push", "href=", "/project/")):
                    excerpts.append(f"{path.relative_to(project_root).as_posix()}: {line.strip()}")
if excerpts:
    print("::notice title=Frontend data and navigation calls::" + urllib.parse.quote("\n".join(excerpts[:40]), safe=""), flush=True)

if selected and selected[3]:
    print(f"Frontend project: {project_root}", flush=True)
    is_next_app = (project_root / "src/app/layout.tsx").is_file() and (project_root / "next.config.ts").exists()
    if is_next_app:
        prepare = ["python3", str(ROOT / "android/prepare-offline-app.py"), str(project_root)]
        result = subprocess.run(prepare, cwd=project_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        print(result.stdout, flush=True)
        if result.returncode:
            raise SystemExit(f"Offline app preparation failed ({result.returncode}):\n{result.stdout[-4000:]}")
    if (project_root / "package-lock.json").exists():
        install = ["npm", "ci"]
    elif (project_root / "pnpm-lock.yaml").exists():
        install = ["corepack", "pnpm", "install", "--frozen-lockfile"]
    elif (project_root / "yarn.lock").exists():
        install = ["corepack", "yarn", "install", "--frozen-lockfile"]
    else:
        install = ["npm", "install"]
    commands = [install]
    if is_next_app:
        commands.append(["npm", "install", "--no-save", "--package-lock=false", "jszip"])
    commands.append(["npm", "run", "build"])
    for command in commands:
        result = subprocess.run(command, cwd=project_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        print(result.stdout, flush=True)
        if result.returncode:
            tail = "\n".join(result.stdout.splitlines()[-16:])
            raise SystemExit(f"Command failed ({result.returncode}): {' '.join(command)}\n{tail}")
        if is_next_app and "jszip" in command:
            shutil.copy2(project_root / "node_modules/jszip/dist/jszip.min.js", project_root / "public/jszip.min.js")

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
