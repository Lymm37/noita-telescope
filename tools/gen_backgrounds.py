#!/usr/bin/env python3
"""Ship the game's background art + the scene->background mapping.

The engine's background layer (docs/worldgen/background_rendering.md in the RE
repo) has three sprite sources, all drawn behind the cell grid:

  1. biome backdrop tiles: `background_image` repeat-tiled in ABSOLUTE world
     coordinates, one sprite per 512px chunk, biome resolved at the chunk
     center; hand-drawn 64px edge strips where neighbouring chunks' images
     differ (winner = higher background_edge_priority, ties by string compare).
  2. pixel-scene backgrounds: `background_filename` blitted 1:1 at the scene's
     top-left when the scene paints (z = background_z_index, default 50).
  3. global <BackgroundImages> sprites from biome/_pixel_scenes.xml (z = 30).

data/biome_backgrounds.json (scripts/generate_biome_backgrounds.mjs) already
carries the per-biome mapping for (1); this script ships the actual art it
references plus everything (2) and (3) need:

  data/weather_gfx/<name>.png            backdrop images, copied verbatim
  data/weather_gfx/edges/<name>.png      full-color edge strips (the repo used
                                         to keep only alpha-dedup masks)
  data/backgrounds/**                    scene + global background PNGs
  data/background_data.json              image sizes, scene-key -> background
                                         path, global image list

Scene backgrounds are keyed here by the material PNG's basename without
extension ("receptacle_oil", "altar"). Sources scanned:
  * background_file="..." entries in data/scripts/biomes/**.lua scene tables
  * LoadPixelScene( "mat.png", ..., "bg.png" ) literal calls anywhere in lua
  * PixelScene background_filename= attributes in data/biome/_pixel_scenes*.xml

SUPERSEDED for (2): nothing reads the sceneBackgrounds field any more. A bare
basename is ambiguous across biomes -- "altar" is both data/biome_impl/altar.png
and data/biome_impl/temple/altar.png, and only the latter has a background -- so
the renderer reads js/pixel_scene_backgrounds.js instead, which
tools/gen_scene_backgrounds.mjs keys the way telescope keys scenes (dir/name)
and which also picks up the material_file/background_file scene tables the
regex above never matched. (1) and (3) are unchanged and still live here.

Usage: python3 tools/gen_backgrounds.py [path-to-data.wak.unpacked]
"""

import json
import os
import re
import shutil
import struct
import sys
import zlib

DEFAULT_SRC = os.path.expanduser(
    '~/reverse/noita/noita_Jan_25_2025_15:55:41/data/data.wak.unpacked')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(33)
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        raise ValueError(f'not a PNG: {path}')
    w, h = struct.unpack('>II', head[16:24])
    return w, h


def copy_art(src_root, rel, dest_rel=None):
    """Copy one game PNG into the repo, returning (repo-relative path, (w, h))."""
    src = os.path.join(src_root, rel.removeprefix('data/'))
    dest_rel = dest_rel or rel
    dest = os.path.join(REPO, dest_rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copyfile(src, dest)
    return dest_rel, png_size(src)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.isdir(src):
        sys.exit(f'game data not found: {src}')

    bb = json.load(open(os.path.join(REPO, 'data/biome_backgrounds.json')))

    images = {}          # repo-relative path -> {size}
    def ship(game_path, dest_rel=None):
        if not game_path:
            return None
        rel, size = copy_art(src, game_path, dest_rel)
        images[rel] = {'size': list(size)}
        return rel

    # --- 1. biome backdrops + full-color edge strips -------------------------
    for path in bb['images']:
        ship(path)
    for rec in bb.get('limitArt', {}).values():
        for rel in rec.values():
            ship(rel)
    for b in bb['biomes']:
        for k in ('background_edge_left', 'background_edge_right',
                  'background_edge_top', 'background_edge_bottom'):
            if b.get(k):
                ship(b[k])

    # --- 1b. static_tile background masks ------------------------------------
    # The five `static_tile="1"` biomes -- the sky temples and the watchtower --
    # do not get a per-chunk backdrop sprite. Their background_image is drawn
    # through shaders/sprite_static_tile_bg.frag, which multiplies it by
    # `static_tile_bg_mask`: a black/white silhouette of the structure at the
    # wang template's own resolution (1 mask pixel = 10 world pixels). Ship the
    # masks verbatim; the renderer thresholds them into an alpha mask at load
    # (js/biome_backgrounds.js STATIC_TILE_BACKGROUNDS, which also records which
    # background image each one masks).
    st_dir = os.path.join(src, 'biome_impl/static_tile')
    mask_re = re.compile(r'static_tile_bg_mask="([^"]+)"')
    if os.path.isdir(st_dir):
        for fn in sorted(os.listdir(st_dir)):
            if not fn.endswith('.xml'):
                continue
            text = open(os.path.join(st_dir, fn), encoding='utf-8',
                        errors='replace').read()
            for mask in mask_re.findall(text):
                if mask:
                    ship(mask, 'data/backgrounds/' + mask.removeprefix('data/'))

    # --- 2. scene backgrounds ------------------------------------------------
    # scene key (material basename, no extension) -> game background path
    scene_bg = {}

    def add(mat_path, bg_path):
        if not mat_path or not bg_path or not bg_path.startswith('data/'):
            return
        # dead references (endgame2_background) and lua string-concat fragments
        # the regex can catch are dropped here rather than at ship time
        if not os.path.isfile(os.path.join(src, bg_path.removeprefix('data/'))):
            return
        key = os.path.splitext(os.path.basename(mat_path))[0]
        prev = scene_bg.get(key)
        if prev and prev != bg_path:
            print(f'  conflict for {key}: {prev} vs {bg_path} (keeping first)')
            return
        scene_bg[key] = bg_path

    lua_root = os.path.join(src, 'scripts')
    table_re = re.compile(
        r'pixel_scene\s*=\s*"([^"]+)"[^{}]*?background_file\s*=\s*"([^"]*)"',
        re.S)
    call_re = re.compile(
        r'LoadPixelScene\(\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*[^,]+,\s*[^,]+,\s*"([^"]+)"')
    for root, _dirs, files in os.walk(lua_root):
        for fn in files:
            if not fn.endswith('.lua'):
                continue
            text = open(os.path.join(root, fn), encoding='utf-8',
                        errors='replace').read()
            for mat, bg in table_re.findall(text):
                add(mat, bg)
            for mat, bg in call_re.findall(text):
                add(mat, bg)

    xml_scene_re = re.compile(
        r'<PixelScene\b[^>]*?background_filename="([^"]*)"[^>]*?'
        r'material_filename="([^"]*)"', re.S)
    globals_re = re.compile(
        r'<Image\s+filename="([^"]+)"\s+x="(-?\d+)"\s+y="(-?\d+)"')

    global_images = []
    biome_dir = os.path.join(src, 'biome')
    for fn in os.listdir(biome_dir):
        if not fn.startswith('_pixel_scenes'):
            continue
        text = open(os.path.join(biome_dir, fn), encoding='utf-8',
                    errors='replace').read()
        for bg, mat in xml_scene_re.findall(text):
            add(mat, bg)
        # <BackgroundImages> only; commented-out entries are stripped first
        text_nc = re.sub(r'<!--.*?-->', '', text, flags=re.S)
        m = re.search(r'<BackgroundImages>(.*?)</BackgroundImages>', text_nc,
                      re.S)
        if m and fn == '_pixel_scenes.xml':
            for f, x, y in globals_re.findall(m.group(1)):
                global_images.append({'file': f, 'x': int(x), 'y': int(y)})

    # ship every referenced background PNG under data/backgrounds/
    scene_bg_out = {}
    for key, bg in sorted(scene_bg.items()):
        try:
            rel = ship(bg, 'data/backgrounds/' + bg.removeprefix('data/'))
        except FileNotFoundError:
            print(f'  missing art for {key}: {bg}')
            continue
        scene_bg_out[key] = rel
    globals_out = []
    for g in global_images:
        try:
            rel = ship(g['file'],
                       'data/backgrounds/' + g['file'].removeprefix('data/'))
        except FileNotFoundError:
            print(f'  missing global art: {g["file"]}')
            continue
        globals_out.append({'file': rel, 'x': g['x'], 'y': g['y'],
                            'size': images[rel]['size']})

    # --- 4. per-chunk LoadBackgroundSprite calls in biome init() -------------
    # A biome's lua `init(x, y, w, h)` runs once per 512px chunk of that biome,
    # and LoadBackgroundSprite( file, x, y, z = 40, check_biome_corners = false )
    # (LUAIMPL_LoadBackgroundSprite @007b2020 -> @006f4720) adds a plain sprite
    # with its top-left at (x, y) into the same z-sorted background SceneGraph.
    # This is how the pyramid's outer pieces get their backdrop above the
    # surface horizon, where the chunk tile itself is suppressed. Only literal
    # files at x/y +- a constant are recorded; calls inside spawn functions
    # depend on pixel markers and are not per-chunk.
    sprite_re = re.compile(
        r'LoadBackgroundSprite\s*\(\s*"([^"]+)"\s*,\s*x\s*([+-]\s*\d+)?\s*,'
        r'\s*y\s*([+-]\s*\d+)?\s*(?:,\s*(-?[\d.]+))?\s*(?:,\s*(\w+))?\s*\)')
    chunk_sprites = {}
    for fn in sorted(os.listdir(biome_dir)):
        if not fn.endswith('.xml') or fn.startswith('_'):
            continue
        xml = open(os.path.join(biome_dir, fn), encoding='utf-8',
                   errors='replace').read()
        m = re.search(r'lua_script="(data/[^"]+)"', xml)
        if not m:
            continue
        lua = os.path.join(src, m.group(1).removeprefix('data/'))
        if not os.path.isfile(lua):
            continue
        text = open(lua, encoding='utf-8', errors='replace').read()
        body = re.search(r'^function\s+init\s*\(.*?^end', text, re.S | re.M)
        if not body:
            continue
        for line in body.group(0).splitlines():
            if line.strip().startswith('--'):
                continue
            # temple_altar_top_shared.lua spawn_altar_top( x, y, is_solid ):
            # LoadBackgroundSprite( wall_background.png, x-1, y - 30, 35 )
            if re.search(r'\bspawn_altar_top\s*\(\s*x\s*,\s*y\s*,', line):
                rel = ship('data/biome_impl/temple/wall_background.png',
                           'data/backgrounds/biome_impl/temple/wall_background.png')
                chunk_sprites.setdefault(fn[:-4], []).append(
                    {'file': rel, 'dx': -1, 'dy': -30, 'z': 35.0})
            for f, dx, dy, z, corners in sprite_re.findall(line):
                if corners == 'true':
                    print(f'  skipping corner-checked sprite in {fn}: {f}')
                    continue
                rel = ship(f, f if f.startswith('data/weather_gfx/')
                           else 'data/backgrounds/' + f.removeprefix('data/'))
                chunk_sprites.setdefault(fn[:-4], []).append({
                    'file': rel,
                    'dx': int(dx.replace(' ', '')) if dx else 0,
                    'dy': int(dy.replace(' ', '')) if dy else 0,
                    'z': float(z) if z else 40.0,
                })

    # --- 5. marker-driven LoadBackgroundSprite art ----------------------------
    # js/spawn_functions.js backgroundSpriteSpawn reproduces the spawn functions
    # that load background sprites; ship every literal they can reach (direct
    # LoadBackgroundSprite files and load_random_background_sprite table
    # entries) under data/backgrounds/. test/background_sprites.test.mjs checks
    # the JS list against what is shipped.
    marker_re = re.compile(
        r'(?:LoadBackgroundSprite\s*\(\s*|sprite_file\s*=\s*)"(data/biome_impl/[^"]+\.png)"')
    marker_files = set()
    for root in ('scripts/biomes', 'biome_impl/static_tile'):
        for dirpath, _, files in os.walk(os.path.join(src, root)):
            for fn in files:
                if fn.endswith('.lua'):
                    text = open(os.path.join(dirpath, fn), encoding='utf-8',
                                errors='replace').read()
                    marker_files.update(marker_re.findall(text))
    for f in sorted(marker_files):
        if os.path.isfile(os.path.join(src, f.removeprefix('data/'))):
            ship(f, 'data/backgrounds/' + f.removeprefix('data/'))

    out = {
        'generated': 'tools/gen_backgrounds.py',
        'source': os.path.basename(src.rstrip('/')),
        'note': 'engine model: docs/worldgen/background_rendering.md '
                '(RE repo). sceneBackgrounds keys = scene material basename; '
                'the background blits 1:1 at the scene position, z=50. '
                'globalImages are the <BackgroundImages> sprites, z=30. '
                'Biome backdrops tile in absolute world coords.',
        'images': images,
        'sceneBackgrounds': scene_bg_out,
        'globalImages': globals_out,
        'chunkSprites': chunk_sprites,
    }
    with open(os.path.join(REPO, 'data/background_data.json'), 'w') as f:
        json.dump(out, f, indent=1)
    total = sum(os.path.getsize(os.path.join(REPO, p)) for p in images)
    print(f'{len(images)} PNGs shipped ({total / 1e6:.2f} MB), '
          f'{len(scene_bg_out)} scene backgrounds, '
          f'{len(globals_out)} global images')


if __name__ == '__main__':
    main()
