#!/usr/bin/env bash
# Render check: confirm the redesigned dashboard renders server-side
# with the new hero + tool sections (signed in).
set -u
cd /home/z/my-project
pkill -9 -f "next" 2>/dev/null || true
sleep 1
bun run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
READY=0
for i in $(seq 1 40); do
  curl -s -m 2 -o /dev/null http://localhost:3000/login && { READY=1; break; }
  sleep 1
done
[ "$READY" = "1" ] || { echo "FAIL ready"; tail -15 /tmp/dev.log; kill -9 $DEV_PID 2>/dev/null; exit 1; }

JAR=/tmp/fxm_render.txt; rm -f "$JAR"
E="render_$(date +%s)@test.local"
curl -s -m 15 -c "$JAR" -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$E\",\"password\":\"testpassword123\"}" -o /dev/null

echo "=== dashboard status ==="
curl -s -m 15 -b "$JAR" -o /dev/null -w "GET / -> %{http_code}\n" http://localhost:3000/

echo "=== new dashboard sections present? ==="
curl -s -m 15 -b "$JAR" http://localhost:3000/ \
  | grep -o "Trade more deliberately\|Your daily workflow\|Live FX rates\|Plan &amp; analyze\|Market &amp; alerts\|What ForexMind does\|Open journal\|Risk dashboard\|text-gradient" \
  | sort -u

kill -9 $DEV_PID 2>/dev/null || true
pkill -9 -f "next" 2>/dev/null || true
echo "DONE"
