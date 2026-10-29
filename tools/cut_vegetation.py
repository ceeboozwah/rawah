#!/usr/bin/env python3
"""Cut the user's vegetation pack (Rawah_Realistic_Vegetation_Complete_Pack.zip) into single plants and pack them for the game.

usage: python3 tools/cut_vegetation.py <unzipped pack folder> [preview_dir]

Each sheet is an illustrated alpha atlas of plants with a coloured chroma-key fringe on the edges. The sheets with trunks and
limbs (the two krummholz sheets and the willow and alder sprays) are left out. For every plant kept this script
  1. finds it (connected blob of alpha, small gaps closed) and cleans the fringe (`clean`, as in cut_foliage.py),
  2. sorts it by what it is (grass or sedge, flowering forb, shrub) from its sheet and its colours,
  3. gives it a real size in metres: a table per sheet row, scaled so the plants vary within the range of the species,
  4. fits it, aspect preserved and bottom-aligned, into a cell of its group's atlas and records how much of the cell it fills
     so the game can size the card to the plant's true height and width.
Output (assets/vegetation/): grass.webp, forbs.webp, shrubs.webp and vegetation.json.
"""
import json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC = sys.argv[1]
PREVIEW = sys.argv[2] if len(sys.argv) > 2 else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'vegetation')
os.makedirs(OUT, exist_ok=True)


def load(path):
    return np.asarray(Image.open(os.path.join(SRC, path)).convert('RGBA')).astype(np.float32)


def garish(rgb):
    """The chroma-key leftovers: pure, bright red, green or yellow that no plant has (berries and petals are darker or paler)."""
    r, g, b = rgb[..., 0] / 255.0, rgb[..., 1] / 255.0, rgb[..., 2] / 255.0
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    d = np.maximum(mx - mn, 1e-4)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    red = ((hue < 14) | (hue > 346)) & (sat > 0.7) & (mx > 0.62)
    green = (hue > 85) & (hue < 150) & (sat > 0.75) & (mx > 0.72)
    yellow = (hue >= 45) & (hue <= 72) & (sat > 0.7) & (mx > 0.7)
    return red | green | yellow


def clean(im):
    """Soften the alpha edge and replace the key-colour fringe with the colour just inside it. Thin parts (stems, blades, seed-head
    stalks) that the erosion would eat are kept when their colour is natural."""
    rgb, a = im[..., :3], im[..., 3]
    m = a > 128
    core = ndi.binary_erosion(m, iterations=3)
    w = ndi.gaussian_filter(core.astype(np.float32), 3)
    fill = np.stack([ndi.gaussian_filter(rgb[..., c] * core, 3) for c in range(3)], -1) / np.maximum(w[..., None], 1e-4)
    far = ndi.gaussian_filter(core.astype(np.float32), 12) < 1e-3
    out = np.where((core | (w < 1e-3))[..., None], rgb, fill)
    out = np.where(far[..., None] | (w[..., None] < 1e-3), rgb, out)
    m2 = ndi.binary_erosion(m, iterations=2)
    a2 = ndi.gaussian_filter(m2.astype(np.float32), 1.0) * 255
    soft = (a > 40) & ~m
    # soft pixels count only where they are thin (stalks, blades, wisps), not where they form a translucent halo round a plant
    soft &= ~ndi.binary_dilation(ndi.binary_opening(soft, iterations=2), iterations=2)
    thin = (m & ~ndi.binary_dilation(m2, iterations=2)) | soft
    thin &= ~ndi.binary_dilation(garish(rgb) & (a > 30), iterations=1)
    keep = ndi.gaussian_filter(thin.astype(np.float32), 0.6) * np.minimum(a * 1.25, 255)
    thin_rgb = np.where(thin[..., None], rgb, out)
    a3 = np.maximum(a2, keep)
    out = np.where((a2 < keep)[..., None], thin_rgb, out)
    return np.dstack([out, a3, a2])          # r, g, b, alpha with the thin parts, alpha of the solid parts only


def blobs(im, minarea=3000, reach=18):
    """Plants as connected blobs of solid alpha. A flower head or leaf tuft that floats free joins the larger plant within 34 px;
    the faint wisps round a plant (seed heads, fine leaves) go to the nearest plant within `reach` pixels."""
    a = im[..., 4]
    core = a > 70
    lab, n = ndi.label(core)
    sizes = np.array([0.0] + list(ndi.sum(core, lab, range(1, n + 1))))
    boxes = ndi.find_objects(lab)
    for i in np.argsort(sizes)[:-1]:
        if i == 0 or sizes[i] == 0 or sizes[i] > 14000:
            continue
        sl = boxes[i - 1]
        y0, y1, x0, x1 = max(sl[0].start - 40, 0), sl[0].stop + 40, max(sl[1].start - 40, 0), sl[1].stop + 40
        win = lab[y0:y1, x0:x1]
        near = np.unique(win[ndi.binary_dilation(win == i, iterations=34)])
        near = [j for j in near if j not in (0, i) and sizes[j] > sizes[i] * 4]
        if near:
            j = max(near, key=lambda k: sizes[k])
            lab[lab == i] = j; sizes[j] += sizes[i]; sizes[i] = 0
    lab = np.where((sizes >= minarea)[lab], lab, 0)
    return finish(im, lab, minarea, reach)


def seeded(im, seeds, reach=18, minarea=3000):
    """Plants split by hand-placed seeds (x, y, rx, ry in sheet pixels) where plants touch: every opaque pixel goes to the seed
    it is nearest to in units of that seed's ellipse."""
    a = im[..., 4]
    yy, xx = np.nonzero(a > 6)
    cost = np.stack([np.hypot((xx - x) / rx, (yy - y) / ry) for x, y, rx, ry in seeds], 1)
    who = cost.argmin(1) + 1
    lab = np.zeros(a.shape, np.int32)
    lab[yy, xx] = who
    lab = np.where(a > 70, lab, 0)
    return finish(im, lab, minarea, reach)


def finish(im, lab, minarea, reach):
    """Hand every pixel that belongs to a plant (including stems and wisps that reach out to a flower head or seed head) to the
    nearest solid part of a plant it is connected to; anything not connected to a plant is dropped."""
    mm = im[..., 3] > 30
    comp, nc = ndi.label(mm, structure=np.ones((3, 3)))
    d2, (iy, ix) = ndi.distance_transform_edt(lab == 0, return_indices=True)
    near = lab[iy, ix]
    ok = mm & ((d2 <= reach) | (comp == comp[iy, ix]))
    owner = np.where(ok & (d2 <= 170), near, 0)
    owner = np.where(lab > 0, lab, owner)
    out = []
    for i, sl in enumerate(ndi.find_objects(owner)):
        if sl is None:
            continue
        own = owner[sl] == i + 1
        if (lab[sl] == i + 1).sum() < minarea:
            continue
        sub = im[sl][..., :4].copy()
        sub[..., 3] *= own
        out.append((sl, sub))
    return out


def despeckle(sub, minarea=700):
    """Drop the little detached specks (stray seeds, key-colour flecks) so they do not stretch the plant's box."""
    lab, n = ndi.label(sub[..., 3] > 40, structure=np.ones((3, 3)))
    if n:
        sizes = ndi.sum(np.ones(lab.shape), lab, range(1, n + 1))
        bad = np.concatenate([[False], sizes < minarea])
        sub = sub.copy()
        sub[..., 3] = np.where(bad[lab], 0, sub[..., 3])
    return sub


def crop(sub, pad=2):
    sub = despeckle(sub)
    ys, xs = np.where(sub[..., 3] > 10)
    return sub[max(ys.min() - pad, 0):ys.max() + pad + 1, max(xs.min() - pad, 0):xs.max() + pad + 1]


def flower_fraction(sub):
    """Share of the opaque pixels that are petals or fluff: white, or pink / purple / blue, or bright clean yellow. Greens, the
    olive and ochre of dry grass and the russet of seed heads do not count."""
    rgb = sub[..., :3] / 255.0
    op = sub[..., 3] > 128
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    d = np.maximum(mx - mn, 1e-4)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    white = (mx > 0.84) & (sat < 0.3)
    cool = (sat > 0.3) & (mx > 0.35) & (((hue >= 190) & (hue <= 345)) | ((hue >= 345) | (hue <= 8)) & (sat > 0.55))
    yellow = (hue >= 42) & (hue <= 66) & (sat > 0.75) & (mx > 0.82)
    return float((op & (white | cool | yellow)).sum() / max(op.sum(), 1))


# rows of each sheet in reading order, found from the blob centres
def rows_of(blob_list, tol=90):
    items = sorted(blob_list, key=lambda t: (t[0][0].start + t[0][0].stop) / 2)
    rows, cur, last = [], [], None
    for it in items:
        cy = (it[0][0].start + it[0][0].stop) / 2
        if last is not None and cy - last > tol:
            rows.append(cur); cur = []
        cur.append(it); last = cy if not cur[:-1] else last
    if cur:
        rows.append(cur)
    for r in rows:
        r.sort(key=lambda t: (t[0][1].start + t[0][1].stop) / 2)
    return rows


def load_sheet(path, keep=None, seeds=None):
    im = clean(load(path))
    if keep:                       # horizontal bands of the sheet to use (y0, y1)
        m = np.zeros(im.shape[:2], bool)
        for y0, y1 in keep:
            m[y0:y1] = True
        im[..., 3] *= m
        im[..., 4] *= m
    return seeded(im, seeds) if seeds else blobs(im)


# ---------------------------------------------------------------- the sheets: what is on each and how tall it really is (metres)
def grid(ys, xs, rx, ry):
    return [(x, y, rx, r) for y, r in ys for x in xs[y]] if False else None


def seeds_of(rows, rx):
    return [(x, y, rx, ry) for y, ry, xs in rows for x in xs]


ALPINE_FORBS_SEEDS = seeds_of([
    (215, 190, [160, 420, 660, 900, 1120]), (570, 150, [140, 380, 640, 890, 1130]), (800, 100, [95, 330, 620, 880, 1130]),
    (985, 90, [120, 370, 630, 880, 1130]), (1165, 85, [110, 300, 520, 720, 950, 1160])], 115)
FORB_VAR_SEEDS = seeds_of([
    (170, 160, [160, 410, 680, 920, 1130]), (440, 110, [150, 390, 630, 880, 1130]), (690, 130, [115, 300, 520, 750, 960, 1130]),
    (920, 100, [160, 430, 650, 880, 1130]), (1130, 90, [140, 370, 640, 870, 1120])], 115)

SHEETS = [
    # path, kind, keep bands, seeds, bands (centre y limit, heights left to right) or a flat list for seeded sheets
    dict(path='researched_rawah_inspired/willow_and_alder_riparian.png', kind='shrub', keep=[(255, 640), (870, 1254)],
         bands=[(760, [2.2, 2.6, 2.4, 2.0]), (9999, [1.8, 2.4, 2.2, 2.0])]),
    dict(path='additional_variations/willow_foliage_variations.png', kind='shrub', keep=[(620, 1254)],
         bands=[(880, [1.8, 2.2, 2.5, 2.0]), (9999, [2.3, 2.8, 2.6])]),
    dict(path='researched_rawah_inspired/kinnikinnick_bilberry_dwarf_shrubs.png', kind='shrub',
         bands=[(200, [0.14, 0.2, 0.16, 0.12]), (380, [0.32, 0.3, 0.28, 0.26, 0.2]), (620, [0.55, 0.5, 0.4, 0.32]),
                (830, [0.5, 0.5, 0.4, 0.28]), (1050, [0.6, 0.55, 0.45, 0.32]), (9999, [0.18, 0.2, 0.16, 0.14])]),
    dict(path='additional_variations/subalpine_understory_shrubs.png', kind='shrub',
         bands=[(360, [1.4, 1.6, 1.7]), (600, [1.2, 1.0, 1.2, 1.4]), (810, [1.3, 0.8, 1.2, 0.7]), (1030, [1.1, 1.3, 0.7, 1.2, 1.3]), (9999, [1.1, 1.1, 1.1, 0.6])]),
    dict(path='researched_rawah_inspired/alpine_sedges_rushes_grasses.png', kind='grass', scale=1.0),
    dict(path='additional_variations/wet_meadow_grasses_variations.png', kind='grass', scale=1.2),
    dict(path='researched_rawah_inspired/alpine_wildflowers_forbs.png', kind='forb', seeds=ALPINE_FORBS_SEEDS,
         heights=[0.55, 0.4, 0.45, 0.45, 0.5, 0.25, 0.3, 0.4, 0.3, 0.5, 0.1, 0.08, 0.12, 0.2, 0.15, 0.2, 0.1, 0.12, 0.2, 0.2, 0.15, 0.08, 0.1, 0.12, 0.18, 0.2]),
    dict(path='additional_variations/wildflower_variations.png', kind='forb', seeds=FORB_VAR_SEEDS,
         heights=[0.55, 0.45, 0.3, 0.4, 0.45, 0.15, 0.2, 0.3, 0.45, 0.5, 0.5, 0.5, 0.12, 0.4, 0.4, 0.4, 0.15, 0.25, 0.3, 0.2, 0.4, 0.1, 0.1, 0.25, 0.3, 0.1]),
]
GROUPS = {'grass': dict(cell=(256, 320), cols=8), 'forb': dict(cell=(224, 280), cols=9), 'shrub': dict(cell=(288, 240), cols=8)}


def centre(sl):
    return (sl[1].start + sl[1].stop) / 2, (sl[0].start + sl[0].stop) / 2


def by_bands(plants, bands):
    out = []
    lo = -1
    for ymax, hs in bands:
        row = sorted([p for p in plants if lo <= centre(p[0])[1] < ymax], key=lambda p: centre(p[0])[0])
        for i, p in enumerate(row):
            out.append((p, hs[i] if i < len(hs) else float(np.mean(hs))))
        if len(row) != len(hs):
            print('  band to', ymax, ': found', len(row), 'plants, table has', len(hs))
        lo = ymax
    return out


def sort_seeded(plants, seeds):
    """Order the plants like the seeds that made them (top to bottom, left to right)."""
    order = []
    for x, y, _, _ in seeds:
        d = [math.hypot(centre(p[0])[0] - x, centre(p[0])[1] - y) for p in plants]
        order.append(int(np.argmin(d)))
    return [plants[i] for i in order]


records = {g: [] for g in GROUPS}
for sh in SHEETS:
    name = os.path.basename(sh['path'])[:-4]
    plants = load_sheet(sh['path'], keep=sh.get('keep'), seeds=sh.get('seeds'))
    print(name, len(plants), 'plants')
    if sh['kind'] == 'shrub':
        for (sl, sub), h in by_bands(plants, sh['bands']):
            records['shrub'].append(dict(sub=crop(sub), h=h, sheet=name))
    elif sh['kind'] == 'forb':
        plants = sort_seeded(plants, sh['seeds'])
        for i, (sl, sub) in enumerate(plants):
            records['forb'].append(dict(sub=crop(sub), h=sh['heights'][i] if i < len(sh['heights']) else 0.3, sheet=name))
    else:
        rows = rows_of(plants)
        k = 0
        for (sl, sub) in [p for r in rows for p in r]:
            sub = crop(sub)
            ff = flower_fraction(sub)
            asp = sub.shape[0] / sub.shape[1]
            jit = 0.9 + 0.2 * ((k * 0.618) % 1)
            k += 1
            if ff > 0.03:                                    # a flowering plant that landed on a grass sheet
                records['forb'].append(dict(sub=sub, h=0.35 * jit if asp < 1.2 else 0.5 * jit, sheet=name))
            else:
                h = (0.8 if asp > 1.15 else 0.55 if asp > 0.85 else 0.35 if asp > 0.55 else 0.22) * sh['scale'] * jit
                records['grass'].append(dict(sub=sub, h=h, sheet=name))


def fit(sub, cw, ch, margin=3):
    """Aspect preserved, bottom-aligned in a cell coloured like the plant (so mipmaps never fade to a key colour)."""
    h, w = sub.shape[:2]
    k = min((cw - 2 * margin) / w, (ch - 2 * margin) / h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    rgb = np.asarray(Image.fromarray(np.clip(sub[..., :3], 0, 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS)).astype(np.float32)
    a = np.asarray(Image.fromarray(np.clip(sub[..., 3], 0, 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS)).astype(np.float32)
    op = a > 128
    mean = rgb[op].mean(0) if op.any() else np.array([60, 80, 40.0])
    cell = np.zeros((ch, cw, 4), np.float32)
    cell[..., :3] = mean
    x0, y0 = (cw - nw) // 2, ch - margin - nh
    cell[y0:y0 + nh, x0:x0 + nw, :3] = np.where(a[..., None] > 4, rgb, mean)
    cell[y0:y0 + nh, x0:x0 + nw, 3] = a
    return cell, nw, nh, k


def single(sub):
    """One plant: the biggest solid piece holds nearly all the solid pixels (not several plants left in one box)."""
    lab, n = ndi.label(ndi.binary_dilation(sub[..., 3] > 60, iterations=6), structure=np.ones((3, 3)))
    if n < 2:
        return True
    sizes = ndi.sum(sub[..., 3] > 60, lab, range(1, n + 1))
    return sizes.max() / sizes.sum() > 0.8


def category(g, r):
    h = r['h']
    if g == 'grass':
        return 'wet' if 'wet_meadow' in r['sheet'] else 'low' if h < 0.56 else 'mid' if h < 0.8 else 'tall'
    if g == 'forb':
        return 'low' if h < 0.22 else 'mid' if h < 0.42 else 'tall'
    return 'dwarf' if h < 0.7 else 'under' if h < 1.75 else 'willow'


CATS = {'grass': ['low', 'mid', 'tall', 'wet'], 'forb': ['low', 'mid', 'tall'], 'shrub': ['dwarf', 'under', 'willow']}
meta = {}
for g, spec in GROUPS.items():
    cw, ch = spec['cell']
    kept = [r for r in records[g] if single(despeckle(r['sub']))]
    print(g, 'kept', len(kept), 'of', len(records[g]), 'as single plants')
    for r in kept:
        r['cat'] = category(g, r)
    recs = [r for c in CATS[g] for r in kept if r['cat'] == c]
    cats = {}
    for c in CATS[g]:
        idx = [i for i, r in enumerate(recs) if r['cat'] == c]
        cats[c] = [idx[0], len(idx)] if idx else [0, 0]
    cols = spec['cols']
    rows_n = math.ceil(len(recs) / cols)
    atlas = np.zeros((rows_n * ch, cols * cw, 4), np.float32)
    atlas[..., :3] = (60, 80, 40)
    plants_out = []
    for i, r in enumerate(recs):
        cell, nw, nh, k = fit(r['sub'], cw, ch)
        cx, cy = i % cols, i // cols
        atlas[cy * ch:(cy + 1) * ch, cx * cw:(cx + 1) * cw] = cell
        mpp = r['h'] / nh                                   # metres per atlas pixel: the plant is r['h'] tall
        plants_out.append(dict(x=cx, y=cy, h=round(r['h'], 3), w=round(nw * mpp, 3), cardH=round(ch * mpp, 3), cardW=round(cw * mpp, 3),
                               fill=round(nh / ch, 3), bloom=bool(flower_fraction(r['sub']) > 0.03), sheet=r['sheet']))
    rgba = np.clip(atlas, 0, 255).astype(np.uint8)
    names = {'grass': 'grass', 'forb': 'forbs', 'shrub': 'shrubs'}[g]
    Image.fromarray(rgba).save(os.path.join(OUT, names + '.webp'), quality=88, method=6)
    meta[names] = dict(cell=[cw, ch], cols=cols, rows=rows_n, cats=cats, plants=plants_out)
    print(g, len(recs), 'plants ->', names + '.webp', rgba.shape[1], 'x', rgba.shape[0])
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        bg = Image.new('RGBA', (rgba.shape[1], rgba.shape[0]), (70, 70, 90, 255))
        bg.alpha_composite(Image.fromarray(rgba))
        from PIL import ImageDraw
        d = ImageDraw.Draw(bg)
        for i, p in enumerate(plants_out):
            d.text((p['x'] * cw + 4, p['y'] * ch + 4), f"{i} {p['h']}m", fill=(255, 255, 0, 255))
        bg.convert('RGB').save(os.path.join(PREVIEW, names + '_preview.jpg'), quality=85)

with open(os.path.join(OUT, 'vegetation.json'), 'w') as f:
    json.dump(meta, f, separators=(',', ':'))
print('done')
