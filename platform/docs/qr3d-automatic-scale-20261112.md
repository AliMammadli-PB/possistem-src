# QR scale and quality — 2026-11-12

Scan centimetres and surface classification are no longer mandatory. Unmeasured
scans start at 15 cm with an explicit estimated-size label, not inferred metric
accuracy. Optional declared widths remain supported. Migration 0060 marks legacy
28 cm capture defaults unverified without rewriting GLBs and is repeatable.

Owner and public viewers use ar-scale=auto; the synchronous Quick Look blob link
allowsContentScaling=1. Cart restoration, private previews, exact product/option
IDs and strict measured-upload variant checks remain. Unmeasured scans do not
claim centimetre accuracy and permit AR pinch resizing.

Validation: 9 scan integration and 10 model regression tests passed in isolated
PostgreSQL. Chromium 158.0.8127.18 checked 390/768/1536 px, optional size, 20.46 s
capture followed by uploads, retries, camera cleanup, owner/public scale auto,
real USDZ conversion and iPhone-capability-emulated Quick Look link. Physical
phone gestures have not been tested by the agent. Owner/API and Next builds pass.

The actual forty-photo capture was rebuilt at full depth resolution: 79,999
triangles / 9,749,112 bytes vs 34,420 triangles / 5,042,848 bytes. Visual inspection
still found holes and malformed inner surfaces. This result did not replace the
customer model; expensive detail mode was not made the default. Diagnostics and
source captures remain private. More computation did not solve missing evidence.

Worker now uses the camera solution referenced by the current graph, retries JPEG
encoding within the 10 MB cap, and removes failed oversized exports. The RTX 3050
queue service is active. No paid service or Windows operator EXE was introduced.

Deploy backups:
- /opt/possistem-pos-control/backups/qr-scale-2026-11-12T06-50-03-930Z
- /opt/possistem-pos-control/backups/qr-scale-web-2026-11-12T06-50-24-594Z
