/* Local IndexedDB replacement for the downloaded app's PostgreSQL /api endpoints. */
(() => {
  const nativeFetch = window.fetch.bind(window);
  const DB_NAME = "yomi-studio-local-v1";
  const DB_VERSION = 1;
  const DEFAULT_PREFS = { author: "Акира Мори", language: "ru", autosave: true, fontSize: 18, compact: false, typographer: true, dailyGoal: 1000 };
  const DEFAULT_METADATA = {
    subtitle: "", japaneseTitle: "", description: "", language: "ru", originalLanguage: "ja",
    illustrator: "", translator: "", editor: "", publisher: "", publishedAt: "", identifier: "",
    rights: "Все права защищены", subjects: "Ранобэ", series: "", volume: "1",
    writingMode: "horizontal-tb", pageDirection: "ltr",
  };
  let opening;

  function openDb() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Не удалось открыть локальную базу данных"));
    });
    return opening;
  }
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Ошибка локальной базы данных"));
    });
  }
  async function read(store, key) {
    const db = await openDb();
    return requestResult(db.transaction(store, "readonly").objectStore(store).get(key));
  }
  async function readAll(store) {
    const db = await openDb();
    return requestResult(db.transaction(store, "readonly").objectStore(store).getAll());
  }
  async function write(store, value) {
    const db = await openDb();
    await requestResult(db.transaction(store, "readwrite").objectStore(store).put(value));
    return value;
  }
  async function remove(store, key) {
    const db = await openDb();
    await requestResult(db.transaction(store, "readwrite").objectStore(store).delete(key));
  }
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  function textResponse(data, mime, filename) {
    return new Response(data, { headers: { "Content-Type": mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "no-store" } });
  }
  function cleanText(html) {
    return String(html || "").replace(/<\/(p|h[1-6]|li|blockquote|div|section)>/gi, "\n").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
  }
  function escapeHtml(text) {
    return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function normalizeBook(input, existing) {
    const now = new Date().toISOString();
    return {
      id: existing?.id || input.id || crypto.randomUUID(),
      title: String(input.title ?? existing?.title ?? "Новая история").slice(0, 250),
      author: String(input.author ?? existing?.author ?? "").slice(0, 250),
      cover: String(input.cover ?? existing?.cover ?? "").slice(0, 11000000),
      status: input.status ?? existing?.status ?? "draft",
      metadata: { ...DEFAULT_METADATA, ...(existing?.metadata || {}), ...(input.metadata || {}) },
      chapters: Array.isArray(input.chapters) ? input.chapters : (existing?.chapters || []),
      lore: Array.isArray(input.lore) ? input.lore : (existing?.lore || []),
      createdAt: existing?.createdAt || input.createdAt || now,
      updatedAt: now,
    };
  }
  async function getBook(id) { return (await read("books", id)) || null; }
  async function getSettings() { return (await read("settings", "main"))?.value || { ...DEFAULT_PREFS }; }
  async function exportEpub(book) {
    const JSZip = window.__OfflineJSZip;
    if (!JSZip) throw new Error("Экспорт EPUB ещё загружается. Попробуйте ещё раз.");
    const zip = new JSZip();
    const title = escapeHtml(book.title);
    const author = escapeHtml(book.author || "");
    const chapters = Array.isArray(book.chapters) ? book.chapters : [];
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    const manifest = chapters.map((_, i) => `<item id="c${i}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("");
    const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("");
    zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${escapeHtml(book.id)}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>${escapeHtml(book.metadata?.language || "ru")}</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>${manifest}</manifest><spine>${spine}</spine></package>`);
    zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Содержание</title></head><body><nav epub:type="toc"><h1>${title}</h1><ol>${chapters.map((ch, i) => `<li><a href="chapter-${i + 1}.xhtml">${escapeHtml(ch.title || `Глава ${i + 1}`)}</a></li>`).join("")}</ol></nav></body></html>`);
    chapters.forEach((chapter, i) => zip.file(`OEBPS/chapter-${i + 1}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeHtml(chapter.title || `Глава ${i + 1}`)}</title></head><body><h1>${escapeHtml(chapter.title || `Глава ${i + 1}`)}</h1>${chapter.content || ""}</body></html>`));
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
  async function offlineApi(request, url) {
    const method = request.method.toUpperCase();
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (url.pathname === "/api/health") return json({ ok: true, offline: true });
    if (url.pathname === "/api/settings") {
      if (method === "GET") return json(await getSettings());
      if (method === "PATCH") {
        const current = await getSettings();
        const input = await request.json();
        const next = { ...current, ...input, id: "main" };
        await write("settings", { id: "main", value: next });
        return json(next);
      }
    }
    if (url.pathname === "/api/books") {
      if (method === "GET") {
        const books = await readAll("books");
        books.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        return json(books);
      }
      if (method === "POST") {
        const book = normalizeBook(await request.json());
        await write("books", book);
        return json(book, 201);
      }
    }
    if (url.pathname === "/api/import" && method === "POST") {
      const form = await request.formData();
      const file = form.get("file") || form.get("project") || form.get("document");
      if (!(file instanceof File)) return json({ error: "Выберите файл для импорта" }, 400);
      if (/\.epub$/i.test(file.name)) return json({ error: "Импорт EPUB требует подключения к серверу. Импортируйте TXT или Markdown-файл." }, 422);
      const source = await file.text();
      const title = String(form.get("title") || file.name.replace(/\.(txt|md|markdown)$/i, "") || "Новая история");
      const lines = source.split(/\r?\n/);
      let chapters = [];
      let current = { title: "Глава 1", group: "Том 1", content: "" };
      for (const line of lines) {
        const heading = line.match(/^#{1,3}\s+(.+)$/);
        if (heading && current.content) {
          chapters.push({ ...current, id: crypto.randomUUID() });
          current = { title: heading[1].trim(), group: "Том 1", content: "" };
        } else if (heading) current.title = heading[1].trim();
        else if (line.trim()) current.content += `<p>${escapeHtml(line)}</p>`;
      }
      if (current.content || !chapters.length) chapters.push({ ...current, id: crypto.randomUUID() });
      const book = normalizeBook({ title, author: String(form.get("author") || ""), chapters, lore: [] });
      await write("books", book);
      return json(book, 201);
    }
    if (parts[0] === "api" && parts[1] === "books" && parts[2]) {
      const id = parts[2];
      const book = await getBook(id);
      if (parts[3] === "export-text" && method === "GET") {
        if (!book) return json({ error: "Проект не найден" }, 404);
        const format = url.searchParams.get("format") === "md" ? "md" : "txt";
        const content = `# ${book.title}\n\n${book.author}\n\n${book.chapters.map(ch => `## ${ch.title}\n\n${cleanText(ch.content)}`).join("\n\n")}`;
        return textResponse(content, format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8", `${book.title}.${format}`);
      }
      if (parts[3] === "export" && method === "GET") {
        if (!book) return json({ error: "Проект не найден" }, 404);
        try {
          const bytes = await exportEpub(book);
          return new Response(bytes, { headers: { "Content-Type": "application/epub+zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(book.title)}.epub` } });
        } catch (error) { return json({ error: error instanceof Error ? error.message : "Ошибка экспорта" }, 500); }
      }
      if (method === "GET") return book ? json(book) : json({ error: "Проект не найден" }, 404);
      if (method === "PATCH") {
        if (!book) return json({ error: "Проект не найден" }, 404);
        const updated = normalizeBook(await request.json(), book);
        await write("books", updated);
        return json(updated);
      }
      if (method === "DELETE") {
        if (!book) return json({ error: "Проект не найден" }, 404);
        await remove("books", id);
        return json({ ok: true });
      }
    }
    return json({ error: "Офлайн API не поддерживает этот запрос" }, 404);
  }
  window.fetch = async function(input, init) {
    const originalUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(originalUrl, location.href);
    if (url.origin === location.origin && url.pathname.startsWith("/api/")) {
      const request = input instanceof Request ? new Request(input, init) : new Request(url.toString(), init);
      try { return await offlineApi(request, url); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Ошибка локального хранилища" }, 500); }
    }
    return nativeFetch(input, init);
  };
  // Static export contains one generated dynamic route shell; use a full document
  // load so the native asset server can map each project URL to that shell.
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!anchor || anchor.target || event.defaultPrevented || event.button !== 0) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || !/^\/project\/[^/]+$/.test(url.pathname)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign(url.href);
  }, true);
})();
