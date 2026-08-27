"""
Make the test cut-outs the face-framing rig measures (v1.36.0).

scratch/face-frame-check.mjs needs REAL cut-outs — a drawing of a person
proves nothing about a matte's ragged edges. These are the shop's own
fixture photos run through the SAME U²-Net model the portal runs in the
CEO's browser (public/vendor/u2netp.onnx over there), with the same
S-curve on the alpha, so the silhouettes the rig reads are the silhouettes
the shop will read.

The PNGs are not committed — they are 7.6 MB of derived data. Regenerate:

    python3 scratch/make-cutouts.py      (needs onnxruntime + opencv)

Writes scratch/cutouts/*.png. Nothing else reads them; nothing ships them.
"""
import cv2, numpy as np, onnxruntime as ort, os, glob
sess = ort.InferenceSession("/root/portal/public/vendor/u2netp.onnx", providers=["CPUExecutionProvider"])
inp = sess.get_inputs()[0].name
SRC = ["bawal-periwinkle","bawal-dusty-rose","bawal-navy-gold","bawal-lavender","shawl-beige","bawal-aurora"]
for name in SRC:
    p = f"/root/elfia/public/collection/{name}.jpg"
    img = cv2.imread(p, cv2.IMREAD_COLOR)
    if img is None: print("miss", p); continue
    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    r = cv2.resize(rgb, (320, 320), interpolation=cv2.INTER_AREA)
    mean = np.array([0.485, 0.456, 0.406], np.float32); std = np.array([0.229, 0.224, 0.225], np.float32)
    x = ((r - mean) / std).transpose(2, 0, 1)[None]
    out = sess.run(None, {inp: x})[0][0, 0]
    out = (out - out.min()) / max(1e-6, out.max() - out.min())
    a = cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR)
    a = np.where(a < 0.35, a * a / 0.35, a)          # the S-curve lib/cutout.ts uses
    a = cv2.GaussianBlur(a, (0, 0), 1.0)
    alpha = np.clip(a * 255, 0, 255).astype(np.uint8)
    rgba = np.dstack([img, alpha])
    cv2.imwrite(f"/root/elfia/scratch/cutouts/{name}.png", rgba)
    ys, xs = np.where(alpha > 128)
    print(f"{name}: {w}x{h} subject rows {ys.min()}-{ys.max()} cols {xs.min()}-{xs.max()}")
