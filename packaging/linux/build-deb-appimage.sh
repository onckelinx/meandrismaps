#!/usr/bin/env bash
# Builds the .deb and AppImage inside an Ubuntu 22.04 container (podman).
# Run on the Fedora PC, from the repo root:  bash packaging/linux/build-deb-appimage.sh
# Output: src-tauri/target-ubuntu/release/bundle/{deb,appimage}/
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image=meandrismaps-build-ubuntu22

podman build -t "$image" -f "$repo/packaging/linux/Containerfile" "$repo/packaging/linux"

# - Separate target directory, so this never mixes with the native Fedora build.
# - Named volume for downloaded crates, so rebuilds are faster.
# - APPIMAGE_EXTRACT_AND_RUN: the AppImage tooling needs FUSE, which a container lacks.
# - label=disable: lets the container read the repo without relabelling it (SELinux).
podman run --rm \
    --security-opt label=disable \
    -v "$repo":/src \
    -v meandrismaps-cargo-registry:/usr/local/cargo/registry \
    -e CARGO_TARGET_DIR=/src/src-tauri/target-ubuntu \
    -e APPIMAGE_EXTRACT_AND_RUN=1 \
    "$image" \
    bash -c "npm ci && npm run tauri build -- --bundles deb,appimage"

echo
echo "Done:"
ls -1 "$repo"/src-tauri/target-ubuntu/release/bundle/deb/*.deb \
      "$repo"/src-tauri/target-ubuntu/release/bundle/appimage/*.AppImage
