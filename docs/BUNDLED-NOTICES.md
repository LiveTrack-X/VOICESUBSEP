# Bundled dependency notices

The Windows backend build preserves original installed notices without editing the source files:

- NVIDIA cuBLAS, cuDNN, CUDA Runtime and NVRTC: each package's complete `*.dist-info` directory, including `licenses/License.txt`, under `_internal/`.
- FFmpeg and FFprobe: original `LICENSE`/`COPYING`, `README` and other notice files found beside the executables or in their installation root, under `_internal/third-party/ffmpeg/`. A separately installed FFprobe uses `_internal/third-party/ffprobe/`.

The copied FFmpeg README preserves the installed distributor's version, source reference and build information. The build fails if required notices are missing or if a bundled notice's SHA256 differs from its installed original. Do not remove these files when copying or packaging the backend folder.

This is notice preservation, not a finding that public redistribution requirements are satisfied. Review the actual bundled versions and all applicable distribution and source obligations before public redistribution. Model weights are cached separately and are not included by this build script.
