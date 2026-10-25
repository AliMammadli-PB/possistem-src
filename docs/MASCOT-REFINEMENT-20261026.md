# Support mascot: relaxed arm and livelier motion

The V3 face, body, brand artwork, launcher placement and chat flow are preserved. The old left asset was an open raised palm rotated down at rest, which still appeared twisted. The left arm now reuses the existing relaxed right-arm asset mirrored around the left shoulder. Each gesture's left-arm angles were recalibrated around the new zero-degree resting pose; the original raster assets remain intact.

Full motion plays at 1.25× speed. Short inter-scene pauses decrease from 1000 to 550 logical milliseconds. The automatic loop has 20 alternating gestures, including small dance/jump movements, instead of adjacent reading/typing variants. Body float amplitude increases from 1.5 to 10 SVG units with a shorter period; gentle arm counter-motion, a grounded shadow response and speech-bubble float add visible motion without changing the launcher's fixed screen position. The renderer has a 60 fps full-motion budget with a retained fractional frame remainder, and a 20 fps quiet budget; the existing timer fallback remains available.

Reading, typing, greeting, stretching and celebration arm angles match the new neutral arm. The clap pose uses lower inward angles so the arms overlap less. Blinking/winking remains temporary; eyes reopen after each pulse. Quiet mode keeps the body and arms stationary, and Off stops the frame loop. User motion preferences and hidden-tab suspension are preserved. No chat, API, payment, POS or Android behavior changed.

Checks:

- `node website/scripts/check-mascot-motion.cjs`: 40 scenes, 4230 finite/bounded sampled poses, resting-arm limits, unilateral winks/reopening, blink recovery and ordered reachability of all 20 automatic gestures.
- A Chromium 151.0.7922.34 harness rendered and visually reviewed all 40 poses. It checked real frame advancement, body motion, hidden/visible suspension, quiet/off behavior and the timer fallback with requestAnimationFrame unavailable.
- Real React integration was checked at 390 px and 1536×735, including an emulated reduced-motion system with Full explicitly selected, launcher bounds, chat open/close anchoring, the neutral paused arm and PNG fallback when WebP loading is blocked. No browser page errors occurred.
- Next.js production build and TypeScript checks passed. Physical phones and other browser engines were not tested.

Visual evidence and detailed runtime results are in the workspace `artifacts/mascot-refine-20261026/` folder. The browser harnesses are local verification tools and do not add customer-facing controls or collect chat content.
