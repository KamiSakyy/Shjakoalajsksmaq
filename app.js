const input = document.querySelector('#file');
const dropzone = document.querySelector('#dropzone');
const selected = document.querySelector('#selected');
const upload = document.querySelector('#upload');
const message = document.querySelector('#message');
const result = document.querySelector('#result');
const progress = document.querySelector('#progress');
const remove = document.querySelector('#remove');
let files = [];
function selectFiles(next) {
  files = Array.from(next || []);
  result.hidden = true;
  message.textContent = '';
  progress.hidden = true;
  if (files.length > 20) { files = []; message.textContent = 'Можно выбрать не более 20 файлов.'; }
  else if (files.some(file => file.size > 100 * 1024 * 1024)) { files = []; message.textContent = 'Каждый файл должен быть не больше 100 МБ.'; }
  selected.hidden = !files.length;
  upload.disabled = !files.length;
  if (files.length) {
    document.querySelector('#filename').textContent = files.length === 1 ? files[0].name : `Выбрано файлов: ${files.length}`;
    const size = files.reduce((sum, file) => sum + file.size, 0);
    document.querySelector('#filesize').textContent = (size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`) + (files.length > 1 ? ' · скачаются одним ZIP-архивом' : '');
  }
}
input.addEventListener('change', () => selectFiles(input.files));
remove.addEventListener('click', () => { input.value = ''; selectFiles([]); });
for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, e => { e.preventDefault(); if (!input.disabled) dropzone.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', e => { if (!input.disabled) { input.value = ''; selectFiles(e.dataTransfer.files); } });
upload.addEventListener('click', () => {
  if (!files.length) return;
  const data = new FormData(); files.forEach(file => data.append('file', file));
  const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
  upload.disabled = true; input.disabled = true; remove.disabled = true;
  progress.hidden = false; document.querySelector('#progressbar').style.width = '0%'; message.textContent = 'Загружаем файлы…';
  xhr.upload.onprogress = e => { if (e.lengthComputable) document.querySelector('#progressbar').style.width = `${e.loaded / e.total * 100}%`; };
  xhr.onload = () => { let response; try { response = JSON.parse(xhr.responseText); } catch (_) { response = {}; }
    if (xhr.status === 201) { document.querySelector('#link').value = new URL(response.url, location.origin).href; document.querySelector('#result-description').textContent = response.count > 1 ? 'По ссылке все файлы скачиваются одним ZIP-архивом.' : 'По этой ссылке файл скачивается напрямую.'; result.hidden = false; message.textContent = ''; }
    else { message.textContent = response.error || 'Ошибка загрузки. Попробуйте ещё раз.'; }
    upload.disabled = false; input.disabled = false; remove.disabled = false;
  };
  xhr.onerror = () => { message.textContent = 'Ошибка сети. Попробуйте ещё раз.'; upload.disabled = false; input.disabled = false; remove.disabled = false; };
  xhr.send(data);
});
document.querySelector('#copy').addEventListener('click', async () => {
  const field = document.querySelector('#link');
  try { await navigator.clipboard.writeText(field.value); message.textContent = 'Ссылка скопирована.'; }
  catch (_) { field.select(); message.textContent = 'Выделите и скопируйте ссылку вручную.'; }
});
