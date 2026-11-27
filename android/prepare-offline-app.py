#!/usr/bin/env python3
"""Convert the downloaded Next.js application to a static, IndexedDB-backed offline app."""
from __future__ import annotations
import re
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
if not (root / "package.json").is_file():
    raise SystemExit(f"Not a website project: {root}")
app = root / "src/app"
layout = app / "layout.tsx"
if not layout.is_file():
    raise SystemExit("Downloaded website does not contain src/app/layout.tsx")

prefs = '{ author: "", language: "ru", autosave: true, fontSize: 18, compact: false, typographer: true, dailyGoal: 1000 }'
# Static client entrypoint; all data loads from local IndexedDB after hydration.
home = app / "page.tsx"
if home.exists():
    home.write_text("\"use client\";\nimport { Suspense } from \"react\";\nimport { useSearchParams } from \"next/navigation\";\nimport { Library } from \"@/components/library\";\nimport type { Preferences } from \"@/lib/types\";\nconst preferences = { author: \"\", language: \"ru\", autosave: true, fontSize: 18, compact: false, typographer: true, dailyGoal: 1000 } as Preferences;\nfunction LocalLibrary() { const params = useSearchParams(); return <Library initialBooks={[]} initialPreferences={preferences} initialView={params.get(\"view\") || \"library\"} />; }\nexport default function HomePage() { return <Suspense fallback={null}><LocalLibrary /></Suspense>; }\n")

layout_text = layout.read_text()
layout_text = re.sub(r'import\s+\{\s*headers\s*\}\s+from\s+["\']next/headers["\'];?\s*', "", layout_text)
layout_text = re.sub(r'export\s+const\s+dynamic\s*=\s*["\']force-dynamic["\'];?\s*', "", layout_text)
layout_text = re.sub(r'await\s+headers\(\);\s*', "", layout_text)
layout_text = re.sub(r'import\s*\{[^}]*\}\s*from\s*["\']@/lib/books["\'];?\s*', "", layout_text)
layout_text = re.sub(r'import\s*\{[^}]*\}\s*from\s*["\']@/db["\'];?\s*', "", layout_text)
if "offline-api.js" not in layout_text:
    scripts = '\n        <script src="/jszip.min.js"></script>\n        <script src="/offline-boot.js"></script>\n        <script src="/offline-api.js"></script>'
    if re.search(r'<head(?:\s[^>]*)?>', layout_text, re.I):
        layout_text = re.sub(r'(<head(?:\s[^>]*)?>)', lambda match: match.group(1) + scripts, layout_text, count=1, flags=re.I)
    else:
        layout_text = re.sub(r'(<body(?:\s[^>]*)?>)', lambda match: match.group(1) + scripts, layout_text, count=1, flags=re.I)
    if "offline-api.js" not in layout_text:
        raise SystemExit("Could not insert offline scripts into the downloaded app layout")
layout.write_text(layout_text)

# Remove server API routes: their modules initialize PostgreSQL and are not used in the APK.
api_dir = app / "api"
if api_dir.exists():
    for route in list(api_dir.rglob("route.ts")) + list(api_dir.rglob("route.tsx")):
        route.unlink()

# Replace the database-rendered editor page with a statically renderable shell.
editor = app / "project/[id]/page.tsx"
if editor.exists():
    editor.write_text('''import { Editor } from "@/components/editor";
import type { Book, Preferences } from "@/lib/types";
export function generateStaticParams() { return [{ id: "local" }]; }
const preferences = { author: "", language: "ru", autosave: true, fontSize: 18, compact: false, typographer: true, dailyGoal: 1000 } as Preferences;
const emptyBook = { id: "local", title: "Новая история", author: "", cover: "", status: "draft", metadata: { subtitle: "", japaneseTitle: "", description: "", language: "ru", originalLanguage: "ja", illustrator: "", translator: "", editor: "", publisher: "", publishedAt: "", identifier: "", rights: "", subjects: "", series: "", volume: "1", writingMode: "horizontal-tb", pageDirection: "ltr" }, chapters: [], lore: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() } as Book;
export default function ProjectPage() { return <Editor initialBook={emptyBook} preferences={preferences} initialTab="text" />; }
''')

# Static export needs a concrete output and no server actions.
config = next((root / name for name in ("next.config.ts", "next.config.mjs", "next.config.js") if (root / name).exists()), root / "next.config.mjs")
if config.exists():
    text = config.read_text()
    if re.search(r'^\s*output\s*:', text, re.M):
        text = re.sub(r'^(\s*output\s*:\s*)[^,\n]+', r'\1"export"', text, count=1, flags=re.M)
    else:
        match = re.search(r'const\s+nextConfig(?:\s*:\s*[^=]+)?\s*=\s*\{', text)
        if match:
            text = text[:match.end()] + '\n  output: "export",' + text[match.end():]
        elif re.search(r'export\s+default\s*\{', text):
            text = re.sub(r'(export\s+default\s*\{)', r'\1\n  output: "export",', text, count=1)
        else:
            raise SystemExit("Could not force static output in Next.js config")
    config.write_text(text)
else:
    config.write_text('const nextConfig = { output: "export", trailingSlash: false };\nexport default nextConfig;\n')

# Load persisted data after hydration. Keep the original rich interface and behavior intact.
for rel, needle, addition in [
    ("src/components/library.tsx", 'const [books, setBooks] = useState(initialBooks);', 'const [books, setBooks] = useState(initialBooks);\n  useEffect(() => { let active = true; Promise.all([api<Book[]>("/api/books"), api<Preferences>("/api/settings")]).then(([localBooks, localPrefs]) => { if (active) { setBooks(localBooks); setPreferences(localPrefs); } }).catch(() => {}); return () => { active = false; }; }, []);'),
    ("src/components/editor.tsx", 'const [book, setBook] = useState<Book>(() => normalizeBookShape(initialBook));', 'const [book, setBook] = useState<Book>(() => normalizeBookShape(initialBook));\n  useEffect(() => { const id = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || ""); if (id && id !== "local") api<Book>(`/api/books/${encodeURIComponent(id)}`).then(value => setBook(normalizeBookShape(value))).catch(() => {}); }, []);')]:
    path = root / rel
    if not path.exists():
        continue
    text = path.read_text()
    if needle not in text:
        raise SystemExit(f"Could not patch client data hydration in {rel}")
    if "localBooks" not in text and "normalizeBookShape(value)" not in text:
        text = text.replace(needle, addition)
        path.write_text(text)

# Place the local API bridge and JSZip UMD build into the downloaded site's public assets.
public = root / "public"
public.mkdir(exist_ok=True)
shutil.copy2(Path(__file__).with_name("offline-api.js"), public / "offline-api.js")
(public / "offline-boot.js").write_text('window.__OfflineJSZip = window.JSZip;')
