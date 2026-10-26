# Possistem original-reference 3D mascot

Blender 5.2.3 source generator: `build_reference.py`.

The production V3 artwork is the design authority. This is **closed, curved geometry with front-projected original textures**, plus a modeled rear. It is not an independently redesigned robot, a billboard, or a recovered original production mesh. Only the front reference exists; the unseen rear is authored to suit it. The original chest logo is preserved in the production texture, never retyped or approximated with font geometry.

The body and hand textures retain their actual source resolution (1183 × 1181 and 248 × 308). A 3840 × 3840 render is a 4K presentation render, not a claim that new 4K photographic surface detail exists.

From repository root:

```bash
blender -b -t 6 --python website/scripts/mascot-3d/build_reference.py -- /absolute/output/folder website/public/assets/mascot-3d website/public/assets/support-mascot/v3-20261023 --render4k
npm install --prefix website/scripts/mascot-3d
node website/scripts/mascot-3d/optimize.mjs website/public/assets/mascot-3d/possistem-assistant-v1.glb /tmp/possistem-mascot-final.glb
cp /tmp/possistem-mascot-final.glb website/public/assets/mascot-3d/possistem-assistant-v1.glb
```

The Blender file packs the existing textures. Curved front meshes follow sampled alpha silhouettes. Rear shells use ceramic/enamel PBR materials; eyes and mouth are separate surface-conforming meshes with the original SVG geometry/colors. Named pivots remain intact after meshopt compression. Book/laptop props are hidden in authoring renders and activated only by matching gestures.

Runtime: dynamically imported Three.js r180, GLTFLoader and bundled meshopt decoder. No external model/CDN requests. Main-site fallback is the existing V3 SVG renderer, including when WebGL is absent, GLB loading fails or exceeds 15 seconds, or a WebGL context is lost. On unmount, fetches, listeners, textures, geometries, render targets, and the WebGL context are released.

`/maskot/` supplies a larger view, front/side/back buttons, rotation slider, pause and direct GLB download. The website launcher retains its existing dimensions and chat behavior. Motion preferences are available in the chat's options menu.

## Validation (2026-10-26)

- Local production build and 40-scene pose checks pass (4,230 sampled poses).
- Chromium 151.0.7922.34, software WebGL2 (SwiftShader): GLB load, frame progress, pointer gaze and leave, chat open/close twice with listener cleanup, visibility pause/resume, saved off/system motion, 360/390/768 mobile/tablet bounds, touch behavior, model load failure, missing WebGL, context loss, studio rotation and pause.
- Desktop tested at 1536 × 735; studio at 1200 × 1000.
- No actual Windows GPU, Firefox, Safari or phone hardware run is claimed.
- 3840 × 3840 front/back/side Cycles renders produced separately from the optimized website GLB.
- Fixed a glTF export mismatch: emissive materials ignore vertex color; the facial gradient now uses an unlit base color with the correct exported color attribute. This correction is encoded in the optimizer, including for third-party GLB viewers.

Re-run browser checks with an installed Playwright Chromium:

```bash
QA_ORIGIN=http://localhost:3091 node website/scripts/check-mascot-3d.cjs
```

The model retains the existing pose timeline and book/laptop props. SVG-only decorative overlays are not all reconstructed in 3D. The rear is authored, since no original rear reference is available.
