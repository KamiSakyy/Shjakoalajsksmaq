#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="${WORK_DIR:-$ROOT_DIR/.build-taisei}"
TAISEI_TAG="${TAISEI_TAG:-v1.4.6}"
ANDROID_API="${ANDROID_API:-26}"
ANDROID_ABIS="${ANDROID_ABIS:-arm64-v8a x86_64}"

if [ -z "${ANDROID_NDK_HOME:-}" ]; then
    if [ -n "${ANDROID_NDK_LATEST_HOME:-}" ]; then
        ANDROID_NDK_HOME="$ANDROID_NDK_LATEST_HOME"
    elif [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/ndk" ]; then
        ANDROID_NDK_HOME="$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -n 1)"
    else
        echo "ERROR: ANDROID_NDK_HOME is not set" >&2
        exit 1
    fi
fi

echo "==> Using ANDROID_NDK_HOME=$ANDROID_NDK_HOME"
TOOLCHAIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64"
AR="$TOOLCHAIN/bin/llvm-ar"
STRIP="$TOOLCHAIN/bin/llvm-strip"
RANLIB="$TOOLCHAIN/bin/llvm-ranlib"

mkdir -p "$WORK_DIR"
TAISEI_DIR="$WORK_DIR/taisei"

if [ ! -d "$TAISEI_DIR" ]; then
    echo "==> Cloning Taisei Project ($TAISEI_TAG) with submodules..."
    git clone --depth 1 --recursive --shallow-submodules --branch "$TAISEI_TAG" https://github.com/taisei-project/taisei.git "$TAISEI_DIR"
fi

echo "==> Applying Android patches to Taisei..."
python3 - "$TAISEI_DIR" <<'PYEOF'
import sys, pathlib

taisei_dir = pathlib.Path(sys.argv[1])

# 1. Patch src/meson.build to build libmain.so on Android
src_meson = taisei_dir / "src" / "meson.build"
text = src_meson.read_text()
old_exec = """    taisei = executable(taisei_basename, taisei_main_src,
        dependencies : stages_live_reload ? libtaisei_dep.as_link_whole() : libtaisei_dep,
        win_subsystem : get_option('win_console') ? 'console' : 'windows',
        install : true,
        install_dir : bindir,
        export_dynamic : stages_live_reload,
    )"""

new_exec = """    if host_machine.system() == 'android'
        taisei = shared_library('main', taisei_main_src,
            dependencies : libtaisei_dep,
            install : true,
            install_dir : bindir,
        )
    else
        taisei = executable(taisei_basename, taisei_main_src,
            dependencies : stages_live_reload ? libtaisei_dep.as_link_whole() : libtaisei_dep,
            win_subsystem : get_option('win_console') ? 'console' : 'windows',
            install : true,
            install_dir : bindir,
            export_dynamic : stages_live_reload,
        )
    endif"""

if "shared_library('main'" not in text:
    assert old_exec in text, "Could not find executable() block in src/meson.build"
    src_meson.write_text(text.replace(old_exec, new_exec, 1))
    print("Patched src/meson.build")

# 2. Patch subprojects/sdl3-cmake-wrapper/meson.build to build SDL3 shared on Android
sdl_meson = taisei_dir / "subprojects" / "sdl3-cmake-wrapper" / "meson.build"
stext = sdl_meson.read_text()
old_sdl = """    'SDL_SHARED': false,
    'SDL_STATIC': true,
})"""
new_sdl = """    'SDL_SHARED': host_machine.system() == 'android',
    'SDL_STATIC': host_machine.system() != 'android',
})"""
if "host_machine.system() == 'android'" not in stext:
    assert old_sdl in stext, "Could not find SDL_SHARED block"
    stext = stext.replace(old_sdl, new_sdl, 1)
    stext = stext.replace(
        "sdl3_dep = sdl3_subproject.dependency('SDL3-static')",
        "sdl3_dep = sdl3_subproject.dependency(host_machine.system() == 'android' ? 'SDL3-shared' : 'SDL3-static')",
        1,
    )
    sdl_meson.write_text(stext)
    print("Patched subprojects/sdl3-cmake-wrapper/meson.build")
PYEOF

ASSETS_DIR="$ROOT_DIR/android/app/src/main/assets"
SDL_JAVA_DST="$ROOT_DIR/android/app/src/main/java/org/libsdl/app"
mkdir -p "$ASSETS_DIR" "$SDL_JAVA_DST"

FIRST_ABI=1
for ABI in $ANDROID_ABIS; do
    case "$ABI" in
        arm64-v8a)
            TRIPLE="aarch64-linux-android"
            CPU_FAMILY="aarch64"
            CPU="aarch64"
            ;;
        x86_64)
            TRIPLE="x86_64-linux-android"
            CPU_FAMILY="x86_64"
            CPU="x86_64"
            ;;
        *)
            echo "Unsupported ABI: $ABI" >&2
            exit 1
            ;;
    esac

    CC="$TOOLCHAIN/bin/${TRIPLE}${ANDROID_API}-clang"
    CXX="$TOOLCHAIN/bin/${TRIPLE}${ANDROID_API}-clang++"
    CROSS_FILE="$WORK_DIR/android-${ABI}.ini"
    BUILD_DIR="$WORK_DIR/build-${ABI}"

    cat > "$CROSS_FILE" <<EOF
[binaries]
c = '$CC'
cpp = '$CXX'
ar = '$AR'
strip = '$STRIP'
ranlib = '$RANLIB'
cmake = 'cmake'
pkgconfig = 'false'

[built-in options]
c_args = ['-fPIC', '-D__ANDROID_API__=${ANDROID_API}']
cpp_args = ['-fPIC', '-D__ANDROID_API__=${ANDROID_API}']
c_link_args = ['-llog', '-landroid', '-lGLESv3', '-lEGL', '-lm']
cpp_link_args = ['-llog', '-landroid', '-lGLESv3', '-lEGL', '-lm']

[cmake]
CMAKE_TOOLCHAIN_FILE = '$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake'
ANDROID_ABI = '${ABI}'
ANDROID_PLATFORM = 'android-${ANDROID_API}'
ANDROID_STL = 'c++_shared'

[host_machine]
system = 'android'
cpu_family = '${CPU_FAMILY}'
cpu = '${CPU}'
endian = 'little'
EOF

    if [ "$FIRST_ABI" -eq 1 ]; then
        PKG_DATA_OPT="enabled"
    else
        PKG_DATA_OPT="disabled"
    fi

    echo "==> Configuring Meson for Android $ABI (package_data=$PKG_DATA_OPT)..."
    meson setup "$BUILD_DIR" "$TAISEI_DIR" \
        --cross-file "$CROSS_FILE" \
        --buildtype=release \
        --wrap-mode=forcefallback \
        -Dallocator=libc \
        -Dr_default=gles30 \
        -Dr_gles30=enabled \
        -Dr_gl33=disabled \
        -Dr_sdlgpu=disabled \
        -Dr_null=disabled \
        -Da_default=sdl \
        -Da_sdl=enabled \
        -Da_null=disabled \
        -Dpackage_data="$PKG_DATA_OPT" \
        -Dvalidate_glsl=disabled \
        -Ddocs=disabled \
        -Dinstall_freedesktop=disabled \
        -Dgamemode=disabled \
        -Dtests=disabled \
        -Duse_libcrypto=disabled \
        -Duse_libpng=disabled

    echo "==> Compiling Taisei for $ABI..."
    ninja -C "$BUILD_DIR"

    JNILIBS_DIR="$ROOT_DIR/android/app/src/main/jniLibs/$ABI"
    mkdir -p "$JNILIBS_DIR"

    find "$BUILD_DIR" -name "libmain.so" -exec cp -v {} "$JNILIBS_DIR/libmain.so" \;
    find "$BUILD_DIR" -name "libSDL3.so" -exec cp -v {} "$JNILIBS_DIR/libSDL3.so" \;
    cp -v "$TOOLCHAIN/sysroot/usr/lib/${TRIPLE}/libc++_shared.so" "$JNILIBS_DIR/libc++_shared.so"

    if [ "$FIRST_ABI" -eq 1 ]; then
        find "$BUILD_DIR" -name "00-taisei.zip" -exec cp -v {} "$ASSETS_DIR/00-taisei.zip" \;
        FIRST_ABI=0
    fi
done

SDL_JAVA_SRC="$TAISEI_DIR/subprojects/sdl3/android-project/app/src/main/java/org/libsdl/app"
cp -v "$SDL_JAVA_SRC"/*.java "$SDL_JAVA_DST/"

echo "==> Native build & asset staging complete!"
ls -lh "$ROOT_DIR/android/app/src/main/jniLibs/"* "$ASSETS_DIR"
