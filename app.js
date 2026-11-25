const input = document.querySelector('#file');
const dropzone = document.querySelector('#dropzone');
const selected = document.querySelector('#selected');
const upload = document.querySelector('#upload');
const message = document.querySelector('#message');
const result = document.querySelector('#result');
const progress = document.querySelector('#progress');
let file = null;
function selectFile(next) {
  file = next || null;
  result.hidden = true;
  message.textContent = '';
  progress.hidden = true;
  if (file && file.size > 100 * 1024 * 1024) { file = null; message.textContent = 'Максимальный размер файла — 100 МБ.'; }
  selected.hidden = !file;
  upload.disabled = !file;
  if (file) { document.querySelector('#filename').textContent = file.name; document.querySelector('#filesize').textContent = file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} КБ` : `${(file.size / 1024 / 1024).toFixed(1)} МБ`; }
}
input.addEventListener('change', () => selectFile(input.files[0]));
document.querySelector('#remove').addEventListener('click', () => { input.value = ''; selectFile(null); });
for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', e => selectFile(e.dataTransfer.files[0]));
upload.addEventListener('click', () => {
  if (!file) return;
  const data = new FormData(); data.append('file', file);
  const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
  upload.disabled = true; input.disabled = true; document.querySelector('#remove').disabled = true;
  progress.hidden = false; document.querySelector('#progressbar').style.width = '0%'; message.textContent = 'Загружаем файл…';
  xhr.upload.onprogress = e => { if (e.lengthComputable) document.querySelector('#progressbar').style.width = `${e.loaded / e.total * 100}%`; };
  xhr.onload = () => { let response; try { response = JSON.parse(xhr.responseText); } catch (_) { response = {}; }
    if (xhr.status === 201) { document.querySelector('#link').value = new URL(response.url, location.origin).href; result.hidden = false; message.textContent = ''; }
    else { message.textContent = response.error || 'Ошибка загрузки. Попробуйте ещё раз.'; }
    upload.disabled = false; input.disabled = false; document.querySelector('#remove').disabled = false;
  };
  xhr.onerror = () => { message.textContent = 'Ошибка сети. Попробуйте ещё раз.'; upload.disabled = false; input.disabled = false; document.querySelector('#remove').disabled = false; };
  xhr.send(data);
});
document.querySelector('#copy').addEventListener('click', async () => {
  const field = document.querySelector('#link');
  try { await navigator.clipboard.writeText(field.value); message.textContent = 'Ссылка скопирована.'; }
  catch (_) { field.select(); message.textContent = 'Выделите и скопируйте ссылку вручную.'; }
});
