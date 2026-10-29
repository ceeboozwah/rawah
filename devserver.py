#!/usr/bin/env python3
"""Dev static server that tells the browser NEVER to cache.

Safari (and others) cache ES modules aggressively and will happily serve a
stale src/*.js after you edit it, producing "half-updated" bundles where one
module calls a method another (cached) module doesn't have yet. Sending
`Cache-Control: no-store` on every response forces a fresh fetch of every file
on each reload, so a normal Reload always runs the latest code.

Usage:  python3 devserver.py [port]   (default 5179)
"""
import json
import os
import sys
import urllib.error
import urllib.request
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))  # serve this project regardless of cwd


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass  # quiet

    def do_POST(self):
        """/crew/chat/completions: forward the crew's chat requests to an OpenAI-style server with a key that stays in this
        process's environment (NVIDIA_API_KEY, optional RAWAH_CREW_UPSTREAM). Local use only; with no key it answers 501."""
        if self.path == '/dev/placements':
            self.save_placements()
            return
        if not self.path.startswith('/crew/'):
            self.send_error(404)
            return
        key = os.environ.get('NVIDIA_API_KEY')
        if not key:
            self.send_error(501, 'set NVIDIA_API_KEY to use the crew proxy')
            return
        upstream = os.environ.get('RAWAH_CREW_UPSTREAM', 'https://integrate.api.nvidia.com/v1').rstrip('/')
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        req = urllib.request.Request(upstream + self.path[len('/crew'):], data=body, method='POST',
                                     headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data, status = r.read(), r.status
        except urllib.error.HTTPError as e:
            data, status = e.read(), e.code
        except Exception as e:
            data, status = str(e).encode(), 502
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _save_placements(self):
    """/dev/placements: write the world editor's ledger to data/placements.json (one placement per line, so git diffs read well).
    Only from this machine, and only a well-formed ledger."""
    if self.client_address[0] not in ('127.0.0.1', '::1'):
        self.send_error(403)
        return
    try:
        d = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)))
        assert isinstance(d.get('items'), list) and isinstance(d.get('removed', []), list)
        for it in d['items']:
            assert isinstance(it.get('asset'), str) and all(isinstance(it.get(k), (int, float)) for k in ('x', 'z', 'dy', 'yaw', 'pitch', 'roll', 's'))
    except Exception:
        self.send_error(400, 'not a placement ledger')
        return
    lines = ',\n'.join('  ' + json.dumps(it, separators=(',', ':')) for it in d['items'])
    text = '{"version":1,\n"items":[\n' + lines + '\n],\n"removed":' + json.dumps(d.get('removed', []), separators=(',', ':')) + '}\n'
    path = os.path.join(ROOT, 'data', 'placements.json')
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, path)
    self.send_response(200)
    self.send_header('Content-Type', 'application/json')
    self.send_header('Content-Length', '2')
    self.end_headers()
    self.wfile.write(b'ok')


NoCacheHandler.save_placements = _save_placements


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5179
    print(f'No-cache dev server on http://localhost:{port}  (serving {ROOT})')
    HTTPServer(('', port), partial(NoCacheHandler, directory=ROOT)).serve_forever()
