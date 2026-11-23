import os
import tempfile
import unittest
from unittest.mock import patch

tmp = tempfile.TemporaryDirectory()
os.environ['DATA_DIR'] = tmp.name
import app


class BotTests(unittest.TestCase):
    def setUp(self):
        with app.db() as c:
            c.execute('DELETE FROM settings')
            c.execute('DELETE FROM channels')
            c.execute('DELETE FROM events')
        self.client = app.app.test_client()

    def test_connect_and_discover_forwarded_channel(self):
        def telegram(token, method, data=None, **kwargs):
            if method == 'getMe':
                return {'id': 42, 'is_bot': True, 'username': 'asuna_bot'}
            if method == 'getChatMember':
                return {'status': 'administrator'}
            return True
        with patch.object(app, 'telegram', side_effect=telegram):
            result = self.client.post('/api/token', json={'token': '123:ABC_def'})
            self.assertEqual(result.status_code, 200)
            app.process_update('123:ABC_def', {'message': {'chat': {'type': 'private'}, 'forward_origin': {'type': 'channel', 'chat': {'id': -100123, 'type': 'channel', 'title': 'My channel'}}}})
            status = self.client.get('/api/status').json
            self.assertEqual(status['channels'][0]['title'], 'My channel')
            self.assertNotIn('123:ABC_def', str(status))

    def test_first_post_then_edit_same_message(self):
        app.put('token', '123:abc')
        with app.db() as c:
            c.execute('INSERT INTO channels (id,title) VALUES (?,?)', (-100123, 'Channel'))
        self.client.post('/api/select', json={'channel': '-100123'})
        self.client.post('/api/toggle', json={'running': True})
        with patch.object(app, 'get_art', side_effect=[('Danbooru:1', b'jpeg', 'image/jpeg', 'https://danbooru.donmai.us/posts/1'), ('Danbooru:2', b'jpeg', 'image/jpeg', 'https://danbooru.donmai.us/posts/2')]), patch.object(app, 'telegram', side_effect=[{'message_id': 5}, True]) as tg:
            app.rotate_once()
            app.rotate_once()
        self.assertEqual([call.args[1] for call in tg.call_args_list], ['sendPhoto', 'editMessageMedia'])
        self.assertEqual(tg.call_args_list[1].args[2]['message_id'], 5)
        self.assertEqual(self.client.get('/api/status').json['channels'][0]['last_art'], 'Danbooru:2')

    def test_edit_failure_never_sends_new_post(self):
        app.put('token', '123:abc')
        app.put('channel', '-100123')
        app.put('running', '1')
        with app.db() as c:
            c.execute('INSERT INTO channels (id,title,message_id) VALUES (?,?,?)', (-100123, 'Channel', 5))
        with patch.object(app, 'get_art', return_value=('Danbooru:3', b'jpeg', 'image/jpeg', 'https://danbooru.donmai.us/posts/3')), patch.object(app, 'telegram', side_effect=RuntimeError('message not found')) as tg:
            with self.assertRaises(RuntimeError): app.rotate_once()
        self.assertEqual(tg.call_args.args[1], 'editMessageMedia')
        self.assertEqual(self.client.get('/api/status').json['channels'][0]['message_id'], 5)

    def test_realistic_danbooru_search_and_image(self):
        from unittest.mock import Mock
        response = Mock()
        response.json.return_value = [{'id': 5, 'rating': 'g', 'large_file_url': 'https://cdn.donmai.us/sample/art.jpg'}]
        with patch.object(app.requests, 'get', return_value=response) as get, patch.object(app, 'download_image', return_value=(b'jpeg', 'image/jpeg')):
            result = app.get_art(None, 'asuna')
        self.assertEqual(result, ('Danbooru:5', b'jpeg', 'image/jpeg', 'https://danbooru.donmai.us/posts/5'))
        self.assertEqual(get.call_args.kwargs['params']['tags'], 'yuuki_asuna -kirigaya_kazuto rating:general')
        self.assertIn('арт №5 скачан', str(self.client.get('/api/status').json['events']))

    def test_empty_danbooru_falls_back_to_safebooru(self):
        from unittest.mock import Mock
        empty = Mock(); empty.json.return_value = []
        safe = Mock(); safe.json.return_value = [{'id': 8, 'rating': 'safe', 'sample_url': 'https://safebooru.org/samples/a.jpg'}]
        with patch.object(app.random, 'randint', return_value=1), patch.object(app.requests, 'get', side_effect=[empty, safe]), patch.object(app, 'download_image', return_value=(b'jpeg', 'image/jpeg')):
            result = app.get_art(None)
        self.assertEqual(result[0], 'Safebooru:8')
        self.assertIn('safebooru.org', result[3])
        messages = str(self.client.get('/api/status').json['events'])
        self.assertIn('Danbooru: арты не найдены', messages)
        self.assertIn('Safebooru: арт №8', messages)

    def test_two_sources_down_konachan_works(self):
        from unittest.mock import Mock
        import requests
        safe = Mock(); safe.json.return_value = [{'id': 12, 'rating': 's', 'sample_url': 'https://konachan.net/sample/a.jpg'}]
        with patch.object(app.requests, 'get', side_effect=[requests.Timeout(), requests.ConnectionError(), safe]), patch.object(app, 'download_image', return_value=(b'jpeg', 'image/jpeg')):
            result = app.get_art(None)
        self.assertEqual(result[0], 'Konachan:12')
        self.assertIn('konachan.net/post/show/12', result[3])

    def test_empty_random_page_retries_first_page(self):
        from unittest.mock import Mock
        empty = Mock(); empty.json.return_value = []
        found = Mock(); found.json.return_value = [{'id': 51, 'rating': 'g', 'file_url': 'https://cdn.donmai.us/a.jpg'}]
        with patch.object(app.random, 'randint', return_value=8), patch.object(app.requests, 'get', side_effect=[empty, found]) as get, patch.object(app, 'download_image', return_value=(b'jpeg', 'image/jpeg')):
            result = app.get_art(None)
        self.assertEqual(result[0], 'Danbooru:51')
        self.assertEqual(get.call_args_list[1].kwargs['params']['page'], 1)

    def test_redirect_to_other_host_is_rejected(self):
        from unittest.mock import Mock
        response = Mock(status_code=302, headers={'Location': 'https://evil.test/image.jpg'})
        with patch.object(app.requests, 'get', return_value=response) as get:
            with self.assertRaises(ValueError):
                app.download_image('https://cdn.donmai.us/a.jpg', app.SOURCES[0])
        self.assertEqual(get.call_count, 1)
        response.close.assert_called_once()

    def test_untrusted_image_hosts_are_rejected(self):
        source = app.SOURCES[0]
        self.assertIsNone(app.allowed_image_url('https://cdn.donmai.us.evil.test/a.jpg', source))
        self.assertIsNone(app.allowed_image_url('http://cdn.donmai.us/a.jpg', source))
        self.assertIsNone(app.allowed_image_url('https://cdn.donmai.us@evil.test/a.jpg', source))
        self.assertEqual(app.allowed_image_url('https://cdn.donmai.us/a.jpg', source), 'https://cdn.donmai.us/a.jpg')

    def test_logs_never_contain_token_and_are_bounded(self):
        app.put('token', '123:secret')
        for i in range(160): app.event('info', 'тест 123:secret')
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM events').fetchone()[0], 150)
        self.assertNotIn('123:secret', str(self.client.get('/api/status').json))

    def test_exact_caption_for_send_and_edit(self):
        import json
        app.put('token', '123:abc')
        app.put('channel', '-100123')
        app.put('running', '1')
        app.put('mode', 'kirito')
        with app.db() as c:
            c.execute('INSERT INTO channels (id,title) VALUES (?,?)', (-100123, 'Channel'))
        caption = 'Бесконечные арты САО каждые 10 секунд'
        with patch.object(app, 'get_art', return_value=('Danbooru:1', b'jpeg', 'image/jpeg', 'https://danbooru.donmai.us/posts/1')) as art, patch.object(app, 'telegram', side_effect=[{'message_id': 5}, True]) as tg:
            app.rotate_once()
            app.rotate_once()
        self.assertEqual(tg.call_args_list[0].args[2]['caption'], caption)
        self.assertEqual(json.loads(tg.call_args_list[1].args[2]['media'])['caption'], caption)
        self.assertEqual(art.call_args_list[0].args[1], 'kirito')
        self.assertNotIn('Источник', str(tg.call_args_list))

    def test_modes_use_different_tag_queries(self):
        from unittest.mock import Mock
        for mode in ('asuna', 'kirito', 'together'):
            response = Mock()
            response.json.return_value = [{'id': 5, 'rating': 'g', 'large_file_url': 'https://cdn.donmai.us/a.jpg'}]
            with self.subTest(mode=mode), patch.object(app.requests, 'get', return_value=response) as request, patch.object(app, 'download_image', return_value=(b'jpeg', 'image/jpeg')):
                app.get_art(None, mode)
                self.assertEqual(request.call_args.kwargs['params']['tags'], app.SOURCES[0]['tags'][mode])
        self.assertEqual(self.client.post('/api/mode', json={'mode': 'unknown'}).status_code, 400)

    def test_backup_requires_token_and_roundtrip_resumes_same_post(self):
        import json
        token = '123:abc'
        app.put('token', token)
        app.put('channel', '-100123')
        app.put('mode', 'together')
        app.put('running', '1')
        with app.db() as c:
            c.execute('INSERT INTO channels (id,title,message_id,last_art) VALUES (?,?,?,?)', (-100123, 'Channel', 77, 'Danbooru:3'))
        self.assertEqual(self.client.post('/api/export', json={}).status_code, 403)
        self.assertEqual(self.client.post('/api/export', json={'token': 'wrong'}).status_code, 403)
        response = self.client.post('/api/export', json={'token': token})
        self.assertEqual(response.status_code, 200)
        self.assertIn('no-store', response.headers['Cache-Control'])
        backup = json.loads(response.data)
        self.assertEqual(backup['token'], token)
        def telegram(t, method, data=None, **kwargs):
            if method == 'getMe': return {'id': 123, 'is_bot': True, 'username': 'bot'}
            if method == 'getChat': return {'id': -100123, 'type': 'channel', 'title': 'Channel'}
            if method == 'getChatMember': return {'status': 'administrator'}
            if method == 'deleteWebhook': return True
            raise AssertionError(method)
        with patch.object(app, 'telegram', side_effect=telegram):
            self.assertEqual(self.client.post('/api/import', json=backup).status_code, 200)
        status = self.client.get('/api/status').json
        self.assertFalse(status['running'])
        self.assertEqual(status['selected'], '-100123')
        self.assertEqual(status['channels'][0]['message_id'], 77)
        self.assertEqual(status['mode'], 'together')
        self.client.post('/api/toggle', json={'running': True})
        with patch.object(app, 'get_art', return_value=('Danbooru:4', b'jpeg', 'image/jpeg', 'https://danbooru.donmai.us/posts/4')), patch.object(app, 'telegram', return_value=True) as tg:
            app.rotate_once()
        self.assertEqual(tg.call_args.args[1], 'editMessageMedia')
        self.assertEqual(tg.call_args.args[2]['message_id'], 77)

    def test_bad_import_keeps_existing_data(self):
        app.put('token', '123:abc')
        app.put('channel', '-100123')
        with app.db() as c:
            c.execute('INSERT INTO channels (id,title,message_id) VALUES (?,?,?)', (-100123, 'Channel', 77))
        bad = {'format': 'asuna-studio-backup', 'version': 1, 'token': '999:abc', 'selected': '-100234', 'channels': [{'id': -100234, 'message_id': 88}], 'mode': 'mixed'}
        with patch.object(app, 'telegram', side_effect=RuntimeError('invalid token')):
            self.assertEqual(self.client.post('/api/import', json=bad).status_code, 400)
        status = self.client.get('/api/status').json
        self.assertEqual(status['selected'], '-100123')
        self.assertEqual(status['channels'][0]['message_id'], 77)
        self.assertEqual(app.get('token'), '123:abc')

    def test_parse_channel_references(self):
        cases = {
            'https://t.me/AsunaYukki/879': ('@AsunaYukki', 879),
            't.me/AsunaYukki/879?single': ('@AsunaYukki', 879),
            '@AsunaYukki': ('@AsunaYukki', None),
            'https://t.me/AsunaYukki': ('@AsunaYukki', None),
            '-1001234567890': (-1001234567890, None),
            'https://t.me/c/1234567890/879': (-1001234567890, 879),
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(app.parse_channel_reference(value), expected)
        for value in ('https://evil.example/AsunaYukki/879', 'https://t.me.evil.example/AsunaYukki/879', 'https://t.me/+invite', 'https://t.me/AsunaYukki/0', 'https://t.me/AsunaYukki/not_a_post', None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                app.parse_channel_reference(value)

    def test_add_public_post_link_uses_telegram_resolved_id(self):
        app.put('token', '123:abc')
        app.put('running', '1')
        def telegram(token, method, data=None, **kwargs):
            if method == 'getMe': return {'id': 123}
            if method == 'getChat':
                self.assertEqual(data['chat_id'], '@AsunaYukki')
                return {'id': -1001234567890, 'type': 'channel', 'title': 'SAO', 'username': 'AsunaYukki'}
            if method == 'getChatMember':
                self.assertEqual(data['chat_id'], -1001234567890)
                return {'status': 'administrator'}
            raise AssertionError(method)
        with patch.object(app, 'telegram', side_effect=telegram):
            response = self.client.post('/api/channel-reference', json={'reference': 'https://t.me/AsunaYukki/879'})
        self.assertEqual(response.status_code, 200)
        status = self.client.get('/api/status').json
        self.assertEqual(status['selected'], '-1001234567890')
        self.assertEqual(status['channels'][0]['message_id'], 879)
        self.assertFalse(status['running'])
        self.assertNotIn('123:abc', str(status))
        self.client.post('/api/toggle', json={'running': True})
        with patch.object(app, 'get_art', return_value=('Danbooru:4', b'jpeg', 'image/jpeg', 'https://danbooru.donmai.us/posts/4')), patch.object(app, 'telegram', return_value=True) as tg:
            app.rotate_once()
        self.assertEqual(tg.call_args.args[1], 'editMessageMedia')
        self.assertEqual(tg.call_args.args[2]['message_id'], 879)

    def test_channel_id_keeps_existing_post_and_failure_does_not_change_state(self):
        app.put('token', '123:abc')
        app.put('channel', '-1001234567890')
        app.put('running', '1')
        with app.db() as c:
            c.execute('INSERT INTO channels (id,title,message_id) VALUES (?,?,?)', (-1001234567890, 'Old', 77))
        def telegram(token, method, data=None, **kwargs):
            if method == 'getMe': return {'id': 123}
            if method == 'getChat': return {'id': -1001234567890, 'type': 'channel', 'title': 'New'}
            if method == 'getChatMember': return {'status': 'administrator'}
        with patch.object(app, 'telegram', side_effect=telegram):
            response = self.client.post('/api/channel-reference', json={'reference': '-1001234567890'})
        self.assertEqual(response.status_code, 200)
        status = self.client.get('/api/status').json
        self.assertEqual(status['channels'][0]['message_id'], 77)
        self.assertFalse(status['running'])
        def no_rights(token, method, data=None, **kwargs):
            if method == 'getMe': return {'id': 123}
            if method == 'getChat': return {'id': -1001234567890, 'type': 'channel', 'title': 'New'}
            if method == 'getChatMember': return {'status': 'member'}
        with patch.object(app, 'telegram', side_effect=no_rights):
            response = self.client.post('/api/channel-reference', json={'reference': 'https://t.me/AsunaYukki/879'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get('/api/status').json['channels'][0]['message_id'], 77)

    def test_reject_group_and_stale_reference(self):
        app.put('token', '123:abc')
        def group(token, method, data=None, **kwargs):
            if method == 'getMe': return {'id': 123}
            if method == 'getChat': return {'id': -100123, 'type': 'supergroup', 'title': 'Group'}
        with patch.object(app, 'telegram', side_effect=group):
            self.assertEqual(self.client.post('/api/channel-reference', json={'reference': '@AsunaYukki'}).status_code, 400)
        self.assertEqual(self.client.get('/api/status').json['channels'], [])
        def stale(token, method, data=None, **kwargs):
            if method == 'getMe': return {'id': 123}
            if method == 'getChat': return {'id': -100123, 'type': 'channel', 'title': 'Channel'}
            if method == 'getChatMember':
                self.client.post('/api/mode', json={'mode': 'kirito'})
                return {'status': 'administrator'}
        with patch.object(app, 'telegram', side_effect=stale):
            self.assertEqual(self.client.post('/api/channel-reference', json={'reference': '@AsunaYukki'}).status_code, 409)
        self.assertEqual(self.client.get('/api/status').json['channels'], [])

    def test_manually_restore_post_id_pauses_and_keeps_channel(self):
        app.put('token', '123:abc')
        app.put('channel', '-100123')
        app.put('running', '1')
        with app.db() as c:
            c.execute('INSERT INTO channels (id,title,message_id) VALUES (?,?,?)', (-100123, 'Channel', 77))
        self.assertEqual(self.client.post('/api/post-id', json={'message_id': -5}).status_code, 400)
        self.assertEqual(self.client.post('/api/post-id', json={'message_id': 85}).status_code, 200)
        status = self.client.get('/api/status').json
        self.assertFalse(status['running'])
        self.assertEqual(status['channels'][0]['message_id'], 85)

    def test_pause_invalidates_inflight_search(self):
        app.put('token', '123:abc')
        app.put('channel', '-100123')
        app.put('running', '1')
        with app.db() as c:
            c.execute('INSERT INTO channels (id,title,message_id) VALUES (?,?,?)', (-100123, 'Channel', 77))
        def search(*args):
            self.client.post('/api/toggle', json={'running': False})
            self.client.post('/api/toggle', json={'running': True})
            return ('Danbooru:4', b'jpeg', 'image/jpeg', 'https://danbooru.donmai.us/posts/4')
        with patch.object(app, 'get_art', side_effect=search), patch.object(app, 'telegram') as tg:
            app.rotate_once()
        tg.assert_not_called()

    def test_panel_requires_no_password_and_rejects_foreign_origin(self):
        self.assertEqual(self.client.get('/api/status').status_code, 200)
        self.assertEqual(self.client.post('/api/toggle', json={}, headers={'Origin': 'https://evil.example'}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
