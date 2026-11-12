#!/usr/bin/env bash
# End-to-end smoke test: Neon Postgres + session auth + trade CRUD.
# Starts the dev server, signs up a user (writes to Neon), checks the
# session, creates + lists a trade, then tears down.
set -u
cd /home/z/my-project

# Kill any stale dev server.
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
sleep 1

# Start dev server in background.
bun run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
echo "dev pid=$DEV_PID"

# Wait for the server to accept connections (up to ~40s).
READY=0
for i in $(seq 1 40); do
  if curl -s -m 2 -o /dev/null http://localhost:3000/login; then
    READY=1; break
  fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "FAIL: dev server did not become ready"
  tail -20 /tmp/dev.log
  kill -9 $DEV_PID 2>/dev/null || true
  exit 1
fi
echo "dev server ready"

# Use a temp cookie jar so the session cookie persists across requests.
JAR=/tmp/fxm_cookies.txt
rm -f "$JAR"

EMAIL="smoke_$(date +%s)@test.local"
PASS="testpassword123"

echo "--- signup ---"
SIGNUP=$(curl -s -m 15 -c "$JAR" -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"displayName\":\"Smoke\"}")
echo "$SIGNUP" | head -c 300; echo

echo "--- me (expect user) ---"
curl -s -m 10 -b "$JAR" http://localhost:3000/api/auth/me | head -c 200; echo

echo "--- create trade ---"
TRADE=$(curl -s -m 15 -b "$JAR" -X POST http://localhost:3000/api/trades \
  -H "Content-Type: application/json" \
  -d '{"pair":"EURUSD","direction":"buy","entry_price":1.085,"stop_loss":1.08,"lot_size":0.5,"opened_at":"2026-01-01T08:00:00Z","closed_at":"2026-01-01T12:00:00Z","pnl":120,"risk_amount":50,"timeframe":"H1"}')
echo "$TRADE" | head -c 300; echo

echo "--- list trades (expect 1) ---"
curl -s -m 10 -b "$JAR" "http://localhost:3000/api/trades?limit=5" | head -c 400; echo

echo "--- risk-report ---"
curl -s -m 10 -b "$JAR" http://localhost:3000/api/trades/risk-report | head -c 300; echo

echo "--- exposure ---"
curl -s -m 10 -b "$JAR" http://localhost:3000/api/trades/exposure | head -c 300; echo

echo "--- logout ---"
curl -s -m 10 -b "$JAR" -X POST http://localhost:3000/api/auth/logout | head -c 100; echo

echo "--- me after logout (expect 401 / null) ---"
curl -s -m 10 -b "$JAR" -o /dev/null -w "status=%{http_code}\n" http://localhost:3000/api/auth/me

kill -9 $DEV_PID 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
echo "DONE"
