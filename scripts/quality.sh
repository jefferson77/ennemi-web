#!/bin/bash
# Quality gate: runs qlty's linters, formatters, security scanners and maintainability checks.
# Usage: ./scripts/quality.sh [--fix]
#
#   (no flag)  Read-only. Exits non-zero if anything is wrong. This is `make quality`.
#   --fix      Autoformats and applies safe lint fixes, then reports what is left by hand.
#
# Configuration lives in .qlty/qlty.toml.

set -euo pipefail

cd "$(dirname "$0")/.."

# qlty installs to ~/.qlty/bin, which is not always on PATH.
QLTY="${QLTY:-$(command -v qlty || echo "$HOME/.qlty/bin/qlty")}"

if [ ! -x "$QLTY" ]; then
    echo "✗ qlty not found. Install it with:  curl https://qlty.sh | bash"
    exit 1
fi

FIX=false
if [ "${1:-}" = "--fix" ]; then
    FIX=true
elif [ $# -gt 0 ]; then
    echo "✗ Unknown option: $1 (try --fix)"
    exit 1
fi

echo "=========================================="
if [ "$FIX" = true ]; then
    echo "Fixing what can be fixed automatically..."
else
    echo "Running the quality gate..."
fi
echo "=========================================="

FAILED=false

if [ "$FIX" = true ]; then
    echo ""
    echo "Step 1/3: Lint fixes (eslint)..."
    echo "----------------------------------------"
    # Deliberately NOT `qlty check --fix`. qlty's eslint driver does not pass --fix; it
    # applies the fix ranges from eslint's JSON output itself, and gets the offsets wrong
    # when several fixes land in one file -- which silently destroys surrounding code.
    # eslint's own fixer handles overlapping fixes correctly. Keep it this way.
    npx --no-install eslint --fix . || true

    echo ""
    echo "Step 2/3: Formatting (prettier, shfmt, markdownlint)..."
    echo "----------------------------------------"
    # Runs after eslint so prettier has the last word on layout.
    "$QLTY" fmt --all

    echo ""
    echo "Step 3/3: Verifying nothing was mangled..."
    echo "----------------------------------------"
    CHANGED=$(git diff --name-only -- '*.mjs' '*.js')
    if [ -n "$CHANGED" ]; then
        # shellcheck disable=SC2086
        if npx --no-install prettier --check $CHANGED 2>&1 | grep -q "SyntaxError"; then
            echo "✗ A fix produced unparseable code. Inspect and revert these files:"
            # shellcheck disable=SC2086
            npx --no-install prettier --check $CHANGED 2>&1 | grep "SyntaxError"
            exit 1
        fi
    fi
    echo "✓ All modified source files still parse."

    echo ""
    echo "✓ Auto-fixes applied. Review with: git diff    then run: make quality"
    exit 0
fi

echo ""
echo "Step 1/2: Lint, format and security (qlty check)..."
echo "----------------------------------------"
# --no-fix keeps the gate read-only: a gate that rewrites your working tree is a bad gate.
if ! "$QLTY" check --all --no-fix; then
    FAILED=true
fi

echo ""
echo "Step 2/2: Maintainability (qlty smells)..."
echo "----------------------------------------"
# `qlty smells` exits 0 even when it finds something, so count the findings ourselves.
SMELLS=$("$QLTY" smells --all --sarif 2>/dev/null | grep -c '"ruleId"' || true)
"$QLTY" smells --all --no-snippets --quiet || true

if [ "$SMELLS" -gt 0 ]; then
    echo ""
    echo "✗ $SMELLS maintainability issue(s). Refactor, or adjust the thresholds"
    echo "  under [smells.*] in .qlty/qlty.toml if they are wrong for this project."
    FAILED=true
else
    echo "✓ No maintainability issues."
fi

echo ""
echo "=========================================="
if [ "$FAILED" = true ]; then
    echo "✗ Quality gate failed. Try: make quality-fix   for the mechanical ones."
    echo "=========================================="
    exit 1
fi
echo "✓ Quality gate passed."
echo "=========================================="
