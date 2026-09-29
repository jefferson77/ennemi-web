#!/usr/bin/env bash
#
# Convert green-screen .mov clips to VP9/WebM with baked alpha.
# Samples the top-left pixel of frame 0 to auto-detect the green key color.
#
# Usage: bash scripts/convert-morceau-clips.sh
#
# Source .mov masters are not committed: drop them in public/morceau/video/Clips/ first.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC_DIR="public/morceau/video/Clips"
OUT_DIR="public/morceau/video"

declare -A MAP=(
    ["01_Intro_v_courte.mov"]="01_intro.webm"
    ["02_boucle attente lecture.mov"]="02_attente_lecture.webm"
    ["03_à ton avis.mov"]="03_a_ton_avis.webm"
    ["04_boucle attente vote.mov"]="04_attente_vote.webm"
    ["05_fin.mov"]="05_fin.webm"
)

for src_name in "${!MAP[@]}"; do
    src="$SRC_DIR/$src_name"
    out="$OUT_DIR/${MAP[$src_name]}"

    if [[ ! -f $src ]]; then
        echo "  skip (missing): $src" >&2
        continue
    fi

    echo "==> $src_name"

    # Sample top-left pixel of first frame as RGB hex.
    # Two steps: extract first frame to PNG, then read pixel (0,0).
    TMP_FRAME=$(mktemp --suffix=.png)
    trap 'rm -f "$TMP_FRAME"' EXIT
    ffmpeg -y -hide_banner -loglevel error -i "$src" -frames:v 1 "$TMP_FRAME"
    HEX=$(ffmpeg -hide_banner -loglevel error -i "$TMP_FRAME" \
        -vf "crop=1:1:0:0,format=rgb24" -f rawvideo - |
        xxd -p -c 256 | tr -d '\n' | cut -c1-6)
    rm -f "$TMP_FRAME"

    if [[ -z $HEX || ${#HEX} -ne 6 ]]; then
        echo "    ERROR: failed to sample key color from $src" >&2
        exit 1
    fi

    echo "    key color: 0x$HEX"

    # Encode VP9/WebM with alpha.
    # - `format=yuva420p` at the end of the filter chain pins alpha into the encoder input.
    # - `-metadata:s:v:0 alpha_mode=1` marks alpha in the WebM container so browsers honor it.
    # - `-auto-alt-ref 0` is required for VP9 alpha.
    ffmpeg -y -hide_banner -loglevel warning -stats \
        -i "$src" \
        -vf "chromakey=0x${HEX}:0.10:0.08,despill=type=green:mix=0.5,scale=720:-2,format=yuva420p" \
        -c:v libvpx-vp9 -pix_fmt yuva420p -metadata:s:v:0 alpha_mode=1 \
        -b:v 1500k -auto-alt-ref 0 \
        -c:a libopus -b:a 96k -ac 2 \
        "$out"

    echo "    -> $out"
done

echo
echo "Done."
ls -lh "$OUT_DIR"/*.webm 2>/dev/null || true
