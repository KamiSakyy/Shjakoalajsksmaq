const $ = id => document.getElementById(id);
let state = {};
async function api(path, body) {
  const res = await fetch('/api/' + path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Что-то пошло не так'); return data;
}
function notice(text, isError = true) { const n = $('notice'); n.textContent = text; n.hidden = !text; n.classList.toggle('success', !isError); }
async function refresh() {
  try {
    state = await api('status');
    $('botInfo').textContent = state.connected ? '✓  Подключён @' + state.bot_name : '✧  Токен хранится только на вашем сервере.';
    $('connect').innerHTML = (state.connected ? 'Обновить токен' : 'Подключить бота') + ' <span>↗</span>';
    const select = $('channel'), current = state.selected;
    select.replaceChildren(new Option(state.channels.length ? 'Выберите канал' : 'Ожидание канала...', ''));
    state.channels.forEach(c => select.add(new Option(c.title + (c.username ? '  @' + c.username : ''), String(c.id))));
    select.value = current || '';
    $('toggle').innerHTML = (state.running ? 'Остановить бота' : 'Запустить бота') + ' <span>' + (state.running ? '■' : '↗') + '</span>';
    $('toggle').classList.toggle('stop', state.running);
    $('topStatus').innerHTML = '<span></span> ' + (state.running ? 'Бот работает' : 'Не запущен');
    $('topStatus').classList.toggle('active', state.running);
    const selected = state.channels.find(c => String(c.id) === current);
    $('runHint').textContent = selected?.updated_at ? '✧  Последнее обновление: ' + selected.updated_at + ' UTC' : '✧  Можно остановить в любой момент.';
    if (state.error || state.poll_error) notice(state.error || 'Ошибка получения событий: ' + state.poll_error);
    else notice('');
  } catch(e) { notice(e.message); }
}
$('reveal').onclick = () => { $('token').type = $('token').type === 'password' ? 'text' : 'password'; };
$('connect').onclick = async () => { const b = $('connect'); b.disabled = true; try { await api('token', {token:$('token').value}); $('token').value = ''; await refresh(); } catch(e) { notice(e.message); } finally { b.disabled = false; } };
$('channel').onchange = async e => { if (!e.target.value) return; try { await api('select', {channel:e.target.value}); await refresh(); } catch(err) { notice(err.message); } };
$('toggle').onclick = async () => { try { await api('toggle', {running:!state.running}); await refresh(); } catch(e) { notice(e.message); } };
refresh(); setInterval(refresh, 5000);
