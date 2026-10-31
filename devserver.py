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
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

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
        if self.path == '/dev/anim':
            self.save_anim()
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
        for c in d.get('sculpt', []):
            assert isinstance(c[0], int) and isinstance(c[1], int) and isinstance(c[2], str)
        for it in d['items']:
            assert isinstance(it.get('asset'), str) and all(isinstance(it.get(k), (int, float)) for k in ('x', 'z', 'dy', 'yaw', 'pitch', 'roll', 's'))
    except Exception:
        self.send_error(400, 'not a placement ledger')
        return
    lines = ',\n'.join('  ' + json.dumps(it, separators=(',', ':')) for it in d['items'])
    text = '{"version":1,\n"items":[\n' + lines + '\n],\n"removed":' + json.dumps(d.get('removed', []), separators=(',', ':')) + ',\n"sculpt":[\n' + ',\n'.join('  ' + json.dumps(c, separators=(',', ':')) for c in d.get('sculpt', [])) + '\n]}\n'
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


def _save_anim(self):
    """/dev/anim: write a hand-made animation from the pose editor to data/anims/<name>.json and keep data/anims/index.json (the
    list the editor offers) in step. Only from this machine, and only a well-formed animation."""
    import re
    if self.client_address[0] not in ('127.0.0.1', '::1'):
        self.send_error(403)
        return
    try:
        d = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)))
        name = d.get('name', '')
        assert re.fullmatch(r'[A-Za-z0-9_-]{1,40}', name)
        assert 0 < d.get('duration', 0) <= 60
        num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
        tracks = d.get('tracks')
        if tracks is not None:   # version 2: one list of keys per bone, plus 'hips'
            assert isinstance(tracks, dict) and 0 < len(tracks) <= 200
            for tn, lst in tracks.items():
                assert re.fullmatch(r'[A-Za-z0-9_:.-]{1,60}', tn) and isinstance(lst, list) and 0 < len(lst) <= 2000
                for k in lst:
                    assert num(k.get('t'))
                    if tn == 'hips':
                        assert num(k.get('v'))
                    else:
                        assert isinstance(k.get('q'), list) and len(k['q']) == 4 and all(num(v) for v in k['q'])
                    e = k.get('e')
                    assert e is None or e == 'hold' or (isinstance(e, list) and len(e) == 4 and all(num(v) for v in e))
        else:   # version 1: whole-pose keys
            assert isinstance(d.get('keys'), list)
            for k in d['keys']:
                assert isinstance(k.get('t'), (int, float)) and isinstance(k.get('rot', {}), dict)
                for q in k.get('rot', {}).values():
                    assert isinstance(q, list) and len(q) == 4 and all(isinstance(v, (int, float)) for v in q)
    except Exception:
        self.send_error(400, 'not an animation')
        return
    folder = os.path.join(ROOT, 'data', 'anims')
    os.makedirs(folder, exist_ok=True)
    head = {'version': 2 if tracks is not None else 1, 'name': name, 'duration': d['duration'], 'loop': bool(d.get('loop', True)), 'smooth': bool(d.get('smooth', True))}
    if tracks is not None:
        head['flow'] = bool(d.get('flow', False))
    head = json.dumps(head, separators=(',', ':'))
    held = d.get('held')
    if held is not None:
        ok = isinstance(held, dict) and isinstance(held.get('p'), list) and len(held['p']) == 3 and isinstance(held.get('q'), list) and len(held['q']) == 4
        if not ok or not all(isinstance(v, (int, float)) for v in held['p'] + held['q']):
            self.send_error(400, 'bad grip')
            return
        head = head[:-1] + ',"held":' + json.dumps({'p': held['p'], 'q': held['q']}, separators=(',', ':')) + '}'
    if tracks is not None:   # one track per line, so a diff reads well
        body = ',\n'.join('  ' + json.dumps(tn) + ':' + json.dumps(lst, separators=(',', ':')) for tn, lst in tracks.items())
        text = head[:-1] + ',\n"tracks":{\n' + body + '\n}}\n'
    else:
        keys = ',\n'.join('  ' + json.dumps(k, separators=(',', ':')) for k in d['keys'])
        text = head[:-1] + ',\n"keys":[\n' + keys + '\n]}\n'
    path = os.path.join(folder, name + '.json')
    # every save also lands in tools/.cache/anim-backups with a timestamp, so a deleted or overwritten animation can be got back
    import time
    keep = os.path.join(ROOT, 'tools', '.cache', 'anim-backups')
    os.makedirs(keep, exist_ok=True)
    with open(os.path.join(keep, '%s-%s.json' % (name, time.strftime('%Y%m%d-%H%M%S'))), 'w') as f:
        f.write(text)
    with open(path + '.tmp', 'w') as f:
        f.write(text)
    os.replace(path + '.tmp', path)
    names = sorted(n[:-5] for n in os.listdir(folder) if n.endswith('.json') and n != 'index.json')
    with open(os.path.join(folder, 'index.json'), 'w') as f:
        f.write(json.dumps(names))
    self.send_response(200)
    self.send_header('Content-Type', 'application/json')
    self.send_header('Content-Length', '2')
    self.end_headers()
    self.wfile.write(b'ok')


NoCacheHandler.save_anim = _save_anim


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5179
    print(f'No-cache dev server on http://localhost:{port}  (serving {ROOT})')
    ThreadingHTTPServer(('', port), partial(NoCacheHandler, directory=ROOT)).serve_forever()
