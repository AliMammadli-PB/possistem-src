# Local foreground masking

Local, free CPU inference: rembg 2.0.69 + IS-Net general-use (ONNX; verified by
rembg MD5 fc16ebd8b0c10d971d3513d564d01e29). Original photos are never submitted
to an external inference API. Weights download once from the rembg release;
images remain in the private worker job directory and follow its 7-day cleanup.

Setup with uv (Python 3.11):
```
uv venv --python 3.11 ~/.local/share/possistem/photogrammetry/mask-venv
uv pip install --python ~/.local/share/possistem/photogrammetry/mask-venv/bin/python -r platform/scripts/photogrammetry/requirements-mask.txt
node platform/scripts/photogrammetry/install-worker.mjs
```
Worker configuration can override `maskPython`; `backgroundMasking:false` is an
explicit operator rollback. Mask failure stops the draft instead of silently
uploading an unmasked replacement. Masks retain source pixel coordinates, use a
one-pixel guard band, preserve real openings, and reject implausible coverage.
No optical metric measurement is inferred. Low detail is an advisory metric,
not a guarantee of motion blur on plain surfaces.

Original images remain available for FeatureExtraction/camera alignment. Only
PrepareDenseScene receives `masksFolders`, so dense geometry excludes the
background without discarding camera evidence. Export skips support-plane RANSAC
for masked geometry: otherwise a package's own flat face can be erased as floor.
No masks or raw photos are made public. Finished models remain unpublished drafts.

References:
- https://github.com/danielgatis/rembg (MIT code)
- https://github.com/xuebinqin/DIS (Apache-2.0 IS-Net code)
- https://github.com/alicevision/Meshroom/wiki/New-Features-in-Meshroom-2023.1#1-image-masking
