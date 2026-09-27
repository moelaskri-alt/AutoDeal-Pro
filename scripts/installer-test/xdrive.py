"""Tiny X11 driver used to click through the NSIS installer under Wine (installer smoke tests).

usage: xdrive.py shot <file>            -> screenshot of the non-black area
       xdrive.py key <keysym> [n]        -> press a key n times (e.g. Return, Tab, space)
       xdrive.py click <x> <y>           -> left click at absolute screen coords
"""
import sys
import time
from Xlib import X, XK, display
from Xlib.ext import xtest

d = display.Display()


def key(name, n=1):
    code = d.keysym_to_keycode(XK.string_to_keysym(name))
    for _ in range(n):
        xtest.fake_input(d, X.KeyPress, code)
        xtest.fake_input(d, X.KeyRelease, code)
        d.sync()
        time.sleep(0.3)


def click(x, y):
    d.screen().root.warp_pointer(x, y)
    d.sync()
    xtest.fake_input(d, X.ButtonPress, 1)
    xtest.fake_input(d, X.ButtonRelease, 1)
    d.sync()


def shot(path):
    from PIL import ImageGrab
    im = ImageGrab.grab(xdisplay=d.get_display_name())
    box = im.convert('L').point(lambda p: p > 5 and 255).getbbox()
    (im.crop(box) if box else im).save(path)
    print(box)


cmd = sys.argv[1]
if cmd == 'key':
    key(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1)
elif cmd == 'click':
    click(int(sys.argv[2]), int(sys.argv[3]))
elif cmd == 'shot':
    shot(sys.argv[2])
