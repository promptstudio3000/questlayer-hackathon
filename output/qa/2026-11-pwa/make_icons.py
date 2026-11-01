# Rasterises the geometry of public/icon.svg (64-unit pixel grid) into opaque,
# full-bleed PNGs at integer scales. Colours are copied from icon.svg.
import sys
from PIL import Image
out = sys.argv[1]
BG, GHOST, EYE, MOUTH = (0x55,0x43,0x6f), (0xff,0xf6,0xe8), (0x76,0x60,0x8f), (0xc1,0xa4,0xd7)
body = [(24,12),(40,12),(40,17),(47,17),(47,41),(42,41),(42,50),(34,50),(34,44),(29,44),(29,50),(21,50),(21,41),(16,41),(16,23),(19,23),(19,17),(24,17)]
def inside(poly, x, y):
    c = False
    for i in range(len(poly)):
        (x1,y1),(x2,y2) = poly[i], poly[i-1]
        if (y1 > y) != (y2 > y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1: c = not c
    return c
def rect(r, x, y): return r[0] <= x < r[2] and r[1] <= y < r[3]
base = Image.new("RGB", (64,64), BG); px = base.load()
for j in range(64):
    for i in range(64):
        cx, cy = i+.5, j+.5
        if inside(body, cx, cy): px[i,j] = GHOST
        if rect((24,26,30,34), cx, cy) or rect((37,26,43,34), cx, cy): px[i,j] = EYE
        if rect((28,39,38,43), cx, cy): px[i,j] = MOUTH
# Maskable: 512 = 64 x 8, glyph radius ~194px stays inside the 204.8px safe circle.
base.resize((512,512), Image.NEAREST).save(f"{out}/maskable-512.png", optimize=True)
# Apple touch: 64 x 3 = 192, centre-cropped to 180; iOS rounds the corners itself.
base.resize((192,192), Image.NEAREST).crop((6,6,186,186)).save(f"{out}/apple-touch-180.png", optimize=True)
