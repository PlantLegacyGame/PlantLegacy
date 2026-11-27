# How the growth frames were measured

The G04 row in [`../bug-inventory.md`](../bug-inventory.md) records what the
growth frames showed. The frames themselves are local-only and are not part of
the repository. This is how the measurements were taken, so nobody has to
rediscover why a plain screenshot will not do.

## A growth takes about a second

`node.growthProgress` runs from 0 to 1 in roughly a second, so a screenshot
round trip from the editor lands on the finished organ. Each frame was taken by
polling `node.growthProgress` for the window of interest, putting the camera on a
fixed framing around the head, and freezing the pixels with a full-window
`<img>` of `canvas.toDataURL()`. Clearing the animation loop is not enough:
`renderer.setAnimationLoop(null)` does not stop the client's own loop, so without
the overlay the captured frame is painted a second later. What the renderer was
drawing was read back at the same moment - `seg.ornament.scale` was
0.28 / 1.8 / 0.28 at 29% of the growth, and 1 / 1 / 1 finished.

## Why a plain frame is not measured

The head sits about fifteen brightness levels above the hillside behind it. Every
threshold tried on the in-game frames either swallowed the ground (13 000 px of
"head" in a 21 000 px window) or found nothing, and the edge-box method boxed the
sky gradient instead. That is what the dev-only capture below exists to avoid.

## The measuring capture

`__plantLegacy.devHeadCapture(progress, nodeType = 'spore_sac')`, from the
console of a `?dev=1` build once the world is loaded.

- It measures the head the plant is drawing (`source: 'planted'`), or the
  builder's default specimen when nothing of that organ is planted
  (`source: 'specimen'`). Every report says which, and a specimen capture logs a
  warning through `headCaptureNotice`: a specimen's numbers were once cited as
  the plant's, which is the one way this capture can lie.
- The head is drawn alone on black or flat white, through an orthographic camera,
  with the ink hull dropped so the silhouette is the lobes' own extent.
- The frame is sized by sampling the growth rule from 0.05 to 1 and taking the
  tallest, widest moment, so every state of one head shares a metres-per-pixel
  and two counts can be compared.
- The silhouette's box is read off the rendered pixels, with a pixel counting as
  head at brightness 128.

Run on the planted spore sac, the report gives 98 x 444 px at 29% and
350 x 248 px at 100%, both through one 512 px frame (0.136 mm per pixel). Those
numbers are recorded in G04; the images stayed on the development machine.

The framing, the measurement and the source notice live in
`renderers/plant/headCapture.ts` with their tests; `main.ts` holds the three.js
wiring, behind `import.meta.env.DEV`.
