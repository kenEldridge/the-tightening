#!/bin/bash
# Test Ollama sheet music OCR with frames extracted from the video
# Usage: bash test-ollama-ocr.sh [timestamp_seconds]
#
# Extracts a frame at the given timestamp (default: 60s) and sends it to Ollama

OLLAMA_URL="http://172.27.224.1:11434"
VIDEO="/home/ken/.config/the-tightening/extracted-audio/i1AMYsR7xHQ.mp4"
FRAMES_DIR="/tmp/claude-test-frames"
mkdir -p "$FRAMES_DIR"

# Timestamps to test - spread across the video
TIMESTAMPS="${1:-30 60 90 120 180 240}"

echo "=== Ollama OCR Test ==="
echo "Ollama: $OLLAMA_URL"
echo "Video: $VIDEO"
echo ""

# Check Ollama is up
echo "Checking Ollama..."
VERSION=$(curl -s --connect-timeout 5 "$OLLAMA_URL/api/version" 2>&1)
if [ $? -ne 0 ]; then
    echo "ERROR: Cannot connect to Ollama at $OLLAMA_URL"
    exit 1
fi
echo "Ollama version: $VERSION"
echo ""

# Check models
echo "Available models:"
curl -s "$OLLAMA_URL/api/tags" | python3 -c "import sys,json; [print(f'  - {m[\"name\"]}') for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null
echo ""

for TS in $TIMESTAMPS; do
    FRAME="$FRAMES_DIR/frame_${TS}s.jpg"

    echo "--- Frame at ${TS}s ---"

    # Extract frame with ffmpeg
    ffmpeg -ss "$TS" -i "$VIDEO" -vframes 1 -q:v 2 "$FRAME" -y 2>/dev/null

    if [ ! -f "$FRAME" ]; then
        echo "  SKIP: Could not extract frame at ${TS}s"
        continue
    fi

    SIZE=$(stat -c%s "$FRAME" 2>/dev/null || stat -f%z "$FRAME" 2>/dev/null)
    echo "  Frame size: ${SIZE} bytes"

    # Convert to base64
    B64=$(base64 -w0 "$FRAME")

    # Send to Ollama
    echo "  Sending to Ollama llava..."

    RESPONSE=$(curl -s --max-time 120 "$OLLAMA_URL/api/generate" \
        -H "Content-Type: application/json" \
        -d "$(python3 -c "
import json
print(json.dumps({
    'model': 'llava',
    'prompt': 'Analyze this image. Is there sheet music or musical notation visible? If yes, list the notes you can see with their names (like C4, D4, E4). If no sheet music is visible, describe what you see briefly. Respond with JSON: {\"has_sheet_music\": true/false, \"notes\": [\"C4\", \"D4\"], \"description\": \"...\"}',
    'images': ['$B64'],
    'stream': False
}))
")")

    # Extract the response text
    RESP_TEXT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('response','ERROR: No response'))" 2>/dev/null)

    if [ -z "$RESP_TEXT" ]; then
        echo "  ERROR: Empty response from Ollama"
        echo "  Raw: $(echo "$RESPONSE" | head -c 200)"
    else
        echo "  Response:"
        echo "$RESP_TEXT" | sed 's/^/    /'
    fi
    echo ""
done

echo "=== Done ==="
echo "Frames saved in: $FRAMES_DIR"
echo "You can view them to see what Ollama was looking at."
