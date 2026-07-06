#!/usr/bin/env bash
# ============================================================
#  fetch-tools.sh — 多源拉取剪辑工具到 resources/tools/
#
#  用法:
#    bash fetch-tools.sh              # 下载所有工具
#    bash fetch-tools.sh --force       # 强制重新下载
#    bash fetch-tools.sh --skip large  # 跳过 Whisper (1.5GB)
#
#  CI 集成:
#    在 workflow 中: shell: bash, run: bash fetch-tools.sh
#    CI 环境: windows-latest 自带 Python (python 命令)
# ============================================================

set -euo pipefail

# 自动检测 Python 命令 (Windows CI 上是 python, Unix 上是 python3)
PYTHON=""
for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    PYTHON="$cmd"
    break
  fi
done
[ -z "$PYTHON" ] && { echo "[fetch-tools] FATAL: python not found" >&2; exit 1; }

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)/resources/tools"
FORCE=false
SKIP_LARGE=false

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --skip) shift; [ "${1:-}" = "large" ] && SKIP_LARGE=true ;;
  esac
done

mkdir -p "$TOOLS_DIR"

log()  { echo "[fetch-tools] $*"; }
skip() { echo "[fetch-tools] SKIP: $* (already exists, use --force to re-download)"; }
fail() { echo "[fetch-tools] FAIL: $*" >&2; }

# ── 下载辅助函数 ──────────────────────────────────────────
# download URL FILENAME [expected_size_kb]
#   下载到 $TOOLS_DIR/FILENAME，支持断点续传(不强制)
#   如果文件存在且大小 > 1KB，默认跳过
download() {
  local url="$1" file="$2" expect_kb="${3:-0}"
  local dest="$TOOLS_DIR/$file"

  if [ "$FORCE" != true ] && [ -f "$dest" ]; then
    local actual
    actual=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null || echo 0)
    if [ "$actual" -gt 1024 ]; then
      skip "$file"
      return 0
    fi
  fi

  log "downloading $file ..."
  # curl -L 跟随重定向, -f 失败时非零退出, -# 进度条, -o 输出文件, -C - 延续中断下载
  # 在 CI 环境中 (non-tty) 使用 -sS (silent but show errors) 代替 -#
  if [ -t 1 ]; then
    curl -Lf -C - -# -o "$dest.tmp" "$url" || { fail "$file download failed"; return 1; }
  else
    curl -Lf -C - -sS -o "$dest.tmp" "$url" || { fail "$file download failed"; return 1; }
  fi

  mv "$dest.tmp" "$dest"
  local actual
  actual=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null || echo 0)
  log "  → $file ($(numfmt --to=iec $actual 2>/dev/null || echo "${actual} bytes"))"

  # 体积检查（提供 expected 时才检查）
  if [ "$expect_kb" -gt 0 ]; then
    local actual_kb=$((actual / 1024))
    if [ "$actual_kb" -lt "$((expect_kb * 4 / 5))" ]; then
      fail "$file: expected ~${expect_kb}KB, got ${actual_kb}KB — file may be truncated"
      return 1
    fi
  fi
}

# ── 各工具下载 ────────────────────────────────────────────

# 1. FFmpeg + FFprobe (打包在同一个 zip 里)
#    多源: BtbN GitHub 主源 (CI 友好), gyan.dev 备源
download_ffmpeg() {
  local ffmpeg_exe="$TOOLS_DIR/ffmpeg.exe"
  local ffprobe_exe="$TOOLS_DIR/ffprobe.exe"

  if [ "$FORCE" != true ] && [ -f "$ffmpeg_exe" ] && [ -f "$ffprobe_exe" ]; then
    local sz1 sz2
    sz1=$(stat -c%s "$ffmpeg_exe" 2>/dev/null || stat -f%z "$ffmpeg_exe" 2>/dev/null || echo 0)
    sz2=$(stat -c%s "$ffprobe_exe" 2>/dev/null || stat -f%z "$ffprobe_exe" 2>/dev/null || echo 0)
    if [ "$sz1" -gt 1024 ] && [ "$sz2" -gt 1024 ]; then
      skip "ffmpeg.exe + ffprobe.exe"
      return 0
    fi
  fi

  local tmpdir="$TOOLS_DIR/.ffmpeg-tmp"
  rm -rf "$tmpdir"
  mkdir -p "$tmpdir"

  local curl_opts="-Lf -C -"
  if [ -t 1 ]; then
    curl_opts="$curl_opts -#"
  else
    curl_opts="$curl_opts -sS"
  fi

  log "downloading FFmpeg ..."

  # 主源: BtbN GitHub (GitHub Actions 域名内，速度快且不会被墙)
  local dl_ok=false
  if curl $curl_opts -o "$tmpdir/ffmpeg.zip" \
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"; then
    dl_ok=true
  else
    log "primary source (BtbN) failed, trying gyan.dev ..."
    # 备源: gyan.dev
    if curl $curl_opts -o "$tmpdir/ffmpeg.zip" \
      "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"; then
      dl_ok=true
    fi
  fi

  if [ "$dl_ok" != true ]; then
    fail "FFmpeg download failed from all sources"
    return 1
  fi

  # 验证下载文件存在且大于 1MB
  local zip_size
  zip_size=$(stat -c%s "$tmpdir/ffmpeg.zip" 2>/dev/null || stat -f%z "$tmpdir/ffmpeg.zip" 2>/dev/null || echo 0)
  if [ "$zip_size" -lt 1048576 ]; then
    fail "FFmpeg zip too small (${zip_size} bytes) — likely download failed"
    return 1
  fi
  log "  → ffmpeg.zip downloaded ($((zip_size / 1048576))MB)"

  log "extracting ffmpeg + ffprobe ..."
  # 用 Python 解压 (CI 和 Windows 上都可用)
  $PYTHON -c "
import zipfile, os, sys
z = zipfile.ZipFile('$tmpdir/ffmpeg.zip')
# 使用正斜杠兼容 Windows
for f in z.namelist():
    base = os.path.basename(f)
    if base.lower() in ('ffmpeg.exe', 'ffprobe.exe'):
        with z.open(f) as src, open(os.path.join('$TOOLS_DIR', base), 'wb') as dst:
            dst.write(src.read())
        print(f'extracted: {base}')
" || { fail "FFmpeg extraction failed"; return 1; }

  rm -rf "$tmpdir"
  log "  → ffmpeg.exe + ffprobe.exe OK"
}

# 2. Node.js 20.18.1
download_node() {
  download \
    "https://nodejs.org/dist/v20.18.1/win-x64/node.exe" \
    "node.exe" \
    80000   # ~80MB, 用于体积校验
}

# 3. Python 3.12.4 embeddable
download_python() {
  local py_exe="$TOOLS_DIR/python.exe"
  if [ "$FORCE" != true ] && [ -f "$py_exe" ]; then
    local sz
    sz=$(stat -c%s "$py_exe" 2>/dev/null || stat -f%z "$py_exe" 2>/dev/null || echo 0)
    if [ "$sz" -gt 1024 ]; then skip "python.exe"; return 0; fi
  fi

  local tmpdir="$TOOLS_DIR/.py-tmp"
  rm -rf "$tmpdir"
  mkdir -p "$tmpdir"

  log "downloading Python 3.12.4 embed ..."
  curl -Lf -# -o "$tmpdir/python.zip" \
    "https://www.python.org/ftp/python/3.12.4/python-3.12.4-embed-amd64.zip" \
    || { fail "Python download failed"; return 1; }

  $PYTHON -c "
import zipfile
z = zipfile.ZipFile('$tmpdir/python.zip')
for f in z.namelist():
    if f.lower() == 'python.exe':
        with z.open(f) as src, open('$TOOLS_DIR/python.exe', 'wb') as dst:
            dst.write(src.read())
        print('extracted: python.exe')
    elif f.lower().endswith('.dll'):
        with z.open(f) as src, open('$TOOLS_DIR/' + f.split('/')[-1], 'wb') as dst:
            dst.write(src.read())
# 也提取 python312.zip (标准库)
z.extractall('$TOOLS_DIR')
" || { fail "Python extraction failed"; return 1; }

  rm -rf "$tmpdir"
  log "  → python.exe OK"
}

# 4. Whisper ggml-large-v3 (~1.5GB)
download_whisper() {
  if [ "$SKIP_LARGE" = true ]; then
    log "SKIP: whisper (--skip large)"
    return 0
  fi
  download \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin" \
    "ggml-large-v3.bin" \
    1600000  # ~1.5GB, 用于体积校验
}

# 5. VC++ Redist (跳过 — size=0, 安装时不需要复制)
download_vcredist() {
  log "SKIP: vcredist (size=0 in tools-versions.json)"
}

# ── 主流程 ────────────────────────────────────────────────

log "=== fetch-tools.sh start ==="
log "target: $TOOLS_DIR"

download_ffmpeg
download_node
download_python
download_whisper
download_vcredist

log "=== fetch-tools.sh done ==="
log ""
log "Files in $TOOLS_DIR:"
ls -lh "$TOOLS_DIR"/*.exe "$TOOLS_DIR"/*.bin 2>/dev/null || true
