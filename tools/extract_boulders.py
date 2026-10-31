#!/usr/bin/env python3
"""Pack the user's Rock Boulder 10 download (Rock_10.max + Stone_10_A/N/MSA.tga) for the web.

    python3 tools/extract_boulders.py ~/Downloads/Rock_Boulder_10

Needs olefile and Pillow. The pack came with no mesh a browser can read, only a 3ds Max scene (an OLE compound file), so the
mesh is read straight out of its `Scene` stream: one Editable Mesh of 403 vertices and 752 triangles holding thirteen
separate rocks laid out on a grid, with chunk 0x914 = vertices (u32 count, then x y z floats), 0x912 = faces (count, then
a b c flags smoothing as u32), 0x2394 = map vertices and 0x2396 = map faces. Each connected piece becomes one boulder:
Z-up centimetres turned into y-up metres, centred, base at y = 0, smooth normals by shared vertex, uvs per face corner.

Writes assets/rocks/boulders.bin (per rock: positions, normals, uvs as float32), boulders.json (vertex count, float offset and
size of each), boulder_albedo.jpg and boulder_normal.webp (the 4096 px targas at 2048 px). The albedo is an atlas of top-down
photographs with their edges smeared outward; the normal map is DirectX or OpenGL as the Max bake left it (checked on screen).
"""
import json, math, os, struct, sys
import olefile
from PIL import Image

src = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/Downloads/Rock_Boulder_10')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'rocks')
os.makedirs(out, exist_ok=True)

d = olefile.OleFileIO(os.path.join(src, 'Rock_10.max')).openstream('Scene').read()


def chunks(off, end, depth, acc):
    while off + 6 <= end:
        cid, = struct.unpack_from('<H', d, off)
        ln, = struct.unpack_from('<I', d, off + 2)
        hdr = 6
        if ln == 0:
            ln, = struct.unpack_from('<Q', d, off + 6)
            hdr, cont = 14, False
        else:
            cont, ln = bool(ln & 0x80000000), ln & 0x7fffffff
        if ln < hdr or off + ln > end:
            break
        acc.append((cid, off, ln))
        if cont:
            chunks(off + hdr, off + ln, depth + 1, acc)
        off += ln


acc = []
chunks(0, len(d), 0, acc)
body = {cid: d[off + 6:off + ln] for cid, off, ln in acc if cid in (0x914, 0x912, 0x2394, 0x2396)}
v = body[0x914]; n, = struct.unpack_from('<I', v, 0)
V = [struct.unpack_from('<3f', v, 4 + 12 * i) for i in range(n)]
f = body[0x912]; m, = struct.unpack_from('<I', f, 0)
F = [struct.unpack_from('<3I', f, 4 + 20 * i) for i in range(m)]
u = body[0x2394]; k, = struct.unpack_from('<I', u, 0)
U = [struct.unpack_from('<3f', u, 4 + 12 * i) for i in range(k)]
uf = body[0x2396]; m2, = struct.unpack_from('<I', uf, 0)
UF = [struct.unpack_from('<3I', uf, 4 + 12 * i) for i in range(m2)]

par = list(range(n))


def find(a):
    while par[a] != a:
        par[a] = par[par[a]]
        a = par[a]
    return a


for t in F:
    for i in (1, 2):
        par[find(t[i])] = find(t[0])
comps = {}
for ti, t in enumerate(F):
    comps.setdefault(find(t[0]), []).append(ti)

blob, meta = bytearray(), []
for _, tris in sorted(comps.items(), key=lambda c: -len(c[1])):
    vs = sorted({i for ti in tris for i in F[ti]})
    P = {i: (V[i][0] * 0.01, V[i][2] * 0.01, -V[i][1] * 0.01) for i in vs}
    cx = sum(p[0] for p in P.values()) / len(P); cz = sum(p[2] for p in P.values()) / len(P); y0 = min(p[1] for p in P.values())
    P = {i: (p[0] - cx, p[1] - y0, p[2] - cz) for i, p in P.items()}
    N = {i: [0.0, 0.0, 0.0] for i in vs}
    for ti in tris:
        a, b, c = (P[i] for i in F[ti])
        e1 = [b[j] - a[j] for j in range(3)]; e2 = [c[j] - a[j] for j in range(3)]
        nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
        for i in F[ti]:
            for j in range(3):
                N[i][j] += nn[j]
    pos, nor, uv = [], [], []
    for ti in tris:
        for c in range(3):
            i = F[ti][c]
            pos += P[i]
            l = math.sqrt(sum(x * x for x in N[i])) or 1
            nor += [x / l for x in N[i]]
            uv += list(U[UF[ti][c]][:2])
    o = len(blob) // 4
    for arr in (pos, nor, uv):
        blob += struct.pack('<%df' % len(arr), *arr)
    xs = [p[0] for p in P.values()]; ys = [p[1] for p in P.values()]; zs = [p[2] for p in P.values()]
    meta.append({'n': len(pos) // 3, 'o': o, 'w': round(max(xs) - min(xs), 3), 'h': round(max(ys), 3), 'd': round(max(zs) - min(zs), 3)})

open(os.path.join(out, 'boulders.bin'), 'wb').write(blob)
json.dump(meta, open(os.path.join(out, 'boulders.json'), 'w'))
Image.open(os.path.join(src, 'Stone_10_A.tga')).convert('RGB').resize((2048, 2048), Image.LANCZOS).save(os.path.join(out, 'boulder_albedo.jpg'), quality=88)
Image.open(os.path.join(src, 'Stone_10_N.tga')).convert('RGB').resize((2048, 2048), Image.LANCZOS).save(os.path.join(out, 'boulder_normal.webp'), quality=88)
print(len(meta), 'rocks,', len(blob), 'bytes')
