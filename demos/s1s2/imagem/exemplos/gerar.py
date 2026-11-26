#!/usr/bin/env python3
"""Generates the example drawings of the Visual Jev demo (256 x 256 PNG, flat shapes on white).
Only the standard library is used; the output is deterministic (3 x 3 supersampling, no randomness).
The drawings are ours: CC0 / public domain. Run: python3 gerar.py  (writes the PNGs next to this file)."""
import math, struct, zlib
from pathlib import Path

S = 256
SS = 3
RED, GREEN, BLUE, YELLOW, PURPLE = (214, 40, 40), (46, 160, 67), (36, 99, 235), (250, 204, 21), (124, 58, 237)

def circle(cx, cy, r):
    return lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def polygon(pts):
    def inside(x, y):
        c = False
        j = len(pts) - 1
        for i in range(len(pts)):
            xi, yi = pts[i]; xj, yj = pts[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                c = not c
            j = i
        return c
    return inside

def square(cx, cy, h):
    return polygon([(cx - h, cy - h), (cx + h, cy - h), (cx + h, cy + h), (cx - h, cy + h)])

def triangle(cx, cy, h):
    return polygon([(cx, cy - h), (cx + h, cy + h * .8), (cx - h, cy + h * .8)])

def star(cx, cy, R, r=None):
    r = r or R * .42
    return polygon([(cx + (R if i % 2 == 0 else r) * math.sin(i * math.pi / 5), cy - (R if i % 2 == 0 else r) * math.cos(i * math.pi / 5)) for i in range(10)])

def render(shapes):
    rows = []
    for py in range(S):
        row = bytearray([0])
        for px in range(S):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x, y = px + (sx + .5) / SS, py + (sy + .5) / SS
                    c = (255, 255, 255)
                    for inside, col in shapes:   # the last shape that contains the point wins
                        if inside(x, y): c = col
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            row += bytes(v // (SS * SS) for v in acc)
        rows.append(bytes(row))
    raw = b"".join(rows)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

DRAWINGS = {
    "circulo-quadrado": [(circle(80, 128, 52), BLUE), (square(184, 128, 48), RED)],                     # blue circle, red square
    "posicoes": [(triangle(70, 130, 52), GREEN), (circle(186, 130, 50), YELLOW)],                       # triangle on the left, circle on the right
    "estrelas": [(star(52, 128, 34), PURPLE), (star(128, 128, 34), PURPLE), (star(204, 128, 34), PURPLE)],   # three stars
    "quadrado": [(square(128, 128, 84), YELLOW)],                                                       # one big yellow square
    "tres-formas": [(circle(128, 52, 36), RED), (square(128, 128, 34), GREEN), (triangle(128, 204, 38), BLUE)],   # red circle, green square, blue triangle (top to bottom)
}

if __name__ == "__main__":
    here = Path(__file__).resolve().parent
    for name, shapes in DRAWINGS.items():
        (here / f"{name}.png").write_bytes(render(shapes))
        print(name)
