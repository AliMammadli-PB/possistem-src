# Mascot gaze tracking and material depth

The existing V3 character, relaxed arm, automatic gestures and chat behavior are preserved. Desktop mouse and hovering pen positions now drive smoothed pupil movement. The gaze cone is bounded inside both eyes and converted into the face's local seven-degree coordinates. Blinks, winks and other expressions keep control of eyelids. Leaving the document or losing focus clears pointer attention; scrolling/resizing refreshes the cached mascot bounds. Pointer positions stay in memory on the device and are not sent to an API.

The original high-resolution artwork gains procedural glass/shell highlights, eye catchlight response, radial eye shading, a cast shadow and a small perspective tilt toward the pointer. This is a layered 2.5D material/perspective treatment of the existing artwork, not a new mesh/PBR model. It adds no Three.js, WebGL, model downloads or external texture dependencies. Browsers without perspective support retain the lighting and gaze behavior.

The effects share the existing animation frame loop and do not trigger per-frame React rendering. Pointer movement only records coordinates; bounding-box reads are cached until resize/scroll. Touch input leaves the automatic character gestures active. Off and system-quiet preferences disable pointer-driven motion and perspective. All event listeners are removed when the launcher unmounts for chat.

Validation:

- `node website/scripts/check-mascot-motion.cjs`: the existing 40 scenes/4230 sampled poses, plus pointer directions, neutral gaze, bounded pupil/tilt values and invalid/zero-sized bounds.
- Chromium 151.0.7922.34 integration at desktop 1536×735 and mobile 390 px: four gaze directions, bounded pupils, pointer exit, perspective/lighting response, resize and three consecutive chat remounts without pointer-listener accumulation.
- Off and reduced-motion Auto modes retain stationary perspective; touch keeps automatic animation. A forced unsupported-perspective browser path retains eye tracking with flat lighting.
- Existing frame-clock, quiet/off, hidden-tab, missing-requestAnimationFrame and blocked-WebP/PNG fallback checks passed. No page errors were observed.
- Next.js production build/type checks passed. No physical phone, Firefox or Safari run is claimed.

Local visual evidence is in the workspace `artifacts/mascot-gaze-depth-20261026/` directory. No payment, customer account, POS, Android or server API behavior changed.
