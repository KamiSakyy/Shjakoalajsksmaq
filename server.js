const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yazl = require('yazl');
const { pipeline } = require('stream/promises');

const app = express();
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'uploads'));
fs.mkdirSync(dataDir, { recursive: true });
const upload = multer({ dest: dataDir, limits: { fileSize: 100 * 1024 * 1024, files: 20 } });

app.disable('x-powered-by');
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (_req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/app.js', (_req, res) => res.sendFile(path.join(__dirname, 'app.js')));
function safeName(file) {
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8')
    .replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200);
  return !name || name === '.' || name === '..' ? 'file' : name;
}

app.post('/api/upload', (req, res) => {
  upload.array('file', 20)(req, res, async err => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Каждый файл должен быть не больше 100 МБ.' :
        (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') ? 'Можно загрузить не более 20 файлов.' : 'Не удалось загрузить файлы.';
      return res.status(400).json({ error: message });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Выберите файлы.' });
    const id = crypto.randomBytes(24).toString('hex');
    const target = path.join(dataDir, id);
    const cleanup = () => files.forEach(file => { try { fs.unlinkSync(file.path); } catch (_) {} });
    try {
      let name;
      if (files.length === 1) {
        name = safeName(files[0]);
        fs.renameSync(files[0].path, target);
      } else {
        name = 'files.zip';
        const zip = new yazl.ZipFile();
        zip.on('error', error => zip.outputStream.destroy(error));
        const used = new Set();
        for (const file of files) {
          const original = safeName(file);
          const ext = path.extname(original);
          const base = original.slice(0, original.length - ext.length);
          let entry = original;
          let suffix = 2;
          while (used.has(entry.toLowerCase())) entry = `${base} (${suffix++})${ext}`;
          used.add(entry.toLowerCase());
          zip.addFile(file.path, entry);
        }
        const finished = pipeline(zip.outputStream, fs.createWriteStream(target, { flags: 'wx' }));
        zip.end();
        await finished;
      }
      const size = files.reduce((sum, file) => sum + file.size, 0);
      fs.writeFileSync(path.join(dataDir, `${id}.json`), JSON.stringify({ name, size }), { flag: 'wx' });
      cleanup();
      res.status(201).json({ url: `/download/${id}`, name, size, count: files.length });
    } catch (e) {
      cleanup();
      try { fs.unlinkSync(target); } catch (_) {}
      res.status(500).json({ error: 'Не удалось сохранить файлы.' });
    }
  });
});
app.get('/download/:id', (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9]{48}$/.test(id)) return res.status(404).send('Файл не найден');
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dataDir, `${id}.json`), 'utf8'));
    res.set('X-Content-Type-Options', 'nosniff');
    res.download(path.join(dataDir, id), meta.name, err => {
      if (err && !res.headersSent) res.status(404).send('Файл не найден');
    });
  } catch (_) { res.status(404).send('Файл не найден'); }
});
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`File sharing server listening on ${process.env.PORT || 3000}`));
