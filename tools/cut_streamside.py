#!/usr/bin/env python3
"""Cut the user's streamside pack (Rawah_Streamside_Vegetation_Textures.zip) into plants for the banks of streams and rivers.

usage: python3 tools/cut_streamside.py <unzipped pack folder> [preview_dir]

Four sheets: 01 streambank willows (twelve compact bushes; the branch sprays along the bottom are limbs and are left out),
02 sedge, rush and tufted-grass clumps, 03 meadow wildflowers (only the yellow and white ones are kept: the flowers of a wet
meadow in the reference photo), 04 subalpine shrubs (not riparian; not used). The cutting helpers are those of
tools/cut_vegetation.py (fringe cleaning, plant finding, fitting into cells). Output (assets/vegetation/): bank.webp (cells of
256 x 256, 8 per row) and bank.json: `cats` = sedge, willow, flower (first plant, count), `plants[i]` = { x, y (cell),
h, w (metres), cardH, cardW (metres the whole cell covers), bloom }.
"""
import sys
import ast, os
_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cut_vegetation.py')
_tree = ast.parse(open(_path).read())
_keep = [n for n in _tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef))
         or (isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') in ('SRC', 'PREVIEW', 'OUT'))
         or (isinstance(n, ast.Expr) and 'makedirs' in ast.dump(n))]
exec(compile(ast.Module(body=_keep, type_ignores=[]), 'cut_vegetation_helpers', 'exec'))

def seeds_of(rows, rx):
    return [(x, y, rx, ry) for y, ry, xs in rows for x in xs]
FORB_VAR_SEEDS = seeds_of([
    (170, 160, [160, 410, 680, 920, 1130]), (440, 110, [150, 390, 630, 880, 1130]), (690, 130, [115, 300, 520, 750, 960, 1130]),
    (920, 100, [160, 430, 650, 880, 1130]), (1130, 90, [140, 370, 640, 870, 1120])], 115)
FORB_VAR_H = [0.55, 0.45, 0.3, 0.4, 0.45, 0.15, 0.2, 0.3, 0.45, 0.5, 0.5, 0.5, 0.12, 0.4, 0.4, 0.4, 0.15, 0.25, 0.3, 0.2, 0.4, 0.1, 0.1, 0.25, 0.3, 0.1]


def petal_colours(sub):
    """Shares of the petal pixels that are yellow, white and anything else."""
    rgb = sub[..., :3] / 255.0
    op = sub[..., 3] > 128
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    d = np.maximum(mx - mn, 1e-4)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    white = op & (mx > 0.84) & (sat < 0.3)
    yellow = op & (hue >= 42) & (hue <= 66) & (sat > 0.75) & (mx > 0.82)
    cool = op & (sat > 0.3) & (mx > 0.35) & (((hue >= 190) & (hue <= 345)) | (((hue >= 345) | (hue <= 8)) & (sat > 0.55)))
    n = max(int((white | yellow | cool).sum()), 1)
    return white.sum() / n, yellow.sum() / n, cool.sum() / n


plants = {'sedge': [], 'willow': [], 'flower': []}

# 01: the willows
sheet = load_sheet('01_streambank_willow_shrub_variations.png', keep=[(0, 1010)])
rows = [(310, [1.4, 1.8, 1.6]), (560, [1.2, 1.6, 1.3]), (790, [1.4, 1.0, 1.5]), (9999, [1.5, 1.3, 1.8])]
print('willows found', len(sheet))
for n, ((sl, sub), h) in enumerate(by_bands(sheet, rows)):
    sub = crop(sub)
    asp = sub.shape[0] / sub.shape[1]
    wt = 1.7 + 0.6 * ((n * 0.618) % 1)          # a streamside willow clump is about two metres across
    plants['willow'].append(dict(sub=sub, h=min(1.9, max(0.8, wt * asp))))

# 02: sedges and rushes (a flowering forb on this sheet goes with the flowers when it is white or yellow)
k = 0
for sl, sub in [p for r in rows_of(load_sheet('02_streamside_sedge_rush_grass_clumps.png')) for p in r]:
    sub = crop(sub)
    jit = 0.9 + 0.2 * ((k * 0.618) % 1); k += 1
    asp = sub.shape[0] / sub.shape[1]
    ff = flower_fraction(sub)
    if ff > 0.03:
        w, y, c = petal_colours(sub)
        if w + y > 0.6:
            plants['flower'].append(dict(sub=sub, h=(0.4 if asp < 1.2 else 0.5) * jit))
        continue
    plants['sedge'].append(dict(sub=sub, h=(0.8 if asp > 1.15 else 0.6 if asp > 0.85 else 0.4) * 1.15 * jit))

# 03: the yellow and white wildflowers
fl = sort_seeded(load_sheet('03_alpine_meadow_yellow_white_wildflowers.png', seeds=FORB_VAR_SEEDS), FORB_VAR_SEEDS)
for i, (sl, sub) in enumerate(fl):
    sub = crop(sub)
    w, y, c = petal_colours(sub)
    if flower_fraction(sub) > 0.02 and (w + y) > 0.6 and c < 0.25:
        plants['flower'].append(dict(sub=sub, h=FORB_VAR_H[i] if i < len(FORB_VAR_H) else 0.3))

CELL, COLS = 256, 8
recs = []
cats = {}
for c in ['sedge', 'willow', 'flower']:
    kept = [p for p in plants[c] if single(despeckle(p['sub']))] if 'single' in globals() else plants[c]
    cats[c] = [len(recs), len(kept)]
    recs += [dict(p, cat=c) for p in kept]
print({c: n for c, (s, n) in cats.items()}, 'plants')
rows_n = math.ceil(len(recs) / COLS)
atlas = np.zeros((rows_n * CELL, COLS * CELL, 4), np.float32)
atlas[..., :3] = (60, 80, 40)
out = []
for i, r in enumerate(recs):
    cell, nw, nh, kk = fit(r['sub'], CELL, CELL)
    cx, cy = i % COLS, i // COLS
    atlas[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL] = cell
    mpp = r['h'] / nh
    out.append(dict(x=cx, y=cy, h=round(r['h'], 3), w=round(nw * mpp, 3), cardH=round(CELL * mpp, 3), cardW=round(CELL * mpp, 3),
                    fill=round(nh / CELL, 3), bloom=r['cat'] == 'flower'))
rgba = np.clip(atlas, 0, 255).astype(np.uint8)
Image.fromarray(rgba).save(os.path.join(OUT, 'bank.webp'), quality=88, method=6)
with open(os.path.join(OUT, 'bank.json'), 'w') as f:
    json.dump(dict(cell=[CELL, CELL], cols=COLS, rows=rows_n, cats=cats, plants=out), f, separators=(',', ':'))
print('bank.webp', rgba.shape[1], 'x', rgba.shape[0])
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    from PIL import ImageDraw
    bg = Image.new('RGBA', (rgba.shape[1], rgba.shape[0]), (70, 70, 90, 255)); bg.alpha_composite(Image.fromarray(rgba)); d = ImageDraw.Draw(bg)
    for i, p in enumerate(out):
        d.text((p['x'] * CELL + 4, p['y'] * CELL + 4), f"{i} {p['h']}m", fill=(255, 255, 0, 255))
    bg.convert('RGB').save(os.path.join(PREVIEW, 'bank_preview.jpg'), quality=85)
