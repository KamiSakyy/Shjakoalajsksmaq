import logging
import os
import random
import sqlite3
import threading
import time
from urllib.parse import urlparse

import requests
from flask import Flask, jsonify, request, send_from_directory

DATA_DIR = os.environ.get('RAILWAY_VOLUME_MOUNT_PATH') or os.environ.get('DATA_DIR', './data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'bot.sqlite3')
app = Flask(__name__, static_folder='static')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024
logging.basicConfig(level=logging.INFO)
lock = threading.RLock()
wake = threading.Event()


def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY, title TEXT NOT NULL, username TEXT, message_id INTEGER, last_art INTEGER, updated_at TEXT);
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


def telegram(token, method, data=None, files=None, timeout=20):
    try:
        response = requests.post('https://api.telegram.org/bot' + token + '/' + method, data=data or {}, files=files, timeout=timeout)
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise RuntimeError('Не удалось связаться с Telegram') from exc
    if not payload.get('ok'):
        raise RuntimeError(payload.get('description', 'Ошибка Telegram'))
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
            c.execute('''INSERT INTO channels (id,title,username) VALUES (?,?,?)
                ON CONFLICT(id) DO UPDATE SET title=excluded.title, username=excluded.username''',
                (chat['id'], chat.get('title', str(chat['id'])), chat.get('username')))
    except Exception as exc:
        logging.warning('Cannot verify channel: %s', exc)


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
                put('poll_error', str(exc))
            time.sleep(5)
        else:
            if get('token') == token:
                put('poll_error', '')


def get_art(last_id):
    # Danbooru's public API is finite and rate-limited; choose a fresh random page each time.
    headers = {'User-Agent': 'AsunaChannelBot/1.0 (Telegram channel art rotator)'}
    page = random.randint(1, 100)
    r = requests.get('https://danbooru.donmai.us/posts.json', params={
        'tags': 'asuna_(sword_art_online) rating:general', 'limit': 40, 'page': page}, headers=headers, timeout=20)
    r.raise_for_status()
    posts = r.json()
    random.shuffle(posts)
    for post in posts:
        if str(post.get('id')) == str(last_id):
            continue
        # Prefer a Telegram-compatible sample over huge original files.
        url = post.get('large_file_url') or post.get('file_url') or post.get('preview_file_url')
        if not url or urlparse(url).scheme != 'https' or not (urlparse(url).hostname or '').endswith('.donmai.us'):
            continue
        try:
            image = requests.get(url, headers=headers, timeout=25, stream=True, allow_redirects=False)
            image.raise_for_status()
            content_type = image.headers.get('Content-Type', '').split(';')[0].lower()
            if content_type not in ('image/jpeg', 'image/png'):
                continue
            chunks, size = [], 0
            for chunk in image.iter_content(65536):
                size += len(chunk)
                if size > 9 * 1024 * 1024:
                    break
                chunks.append(chunk)
            else:
                if size:
                    return post['id'], b''.join(chunks), content_type
        except requests.RequestException:
            continue
    raise RuntimeError('Не удалось загрузить подходящий арт. Попробуем снова.')


def rotate_once():
    token, channel = get('token'), get('channel')
    if not token or not channel or get('running') != '1':
        return
    with db() as c:
        row = c.execute('SELECT * FROM channels WHERE id=?', (channel,)).fetchone()
    if not row:
        put('running', '0')
        put('error', 'Канал не найден. Добавьте бота как администратора заново.')
        return
    art_id, image, mime = get_art(row['last_art'])
    # Prevent a configuration change while a Telegram request is in flight.
    with lock:
        if token != get('token') or channel != get('channel') or get('running') != '1':
            return
        caption = f'Асуна Юки ✨\nИсточник: https://danbooru.donmai.us/posts/{art_id}'
        filename = 'art.png' if mime == 'image/png' else 'art.jpg'
        if row['message_id']:
            import json
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


def rotate_loop():
    while True:
        if get('running') == '1':
            started = time.monotonic()
            try:
                rotate_once()
            except Exception as exc:
                logging.warning('Rotation error: %s', exc)
                put('error', str(exc)[:300])
            # Ten seconds between attempts, not a promise that third parties respond on time.
            wake.wait(max(1, 10 - (time.monotonic() - started)))
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
    return jsonify(connected=bool(get('token')), bot_name=get('bot_name'), channels=channels,
        selected=get('channel'), running=get('running') == '1', error=get('error'), poll_error=get('poll_error'))


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
            if get('token') != token:
                with db() as c:
                    c.execute('DELETE FROM channels')
                    c.execute('DELETE FROM settings')
            put('token', token)
            put('bot_name', me.get('username', me.get('first_name', 'Бот')))
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
        put('running', '0')
        put('channel', channel)
        put('error', '')
    return jsonify(ok=True)


@app.post('/api/toggle')
def toggle():
    running = bool((request.get_json(silent=True) or {}).get('running'))
    with lock:
        if running and (not get('token') or not get('channel')):
            return jsonify(error='Сначала подключите бота и выберите канал.'), 400
        put('running', '1' if running else '0')
        put('error', '')
    wake.set()
    return jsonify(ok=True)


init_db()
if __name__ == '__main__':
    threading.Thread(target=poll_loop, daemon=True).start()
    threading.Thread(target=rotate_loop, daemon=True).start()
    from waitress import serve
    serve(app, host='0.0.0.0', port=int(os.environ.get('PORT', '8080')), threads=8)
