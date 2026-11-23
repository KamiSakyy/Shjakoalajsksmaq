import logging
import hmac
import json
import os
import random
import sqlite3
import threading
import time
from urllib.parse import urlparse, urljoin

import requests
from flask import Flask, Response, jsonify, request, send_from_directory

DATA_DIR = os.environ.get('RAILWAY_VOLUME_MOUNT_PATH') or os.environ.get('DATA_DIR', './data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'bot.sqlite3')
app = Flask(__name__, static_folder='static')
app.config['MAX_CONTENT_LENGTH'] = 256 * 1024
logging.basicConfig(level=logging.INFO)
lock = threading.RLock()
wake = threading.Event()
revision = 0


def invalidate_rotation():
    global revision
    revision += 1



def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY, title TEXT NOT NULL, username TEXT, message_id INTEGER, last_art INTEGER, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), level TEXT NOT NULL, message TEXT NOT NULL);
        ''')
    try:
        os.chmod(DB_PATH, 0o600)
    except OSError:
        pass


def get(key, default=''):
    with db() as c:
        row = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return row['value'] if row else default


def put(key, value):
    with db() as c:
        c.execute('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))


def event(level, message):
    # Logs are visible on the site. Never include a bot token, URLs with credentials,
    # image response bodies or arbitrary request exceptions in them.
    message = str(message)
    token = get('token')
    if token:
        message = message.replace(token, '[токен скрыт]')
    message = message[:500]
    with db() as c:
        c.execute('INSERT INTO events (level, message) VALUES (?, ?)', (level, message))
        c.execute('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 150)')
    logging.info('%s: %s', level.upper(), message)


def network_reason(exc):
    if isinstance(exc, requests.Timeout):
        return 'превышено время ожидания'
    if isinstance(exc, requests.ConnectionError):
        return 'нет соединения с сервером'
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        code = exc.response.status_code
        return f'HTTP {code}' + (' (слишком много запросов)' if code == 429 else ' (доступ запрещён)' if code in (401, 403) else '')
    if isinstance(exc, ValueError):
        return 'ответ API не похож на JSON'
    return 'ошибка сети или ответа сервера'


def telegram(token, method, data=None, files=None, timeout=20):
    try:
        response = requests.post('https://api.telegram.org/bot' + token + '/' + method, data=data or {}, files=files, timeout=timeout)
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise RuntimeError('Telegram: ' + network_reason(exc)) from exc
    if not payload.get('ok'):
        description = str(payload.get('description', 'Ошибка Telegram')).replace(token, '[токен скрыт]')
        lower = description.lower()
        if 'chat not found' in lower:
            explanation = 'канал не найден, проверьте, что бот добавлен в него'
        elif 'not enough rights' in lower or 'forbidden' in lower:
            explanation = 'не хватает прав: дайте боту права публиковать и редактировать сообщения'
        elif 'message to edit not found' in lower or "message can't be edited" in lower:
            explanation = 'исходный пост удалён или недоступен для редактирования; новый пост автоматически не создаётся'
        elif 'too many requests' in lower:
            explanation = 'слишком много запросов, повторим позже'
        elif 'unauthorized' in lower:
            explanation = 'неверный токен бота'
        else:
            explanation = 'ошибка запроса'
        raise RuntimeError(f'Telegram: {explanation} ({description})')
    return payload['result']


def remember_channel(token, chat):
    if chat.get('type') != 'channel' or get('token') != token:
        return
    try:
        me = telegram(token, 'getMe')
        member = telegram(token, 'getChatMember', {'chat_id': chat['id'], 'user_id': me['id']})
        if member.get('status') not in ('administrator', 'creator'):
            return
        with db() as c:
            existed = c.execute('SELECT 1 FROM channels WHERE id=?', (chat['id'],)).fetchone()
            c.execute('''INSERT INTO channels (id,title,username) VALUES (?,?,?)
                ON CONFLICT(id) DO UPDATE SET title=excluded.title, username=excluded.username''',
                (chat['id'], chat.get('title', str(chat['id'])), chat.get('username')))
        if not existed:
            event('success', 'Канал обнаружен: ' + chat.get('title', str(chat['id'])))
    except Exception as exc:
        event('error', 'Не удалось проверить права бота в канале: ' + str(exc).replace(token, '[токен скрыт]'))


def process_update(token, update):
    event = update.get('my_chat_member', {})
    chat = event.get('chat', {})
    if chat.get('type') == 'channel':
        status = event.get('new_chat_member', {}).get('status')
        if status in ('administrator', 'creator'):
            remember_channel(token, chat)
        elif status in ('left', 'kicked', 'member', 'restricted') and get('token') == token:
            with db() as c:
                c.execute('DELETE FROM channels WHERE id=?', (chat['id'],))
            if get('channel') == str(chat['id']):
                put('running', '0')
                put('error', 'Бот больше не администратор выбранного канала.')
    post = update.get('channel_post', {})
    if post.get('chat', {}).get('type') == 'channel':
        remember_channel(token, post['chat'])
    message = update.get('message', {})
    origin = message.get('forward_origin', {})
    forwarded = origin.get('chat') if origin.get('type') == 'channel' else message.get('forward_from_chat')
    if forwarded and message.get('chat', {}).get('type') == 'private':
        remember_channel(token, forwarded)


def poll_loop():
    while True:
        token = get('token')
        if not token:
            time.sleep(2)
            continue
        try:
            updates = telegram(token, 'getUpdates', {'offset': get('offset', '0'), 'timeout': 10,
                'allowed_updates': '["my_chat_member","channel_post","message"]'}, timeout=15)
            for update in updates:
                with lock:
                    if get('token') != token:
                        break
                    process_update(token, update)
                    put('offset', update['update_id'] + 1)
        except Exception as exc:
            logging.warning('Polling error: %s', exc)
            if get('token') == token:
                if get('poll_error') != str(exc):
                    event('error', 'Не удалось получить события Telegram: ' + str(exc).replace(token, '[токен скрыт]'))
                put('poll_error', str(exc))
            time.sleep(5)
        else:
            if get('token') == token:
                if get('poll_error'):
                    event('success', 'Связь с Telegram восстановлена.')
                put('poll_error', '')


# Sources are independent public searches. Each uses its own tag for Asuna.
SOURCES = (
    {'name': 'Danbooru', 'endpoint': 'https://danbooru.donmai.us/posts.json',
     'base': 'https://danbooru.donmai.us/', 'domain': 'donmai.us',
     'tags': {'asuna': 'yuuki_asuna -kirigaya_kazuto rating:general', 'kirito': 'kirigaya_kazuto -yuuki_asuna rating:general', 'together': 'yuuki_asuna kirigaya_kazuto rating:general'}, 'page_key': 'page', 'first_page': 1,
     'post_url': 'https://danbooru.donmai.us/posts/{}'},
    {'name': 'Safebooru', 'endpoint': 'https://safebooru.org/index.php',
     'base': 'https://safebooru.org/', 'domain': 'safebooru.org',
     'tags': {'asuna': 'yuuki_asuna -kirigaya_kazuto', 'kirito': 'kirigaya_kazuto -yuuki_asuna', 'together': 'yuuki_asuna kirigaya_kazuto'}, 'page_key': 'pid', 'first_page': 0,
     'post_url': 'https://safebooru.org/index.php?page=post&s=view&id={}'},
    {'name': 'Konachan', 'endpoint': 'https://konachan.net/post.json',
     'base': 'https://konachan.net/', 'domain': 'konachan.net',
     'tags': {'asuna': 'yuuki_asuna -kirigaya_kazuto rating:s', 'kirito': 'kirigaya_kazuto -yuuki_asuna rating:s', 'together': 'yuuki_asuna kirigaya_kazuto rating:s'}, 'page_key': 'page', 'first_page': 1,
     'post_url': 'https://konachan.net/post/show/{}'},
)
MODES = {'mixed': 'Все варианты', 'asuna': 'Асуна', 'kirito': 'Кирито', 'together': 'Асуна и Кирито вместе'}
HEADERS = {'User-Agent': 'AsunaChannelBot/1.0 (Telegram channel art rotator)'}


def allowed_image_url(url, source):
    # A remote API must never be able to make the server fetch an arbitrary host.
    url = urljoin(source['base'], url or '')
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    domain = source['domain']
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
        return None
    if host != domain and not host.endswith('.' + domain):
        return None
    return url


def download_image(url, source):
    url = allowed_image_url(url, source)
    if not url:
        raise ValueError('небезопасная ссылка на изображение')
    headers = dict(HEADERS, Referer=source['base'])
    for _ in range(3):
        response = requests.get(url, headers=headers, timeout=(5, 12), stream=True, allow_redirects=False)
        try:
            if response.status_code in (301, 302, 303, 307, 308):
                url = allowed_image_url(urljoin(url, response.headers.get('Location', '')), source)
                if not url:
                    raise ValueError('небезопасное перенаправление')
                continue
            response.raise_for_status()
            mime = response.headers.get('Content-Type', '').split(';')[0].lower()
            if mime not in ('image/jpeg', 'image/png'):
                raise ValueError('формат не JPEG и не PNG')
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > 9 * 1024 * 1024:
                    raise ValueError('файл больше 9 МБ')
                chunks.append(chunk)
            if not size:
                raise ValueError('пустой файл')
            return b''.join(chunks), mime
        finally:
            response.close()
    raise ValueError('слишком много перенаправлений')


def get_art(last_id, mode='mixed'):
    category = random.choice(('asuna', 'kirito', 'together')) if mode == 'mixed' else mode
    if category not in ('asuna', 'kirito', 'together'):
        raise RuntimeError('Неизвестная категория артов.')
    event('info', 'Категория поиска: ' + MODES[category] + '.')
    reasons = []
    for source in SOURCES:
        name = source['name']
        page = random.randint(source['first_page'], source['first_page'] + 8)
        params = {'tags': source['tags'][category], 'limit': 40, source['page_key']: page}
        if name == 'Safebooru':
            params.update({'page': 'dapi', 's': 'post', 'q': 'index', 'json': 1})
        event('info', f'{name}: ищем арты (страница {page}).')
        try:
            response = requests.get(source['endpoint'], params=params, headers=HEADERS, timeout=(5, 12))
            response.raise_for_status()
            posts = response.json()
            if isinstance(posts, dict):
                posts = posts.get('post', [])
            if not isinstance(posts, list):
                raise ValueError('неверный формат')
            # A page beyond the end is common for small galleries. Retry the first page.
            if not posts and page != source['first_page']:
                params[source['page_key']] = source['first_page']
                response = requests.get(source['endpoint'], params=params, headers=HEADERS, timeout=(5, 12))
                response.raise_for_status()
                posts = response.json()
                if isinstance(posts, dict):
                    posts = posts.get('post', [])
            if not isinstance(posts, list):
                raise ValueError('неверный формат')
        except (requests.RequestException, ValueError) as exc:
            reason = network_reason(exc)
            reasons.append(f'{name}: {reason}')
            event('warning', f'{name}: {reason}. Пробуем следующий источник.')
            continue
        if not posts:
            reasons.append(f'{name}: ничего не найдено')
            event('warning', f'{name}: арты не найдены. Пробуем следующий источник.')
            continue
        random.shuffle(posts)
        failures = []
        count = 0
        for post in posts:
            if not isinstance(post, dict) or not post.get('id'):
                continue
            art_key = f"{name}:{post['id']}"
            if str(last_id) in (art_key, str(post['id'])):
                continue
            if post.get('rating') and post['rating'] not in ('g', 'general', 's', 'safe'):
                continue
            candidates = [post.get('large_file_url'), post.get('sample_url'), post.get('jpeg_url'), post.get('file_url')]
            if name == 'Safebooru' and post.get('directory') is not None and post.get('image'):
                candidates.append(f"/images/{post['directory']}/{post['image']}")
            for url in dict.fromkeys(u for u in candidates if isinstance(u, str) and u):
                if count >= 4:
                    break
                count += 1
                try:
                    image, mime = download_image(url, source)
                    event('success', f'{name}: арт №{post["id"]} скачан, отправляем в Telegram.')
                    return art_key, image, mime, source['post_url'].format(post['id'])
                except requests.RequestException as exc:
                    failures.append(network_reason(exc))
                    if isinstance(exc, requests.HTTPError) and exc.response is not None and exc.response.status_code == 429:
                        count = 4  # Do not keep hammering a rate-limited source.
                except ValueError as exc:
                    failures.append(str(exc))
            if count >= 4:
                break
        reason = ', '.join(dict.fromkeys(failures)) if failures else 'нет подходящих файлов'
        reasons.append(f'{name}: {reason}')
        event('warning', f'{name}: найдено {len(posts)} записей, скачать не удалось: {reason}. Пробуем следующий источник.')
    raise RuntimeError('Все источники недоступны. ' + '; '.join(reasons))


def rotate_once():
    with lock:
        token, channel = get('token'), get('channel')
        mode, current_revision = get('mode', 'mixed'), revision
        if not token or not channel or get('running') != '1':
            return
    with db() as c:
        row = c.execute('SELECT * FROM channels WHERE id=?', (channel,)).fetchone()
    if not row:
        put('running', '0')
        put('error', 'Канал не найден. Добавьте бота как администратора заново.')
        return
    art_id, image, mime, source_url = get_art(row['last_art'], mode)
    # Prevent a configuration change while a Telegram request is in flight.
    with lock:
        if current_revision != revision or token != get('token') or channel != get('channel') or get('running') != '1':
            return
        caption = 'Бесконечные арты с Асуной и Кирито каждые 10 секунд'
        filename = 'art.png' if mime == 'image/png' else 'art.jpg'
        if row['message_id']:
            result = telegram(token, 'editMessageMedia', {
                'chat_id': channel, 'message_id': row['message_id'],
                'media': json.dumps({'type': 'photo', 'media': 'attach://photo', 'caption': caption}, ensure_ascii=False)
            }, files={'photo': (filename, image, mime)})
            message_id = row['message_id']
        else:
            result = telegram(token, 'sendPhoto', {'chat_id': channel, 'caption': caption}, files={'photo': (filename, image, mime)})
            message_id = result['message_id']
        with db() as c:
            c.execute("UPDATE channels SET message_id=?, last_art=?, updated_at=datetime('now') WHERE id=?", (message_id, art_id, channel))
        put('error', '')
        event('success', 'Пост обновлён.' if row['message_id'] else 'Первый пост опубликован.')


def rotate_loop():
    while True:
        if get('running') == '1':
            started = time.monotonic()
            delay = 10
            try:
                rotate_once()
            except Exception as exc:
                logging.warning('Rotation error: %s', exc)
                token = get('token')
                detail = str(exc).replace(token, '[токен скрыт]') if token else str(exc)
                put('error', detail[:300])
                event('error', 'Обновление не удалось: ' + detail[:350] + '. Повторим попытку.')
                delay = 30  # Avoid hammering rate-limited or unavailable services.
            # Target interval between attempts; network time can make it longer.
            wake.wait(max(1, delay - (time.monotonic() - started)))
        else:
            wake.wait(2)
        wake.clear()


@app.before_request
def guard():
    if request.method in ('POST', 'PUT', 'DELETE'):
        origin = request.headers.get('Origin')
        if origin and urlparse(origin).netloc != request.host:
            return jsonify(error='Недопустимый источник запроса'), 403


@app.get('/')
def index():
    return send_from_directory('static', 'index.html')


@app.get('/api/status')
def status():
    with db() as c:
        channels = [dict(r) for r in c.execute('SELECT * FROM channels ORDER BY title')]
        events = [dict(r) for r in c.execute('SELECT id, created_at, level, message FROM events ORDER BY id DESC LIMIT 80')]
    return jsonify(connected=bool(get('token')), bot_name=get('bot_name'), channels=channels, events=events,
        selected=get('channel'), mode=get('mode', 'mixed'), running=get('running') == '1', error=get('error'), poll_error=get('poll_error'))


@app.post('/api/token')
def set_token():
    token = (request.get_json(silent=True) or {}).get('token', '').strip()
    if not token or len(token) > 200 or not all(c.isalnum() or c in ':_-' for c in token):
        return jsonify(error='Введите корректный токен от BotFather.'), 400
    try:
        me = telegram(token, 'getMe')
        if not me.get('is_bot'):
            raise RuntimeError('Этот токен не принадлежит боту.')
        # Long polling and a webhook cannot be used simultaneously.
        telegram(token, 'deleteWebhook', {'drop_pending_updates': 'false'})
        with lock:
            invalidate_rotation()
            if get('token') != token:
                with db() as c:
                    c.execute('DELETE FROM channels')
                    c.execute('DELETE FROM settings')
            put('token', token)
            put('bot_name', me.get('username', me.get('first_name', 'Бот')))
        event('success', 'Бот подключён. Ожидаем добавления в канал.')
        wake.set()
        return jsonify(ok=True)
    except Exception as exc:
        return jsonify(error=str(exc)), 400


@app.post('/api/select')
def select():
    channel = str((request.get_json(silent=True) or {}).get('channel', ''))
    with lock:
        with db() as c:
            exists = c.execute('SELECT 1 FROM channels WHERE id=?', (channel,)).fetchone()
        if not exists:
            return jsonify(error='Канал не найден.'), 400
        invalidate_rotation()
        put('running', '0')
        put('channel', channel)
        put('error', '')
        event('info', 'Канал выбран. Нажмите «Запустить бота».')
    return jsonify(ok=True)


@app.post('/api/toggle')
def toggle():
    running = bool((request.get_json(silent=True) or {}).get('running'))
    with lock:
        if running and (not get('token') or not get('channel')):
            return jsonify(error='Сначала подключите бота и выберите канал.'), 400
        invalidate_rotation()
        put('running', '1' if running else '0')
        put('error', '')
        event('info', 'Бот запущен: начинаем поиск.' if running else 'Бот остановлен. Пост остаётся в канале.')
    wake.set()
    return jsonify(ok=True)


@app.post('/api/post-id')
def set_post_id():
    payload = request.get_json(silent=True) or {}
    message_id = payload.get('message_id')
    if type(message_id) is not int or not 0 < message_id < 2**31:
        return jsonify(error='Введите положительный числовой ID поста.'), 400
    with lock:
        channel = get('channel')
        with db() as c:
            exists = c.execute('SELECT 1 FROM channels WHERE id=?', (channel,)).fetchone()
            if not exists:
                return jsonify(error='Сначала выберите канал.'), 400
            invalidate_rotation()
            c.execute('UPDATE channels SET message_id=?, last_art=NULL, updated_at=NULL WHERE id=?', (message_id, channel))
            c.execute("INSERT INTO settings (key,value) VALUES ('running','0') ON CONFLICT(key) DO UPDATE SET value='0'")
            c.execute("INSERT INTO settings (key,value) VALUES ('error','') ON CONFLICT(key) DO UPDATE SET value=''")
    event('info', f'Сохранён ID поста {message_id}. Бот на паузе; возможность редактирования проверится при запуске.')
    wake.set()
    return jsonify(ok=True)


@app.post('/api/mode')
def set_mode():
    mode = (request.get_json(silent=True) or {}).get('mode')
    if mode not in MODES:
        return jsonify(error='Выберите категорию артов.'), 400
    with lock:
        invalidate_rotation()
        put('mode', mode)
        event('info', 'Выбрана категория: ' + MODES[mode] + '.')
    wake.set()
    return jsonify(ok=True)


@app.post('/api/export')
def export_backup():
    with lock:
        token = get('token')
        if not token:
            return jsonify(error='Сначала подключите бота.'), 400
        proof = (request.get_json(silent=True) or {}).get('token')
        if not isinstance(proof, str) or not hmac.compare_digest(proof.encode('utf-8'), token.encode('utf-8')):
            return jsonify(error='Для экспорта введите текущий токен бота в поле на сайте.'), 403
        with db() as c:
            channels = [dict(row) for row in c.execute('SELECT id,title,username,message_id,last_art,updated_at FROM channels ORDER BY id')]
        backup = {'format': 'asuna-studio-backup', 'version': 1, 'token': token,
                  'selected': get('channel'), 'mode': get('mode', 'mixed'), 'channels': channels}
    # This download contains the bot token. Do not put it in logs or browser caches.
    response = Response(json.dumps(backup, ensure_ascii=False, indent=2), mimetype='text/plain')
    response.headers['Content-Disposition'] = 'attachment; filename="asuna-studio-backup.txt"'
    response.headers['Cache-Control'] = 'no-store, private'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.post('/api/import')
def import_backup():
    backup = request.get_json(silent=True)
    if not isinstance(backup, dict) or backup.get('format') != 'asuna-studio-backup' or backup.get('version') != 1:
        return jsonify(error='Не удалось прочитать файл. Выберите TXT, созданный этой панелью.'), 400
    token = backup.get('token')
    channels = backup.get('channels')
    mode = backup.get('mode', 'mixed')
    selected = str(backup.get('selected') or '')
    if not isinstance(token, str) or not token or len(token) > 200 or not all(c.isalnum() or c in ':_-' for c in token):
        return jsonify(error='В файле указан неверный токен.'), 400
    if not isinstance(channels, list) or len(channels) > 100 or not isinstance(mode, str) or mode not in MODES:
        return jsonify(error='В файле неверный список каналов или категория.'), 400
    checked, seen = [], set()
    for row in channels:
        if not isinstance(row, dict):
            return jsonify(error='В файле неверные данные канала.'), 400
        channel_id, message_id = row.get('id'), row.get('message_id')
        if type(channel_id) is not int or not (-10**16 < channel_id < 0) or channel_id in seen:
            return jsonify(error='В файле неверный или повторяющийся ID канала.'), 400
        if message_id is not None and (type(message_id) is not int or not 0 < message_id < 2**31):
            return jsonify(error='В файле неверный ID поста.'), 400
        last_art = row.get('last_art')
        if last_art is not None and (not isinstance(last_art, (str, int)) or isinstance(last_art, bool) or len(str(last_art)) > 100):
            return jsonify(error='В файле неверный ID арта.'), 400
        updated_at = row.get('updated_at')
        if updated_at is not None and (not isinstance(updated_at, str) or len(updated_at) > 50):
            return jsonify(error='В файле неверная дата обновления.'), 400
        seen.add(channel_id)
        checked.append({'id': channel_id, 'message_id': message_id, 'last_art': last_art, 'updated_at': updated_at})
    if selected and selected not in {str(i) for i in seen}:
        return jsonify(error='Выбранный канал отсутствует в файле.'), 400
    try:
        me = telegram(token, 'getMe')
        if not me.get('is_bot'):
            raise RuntimeError('Токен не принадлежит боту.')
        for row in checked:
            chat = telegram(token, 'getChat', {'chat_id': row['id']})
            member = telegram(token, 'getChatMember', {'chat_id': row['id'], 'user_id': me['id']})
            if chat.get('type') != 'channel' or chat.get('id') != row['id'] or member.get('status') not in ('administrator', 'creator'):
                raise RuntimeError('Бот не является администратором одного из каналов в файле.')
            row['title'] = str(chat.get('title') or row['id'])[:255]
            row['username'] = chat.get('username')
        telegram(token, 'deleteWebhook', {'drop_pending_updates': 'false'})
    except Exception as exc:
        detail = str(exc).replace(token, '[токен скрыт]')
        return jsonify(error='Импорт отменён: ' + detail), 400
    # Save all fields together. Never run automatically after importing a file.
    with lock:
        offset = get('offset', '0') if get('token') == token else '0'
        with db() as c:
            c.execute('DELETE FROM channels')
            c.executemany('INSERT INTO channels (id,title,username,message_id,last_art,updated_at) VALUES (:id,:title,:username,:message_id,:last_art,:updated_at)', checked)
            c.execute('DELETE FROM settings')
            values = {'token': token, 'bot_name': me.get('username') or me.get('first_name', 'Бот'),
                      'channel': selected, 'mode': mode, 'running': '0', 'offset': offset}
            c.executemany('INSERT INTO settings (key,value) VALUES (?,?)', values.items())
        invalidate_rotation()
    event('success', 'Данные импортированы. Бот на паузе; нажмите «Продолжить», чтобы обновить сохранённый пост.')
    wake.set()
    return jsonify(ok=True)


init_db()
if __name__ == '__main__':
    threading.Thread(target=poll_loop, daemon=True).start()
    threading.Thread(target=rotate_loop, daemon=True).start()
    from waitress import serve
    serve(app, host='0.0.0.0', port=int(os.environ.get('PORT', '8080')), threads=8)
