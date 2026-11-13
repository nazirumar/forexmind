#!/usr/bin/env bash
# Create a secret-free git bundle of the project for the user to push to GitHub.
set -euo pipefail
cd /home/z/my-project

echo "=== creating git bundle (all refs on main) ==="
mkdir -p download
rm -f download/forexmind.bundle
git bundle create download/forexmind.bundle --all
echo ""
echo "=== bundle heads ==="
git bundle list-heads download/forexmind.bundle
echo ""

echo "=== verify bundle is secret-free by cloning it to a temp dir ==="
rm -rf .bundle-verify-tmp
git clone --quiet download/forexmind.bundle .bundle-verify-tmp
(
  cd .bundle-verify-tmp
  n_env_hist=$(git log --all --oneline -- .env | wc -l)
  n_env_tracked=$(git ls-files | grep -c '^\.env$' || true)
  echo ".env in bundled history : $n_env_hist  (must be 0)"
  echo ".env tracked in bundle  : $n_env_tracked  (must be 0)"
  echo "scanning all bundled blobs for the Neon password pattern..."
  leak=0
  git rev-list --objects --all | awk '{print $1}' | sort -u | while read -r o; do
    t=$(git cat-file -t "$o" 2>/dev/null || true)
    if [ "$t" = "blob" ]; then
      if git cat-file -p "$o" 2>/dev/null | grep -q "postgresql://[^[:space:]]*@[^\n]*neon\|DATABASE_URL=postgresql://"; then
        echo "  LEAK in blob $o"
      fi
    fi
  done
  echo "(no 'LEAK in blob' lines above = bundle is clean)"
)
rm -rf .bundle-verify-tmp
echo ""
echo "=== bundle ready ==="
ls -la download/forexmind.bundle
