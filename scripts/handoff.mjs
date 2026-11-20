// Копирует собранный одиночный index.html в папку handoff,
// чтобы файл можно было запустить локально или приложить к релизу.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'dist/index.html');
const outDir = resolve(root, 'handoff');
mkdirSync(outDir, { recursive: true });
copyFileSync(src, resolve(outDir, 'index.html'));
const kb = Math.round(statSync(src).size / 1024);
console.log(`handoff/index.html готов — ${kb} КБ, всё внутри одного файла.`);
