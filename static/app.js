const $ = id => document.getElementById(id);
let state = {};
let noticeUntil = 0;
async function api(path, body) {
  const res = await fetch('/api/' + path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Что-то пошло не так'); return data;
}
function notice(text, isError = true, automatic = false) { if (automatic && Date.now() < noticeUntil) return; if (!automatic && text) noticeUntil = Date.now() + 12000; const n = $('notice'); n.textContent = text; n.hidden = !text; n.classList.toggle('success', !isError); }
async function refresh() {
  try {
    state = await api('status');
    $('botInfo').textContent = state.connected ? '✓  Подключён @' + state.bot_name : '✧  Токен хранится только на вашем сервере.';
    $('connect').innerHTML = (state.connected ? 'Обновить токен' : 'Подключить бота') + ' <span>↗</span>';
    const select = $('channel'), current = state.selected;
    select.replaceChildren(new Option(state.channels.length ? 'Выберите канал' : 'Ожидание канала...', ''));
    state.channels.forEach(c => select.add(new Option(c.title + (c.username ? '  @' + c.username : ''), String(c.id))));
    select.value = current || '';
    $('toggle').innerHTML = (state.running ? 'Поставить на паузу' : 'Запустить / продолжить') + ' <span>' + (state.running ? 'Ⅱ' : '↗') + '</span>';
    $('toggle').classList.toggle('stop', state.running);
    $('topStatus').innerHTML = '<span></span> ' + (state.running ? 'Бот работает' : 'Не запущен');
    $('topStatus').classList.toggle('active', state.running);
    const selected = state.channels.find(c => String(c.id) === current);
    $('runHint').textContent = selected?.updated_at ? '✧  Последнее обновление: ' + selected.updated_at + ' UTC' : '✧  Пауза сохраняет ваш пост.';
    $('currentChannel').textContent = selected ? selected.title + (selected.username ? ' (@' + selected.username + ')' : '') + ' · ID ' + selected.id : 'Не выбран';
    $('currentPost').textContent = selected?.message_id ? String(selected.message_id) : 'Появится после публикации';
    $('currentRun').textContent = state.running ? (state.error ? 'Работает, ожидается повтор' : 'Работает') : 'На паузе';
    $('mode').value = state.mode || 'mixed';
    renderLogs(state.events || []);
    if (state.error || state.poll_error) notice(state.error || 'Ошибка получения событий: ' + state.poll_error, true, true);
    else notice('', true, true);
  } catch(e) { notice(e.message); }
}
function renderLogs(events) {
  const container = $('logs');
  container.replaceChildren();
  if (!events.length) {
    const empty = document.createElement('div'); empty.className = 'log-empty';
    empty.textContent = 'Здесь появятся действия бота.'; container.appendChild(empty); return;
  }
  const labels = {info: 'ИНФО', success: 'ГОТОВО', warning: 'ПРОБЛЕМА', error: 'ОШИБКА'};
  events.forEach(entry => {
    const row = document.createElement('div'); row.className = 'log-row';
    const time = document.createElement('time'); time.textContent = entry.created_at;
    const badge = document.createElement('span'); badge.className = 'log-level ' + (labels[entry.level] ? entry.level : 'info'); badge.textContent = labels[entry.level] || 'ИНФО';
    const message = document.createElement('span'); message.className = 'log-message'; message.textContent = entry.message;
    row.append(time, badge, message); container.appendChild(row);
  });
}
$('reveal').onclick = () => { $('token').type = $('token').type === 'password' ? 'text' : 'password'; };
function rememberToken(token) { try { localStorage.setItem('asuna-backup-token', token); } catch (_) {} }
function storedToken() { try { return localStorage.getItem('asuna-backup-token') || ''; } catch (_) { return ''; } }
$('connect').onclick = async () => { const b = $('connect'), token = $('token').value.trim(); b.disabled = true; try { await api('token', {token}); rememberToken(token); $('token').value = ''; await refresh(); } catch(e) { notice(e.message); } finally { b.disabled = false; } };
$('channel').onchange = async e => { if (!e.target.value) return; try { await api('select', {channel:e.target.value}); await refresh(); } catch(err) { notice(err.message); } };
$('connectChannel').onclick = async () => {
  const input = $('channelReference'), reference = input.value.trim(), button = $('connectChannel');
  if (!reference) { notice('Введите ID канала, @имя или ссылку на пост.'); input.focus(); return; }
  if (!confirm('Канал будет выбран и бот перейдёт на паузу. Если это ссылка на пост, бот попытается продолжить именно его. Продолжить?')) return;
  button.disabled = true;
  try {
    const result = await api('channel-reference', {reference}); input.value = ''; await refresh();
    notice(result.message_id ? 'Канал и ID поста сохранены. Нажмите «Запустить / продолжить».' : 'Канал подключён. Нажмите «Запустить / продолжить».', false);
  } catch(err) { notice(err.message); } finally { button.disabled = false; }
};
$('toggle').onclick = async () => { try { await api('toggle', {running:!state.running}); await refresh(); } catch(e) { notice(e.message); } };
$('savePostId').onclick = async () => {
  const value = $('postId').value.trim(), id = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id < 1) { notice('Введите положительный числовой ID поста.'); return; }
  if (!confirm('Бот будет редактировать указанный пост в выбранном канале и перейдёт на паузу. Сохранить ID?')) return;
  try { await api('post-id', {message_id:id}); $('postId').value = ''; await refresh(); notice('ID поста сохранён. Нажмите «Запустить / продолжить».', false); }
  catch (err) { notice(err.message); }
};
$('mode').onchange = async e => { try { await api('mode', {mode:e.target.value}); await refresh(); } catch(err) { notice(err.message); } };
$('export').onclick = async () => {
  const token = $('token').value.trim() || storedToken();
  if (!token) { notice('Для первого экспорта введите токен бота в поле выше. Настройки бота не изменятся.'); $('token').focus(); return; }
  if (!confirm('В TXT-файле будет токен бота. Храните файл в безопасном месте и никому не отправляйте. Скачать?')) return;
  try {
    const response = await fetch('/api/export', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}), cache:'no-store'});
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Не удалось скачать файл'); }
    const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'asuna-studio-backup.txt'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    rememberToken(token); $('token').value = ''; notice('Файл сохранён. Храните его в безопасном месте.', false);
  } catch (err) { notice(err.message); }
};
$('importButton').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (file.size > 256 * 1024) { notice('Файл слишком большой. Выберите TXT, скачанный из этой панели.'); return; }
  if (!confirm('Импорт заменит текущие настройки и поставит бота на паузу. Продолжить?')) return;
  const button = $('importButton'); button.disabled = true;
  try {
    let backup; try { backup = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch (_) { throw new Error('Не удалось прочитать файл. Выберите TXT, скачанный из этой панели.'); }
    await api('import', backup); rememberToken(backup.token); await refresh();
    notice('Данные восстановлены. Бот на паузе; нажмите «Запустить / продолжить».', false);
  } catch(err) { notice(err.message); } finally { button.disabled = false; }
};
refresh(); setInterval(refresh, 5000);
