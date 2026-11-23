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
            result = app.get_art(None)
        self.assertEqual(result, ('Danbooru:5', b'jpeg', 'image/jpeg', 'https://danbooru.donmai.us/posts/5'))
        self.assertEqual(get.call_args.kwargs['params']['tags'], 'yuuki_asuna rating:general')
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

    def test_panel_requires_no_password_and_rejects_foreign_origin(self):
        self.assertEqual(self.client.get('/api/status').status_code, 200)
        self.assertEqual(self.client.post('/api/toggle', json={}, headers={'Origin': 'https://evil.example'}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
