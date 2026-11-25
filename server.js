const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'uploads'));
fs.mkdirSync(dataDir, { recursive: true });
const upload = multer({ dest: dataDir, limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

app.disable('x-powered-by');
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (_req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/app.js', (_req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 100 МБ.' : 'Не удалось загрузить файл.' });
    if (!req.file) return res.status(400).json({ error: 'Выберите файл.' });
    const id = crypto.randomBytes(24).toString('hex');
    // Multer supplies a random temporary filename; the public token never exposes it.
    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8').replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200) || 'file';
    try {
      fs.renameSync(req.file.path, path.join(dataDir, id));
      fs.writeFileSync(path.join(dataDir, `${id}.json`), JSON.stringify({ name: original, size: req.file.size }), { flag: 'wx' });
      res.status(201).json({ url: `/download/${id}`, name: original, size: req.file.size });
    } catch (e) {
      for (const file of [req.file.path, path.join(dataDir, id)]) { try { fs.unlinkSync(file); } catch (_) {} }
      res.status(500).json({ error: 'Не удалось сохранить файл.' });
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
