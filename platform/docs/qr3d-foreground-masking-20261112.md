# Local QR foreground masks — 2026-11-12

Implemented class-independent IS-Net segmentation using rembg 2.0.69 / ONNX
Runtime CPU 1.31.1. Inference is local; the RTX 3050 remains available for native
CUDA depth reconstruction. No paid API or customer-photo transfer to a model
provider. Weights downloaded once, with the package's checksum verification.

All 40 photos of the private Salfetka capture were masked. Initial run: 60.85 s;
worker run: 56.3 s. Scene camera estimation continues to use original images;
PrepareDenseScene receives masks in source pixel coordinates. A real EXR alpha
check confirmed 83.78% excluded pixels in the sampled frame. All 40 cameras
calibrated. Mask PNGs are never public. They share the private job's 7-day cleanup.

Mask cleanup preserves real openings, removes separate background components
and thin connecting spurs, retains a one-pixel boundary margin, and rejects empty,
full, tiny or strongly inconsistent silhouettes. Low-detail measurements are
advisory, because plain objects also contain few edges. They do not silently
remove frames. Segmentation failure stops processing rather than uploading an
unmasked substitute.

Worker mask folders are content addressed. Changing mask pixels changes the
folder/graph cache key, so retries cannot reuse old depth maps. Foreground export
skips support-plane RANSAC to avoid cutting off a package's own flat face.

API accepts the masking heartbeat stage; owner UI displays foreground isolation.
No database migration, POS installer or public QR viewer change was needed.

Tests: 5 mask/geometry-precondition tests passed; 9 isolated PostgreSQL scan
integration tests passed including masking and unknown-stage rejection. Owner
browser checks passed at 390/768/1536 px, with 20.90 s capture, deferred uploads,
retry/permission failures and stream cleanup. TypeScript/API and owner builds pass.
Native iPhone AR is not part of these masking tests.

First reconstruction removed the brown table fringe. An unobserved underside
still has missing geometry; background masks are not a guarantee of complete
geometry or readable texture from blurred photos. Customer originals are kept.

API/owner deploy backup:
/opt/possistem-pos-control/backups/qr-masking-2026-11-12T11-01-09-624Z

Final end-to-end repeat used an immutable mask folder derived from mask PNG SHA256.
The previous camera solution was reused, dense maps rebuilt, and foreground export
used the explicit mask flag. GLB validation: 26,083 triangles, one texture,
3,036,548 bytes, estimated width 15 cm. Three-angle rendering and real USDZ ZIP
conversion passed. The worker service was restored active with matching source.

A private unpublished customer-scoped draft was imported idempotently as
“Salfetka · fon təmizlənib” (dd00e447-8ade-4b0d-84b9-c524bfb280c5).
The source model and capture were preserved; audit entry exists. Repeated import
returned the existing draft without creating another model.

Final operational verification found an orphan API process holding port 3210,
while systemd restarted against EADDRINUSE. Its cwd/command were verified against
the intended API, then it was stopped gracefully and systemd restored. Listener
PID now matches systemd MainPID. Deployment helpers also require listener ownership
instead of accepting an HTTP200 from any process. Live masking heartbeat returned
200, an unknown stage returned 400, and owner endpoints returned 401 unauthenticated.
The local processing service is active and matches the tested source.
