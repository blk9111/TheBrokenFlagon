
from PIL import Image
import os, sys

game = r'C:\Users\Brian\Downloads\TheBrokenFlagon-Game'
ICON = 80

pairs = [
    ('cleric-f.png',            'cleric-f-icon.png'),
    ('cleric-m.png',            'cleric-m-icon.png'),
    ('warrior-m.png',           'warrior-m-icon.png'),
    ('warrior-f.png',           'warrior-f-icon.png'),
    ('rogue-m.png',             'rogue-m-icon.png'),
    ('rogue-f.png',             'rogue-f-icon.png'),
    ('mage-m.png',              'mage-m-icon.png'),
    ('mage-f.png',              'mage-f-icon.png'),
    ('berserker-m-portrait.png','berserker-m-icon.png'),
    ('berserker-f-portrait.png','berserker-f-icon.png'),
    ('Knight-m-protrait.png',   'knight-m-icon.png'),
    ('Knight-f-protrait.png',   'knight-f-icon.png'),
    ('Knight-m-protrait.png',   'knight-icon.png'),
    ('berserker-m-portrait.png','berserker-icon.png'),
]

for src_name, dst_name in pairs:
    src = os.path.join(game, src_name)
    dst = os.path.join(game, dst_name)
    if not os.path.exists(src):
        print(f'MISSING: {src_name}')
        continue
    try:
        img = Image.open(src).convert('RGBA')
        w, h = img.size
        crop_size = min(w, int(h * 0.52))
        left = (w - crop_size) // 2
        box = (left, 0, left + crop_size, crop_size)
        out = img.crop(box).resize((ICON, ICON), Image.LANCZOS)
        out.save(dst, 'PNG')
        print(f'OK: {dst_name}')
    except Exception as e:
        print(f'ERR {src_name}: {e}')

print('DONE')
