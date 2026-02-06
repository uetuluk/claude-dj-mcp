#!/bin/bash
set -e

echo "=== Claude DJ MCP Setup ==="

# Clone strudel if not present
if [ ! -d "strudel" ]; then
  echo "Cloning strudel..."
  git clone --depth 1 https://codeberg.org/uzu/strudel strudel
else
  echo "strudel/ already exists, skipping clone."
fi

echo "Patching strudel packages..."

# Patch workspace:* references for npm compatibility
# mini depends on core
if grep -q '"workspace:\*"' strudel/packages/mini/package.json 2>/dev/null; then
  sed -i.bak 's/"workspace:\*"/"file:..\/core"/g' strudel/packages/mini/package.json
  rm -f strudel/packages/mini/package.json.bak
  echo "  Patched mini/package.json"
fi

# tonal depends on core
if grep -q '"workspace:\*"' strudel/packages/tonal/package.json 2>/dev/null; then
  sed -i.bak 's/"workspace:\*"/"file:..\/core"/g' strudel/packages/tonal/package.json
  rm -f strudel/packages/tonal/package.json.bak
  echo "  Patched tonal/package.json"
fi

# transpiler depends on core and mini
if grep -q '"workspace:\*"' strudel/packages/transpiler/package.json 2>/dev/null; then
  sed -i.bak \
    -e 's/"@strudel\/core": "workspace:\*"/"@strudel\/core": "file:..\/core"/g' \
    -e 's/"@strudel\/mini": "workspace:\*"/"@strudel\/mini": "file:..\/mini"/g' \
    strudel/packages/transpiler/package.json
  rm -f strudel/packages/transpiler/package.json.bak
  echo "  Patched transpiler/package.json"
fi

# Patch superdough.mjs: replace Vite-specific worklets import
SUPERDOUGH="strudel/packages/superdough/superdough.mjs"
if grep -q "import workletsUrl from './worklets.mjs?audioworklet'" "$SUPERDOUGH" 2>/dev/null; then
  sed -i.bak "s|import workletsUrl from './worklets.mjs?audioworklet';|// Patched: worklets.mjs?audioworklet is a Vite-specific import that fails in Node.\n// workletsUrl is only used when disableWorklets is false, which we never do server-side.\nconst workletsUrl = null;|" "$SUPERDOUGH"
  rm -f "$SUPERDOUGH.bak"
  echo "  Patched superdough.mjs (worklets import)"
fi

# Patch helpers.mjs: wrap double-stop cleanup in try-catch
HELPERS="strudel/packages/superdough/helpers.mjs"
if grep -q 'node.start(node.context.currentTime + 5);' "$HELPERS" 2>/dev/null && ! grep -q 'try {' "$HELPERS" 2>/dev/null; then
  # Use a temporary Python script for the multi-line replacement since sed can't handle it cleanly
  python3 -c "
import re
with open('$HELPERS', 'r') as f:
    content = f.read()
old = '''      node.start(node.context.currentTime + 5); // will never happen
      node.stop();'''
new = '''      try {
        node.start(node.context.currentTime + 5); // will never happen
        node.stop();
      } catch (_e2) {
        // Node was already started+stopped (e.g. in OfflineAudioContext after rendering) — ignore
      }'''
content = content.replace(old, new)
with open('$HELPERS', 'w') as f:
    f.write(content)
" 2>/dev/null && echo "  Patched helpers.mjs (double-stop try-catch)" || echo "  helpers.mjs patch skipped (may already be patched or python3 not available)"
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Build
echo "Building..."
npm run build

echo ""
echo "=== Setup complete ==="
echo "Run: node dist/index.js"
