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
        with patch.object(app, 'get_art', side_effect=[(1, b'jpeg', 'image/jpeg'), (2, b'jpeg', 'image/jpeg')]), patch.object(app, 'telegram', side_effect=[{'message_id': 5}, True]) as tg:
            app.rotate_once()
            app.rotate_once()
        self.assertEqual([call.args[1] for call in tg.call_args_list], ['sendPhoto', 'editMessageMedia'])
        self.assertEqual(tg.call_args_list[1].args[2]['message_id'], 5)
        self.assertEqual(self.client.get('/api/status').json['channels'][0]['last_art'], 2)

    def test_edit_failure_never_sends_new_post(self):
        app.put('token', '123:abc')
        app.put('channel', '-100123')
        app.put('running', '1')
        with app.db() as c:
            c.execute('INSERT INTO channels (id,title,message_id) VALUES (?,?,?)', (-100123, 'Channel', 5))
        with patch.object(app, 'get_art', return_value=(3, b'jpeg', 'image/jpeg')), patch.object(app, 'telegram', side_effect=RuntimeError('message not found')) as tg:
            with self.assertRaises(RuntimeError): app.rotate_once()
        self.assertEqual(tg.call_args.args[1], 'editMessageMedia')
        self.assertEqual(self.client.get('/api/status').json['channels'][0]['message_id'], 5)

    def test_panel_requires_no_password_and_rejects_foreign_origin(self):
        self.assertEqual(self.client.get('/api/status').status_code, 200)
        self.assertEqual(self.client.post('/api/toggle', json={}, headers={'Origin': 'https://evil.example'}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
