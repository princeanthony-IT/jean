# AppImage Build Failure on Arch Linux

## Problem

Building Linux AppImage on Arch Linux fails with error:

```
ERROR: Strip call failed: /tmp/.mount_linuxdQq7uQo/usr/bin/strip: Jean.AppDir/usr/lib/libwebkit2gtk-4.1.so.0: unknown type [0x13] section `.relr.dyn'
```

### Root Cause

1. **Arch Linux uses `.relr.dyn` ELF sections** - Enabled via `-Wl,-z,pack-relative-relocs` since binutils 2.38
2. **linuxdeploy's embedded `strip` binary is too old** - Doesn't recognize section type 0x13 (`.relr.dyn`)
3. **Incompatibility** - linuxdeploy AppImage was built before RELR support was added

## Solutions

### Option 1: Use DEB/RPM Instead (Recommended)

**DEB and RPM builds work successfully on Arch Linux:**

```bash
bun run tauri:build:linux
```

**Updated package.json:**

```json
"tauri:build:linux": "tauri build --bundles deb,rpm"
```

**Pros:**

- Works out of the box
- Standard Linux package formats
- Can be installed with: `sudo dpkg -i Jean_0.1.0_amd64.deb` or `sudo pacman -U Jean_0.1.0-1.x86_64.rpm`
- Smaller file size (8MB vs 95MB)

**Cons:**

- Not portable (requires package manager)
- Doesn't run without installation

### Option 2: Manual AppImage Build (with NO_STRIP)

**AppImage requires setting `NO_STRIP=1` to skip linuxdeploy's stripping:**

```bash
# Build AppDir first
bun run tauri build --bundles appimage 2>&1 | head -100

# Then manually run linuxdeploy with NO_STRIP
cd src-tauri/target/release/bundle/appimage
NO_STRIP=1 ~/.cache/tauri/linuxdeploy-x86_64.AppImage --appdir Jean.AppDir --output appimage

# Or run the appimage plugin directly
NO_STRIP=1 ~/.cache/tauri/linuxdeploy-plugin-appimage.AppImage --appdir Jean.AppDir
```

**Result:** Creates 95MB `Jean-x86_64.AppImage` in `src-tauri/target/release/bundle/appimage/`

**Pros:**

- Portable AppImage
- Works on any x86_64 Linux distribution
- Single executable

**Cons:**

- Larger file size (not stripped)
- Manual two-step process
- Tauri's automated build process fails

### Option 3: Wait for Tauri/linuxdeploy Fix

This is a known issue:

- Tauri issue #11149: "Calling strip causes Tauri to fail building AppImage"
- linuxdeploy issue #272: "Error building Appimage after latest update"

**Status:** Currently "not planned" in Tauri issue tracker

## Current Status

### Working Solutions

✅ **DEB package** (`Jean_0.1.0_amd64.deb`) - 8.1MB - **RECOMMENDED**
✅ **RPM package** (`Jean_0.1.0-1.x86_64.rpm`) - 8.4MB
✅ **AppImage** (`Jean-x86_64.AppImage`) - 95MB - Requires manual build with NO_STRIP=1

### Failed Solutions

❌ Tauri automated AppImage build - Fails due to linuxdeploy stripping issue
❌ Setting environment variables in package.json - `NO_STRIP=true` not passed through Tauri CLI

## Notes

1. **Updater Plugin Warning:** The `__TAURI_BUNDLE_TYPE` warning is harmless - occurs because binary is already stripped by Rust's `strip = true` in Cargo.toml

2. **Signing Key Error:** DEB/RPM build may fail if `TAURI_SIGNING_PRIVATE_KEY` is not set but public key exists in tauri.conf.json

3. **AppImage size:** Unstripped AppImage is 95MB (vs ~40MB if stripped). This is expected behavior on Arch Linux due to the workaround.

## Recommendation

**For Arch Linux:** Use DEB/RPM packages for regular distribution. Use manual AppImage build only if portability is required.
