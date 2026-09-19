#!/usr/bin/env bash
# Manual verification script for the Vehicle Logs API contract.
# Runs against a locally running dev server (npm run dev) on port 5000.
# Default credentials: driver1 / delicate2024.
#
# Usage:
#   ./scripts/verify-vehicle-logs.sh                  # full happy-path + negatives
#   BASE_URL=http://localhost:5000 ./scripts/verify-vehicle-logs.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5000}"
USERNAME="${DRIVER_USERNAME:-driver1}"
PASSWORD="${DRIVER_PASSWORD:-delicate2024}"
PHOTO="data:image/jpeg;base64,/9j="

pass() { printf "  [PASS] %s\n" "$1"; }
fail() { printf "  [FAIL] %s (got %s, expected %s)\n" "$1" "$2" "$3"; exit 1; }

assert_status() { # name actual expected
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "$2" "$3"; fi
}

echo "==> Login as $USERNAME"
TOKEN=$(curl -s -X POST "$BASE_URL/api/driver/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
[ -n "$TOKEN" ] || { echo "Login failed"; exit 1; }
echo "  Token acquired."

echo "==> Close any pre-existing active trip (best effort)"
EXISTING=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/driver/trips/active" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['trip']['id'] if d.get('trip') else '')")
if [ -n "$EXISTING" ]; then
  curl -s -o /dev/null -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"endOdometer\":99999999,\"endFuelLevel\":\"E\",\"endClusterPhoto\":\"$PHOTO\"}" \
    "$BASE_URL/api/driver/trips/$EXISTING/end" || true
fi

echo "==> Start trip without cluster photo (expect 400)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"startOdometer":50000,"startFuelLevel":"3/4"}' \
  "$BASE_URL/api/driver/trips/start")
assert_status "Start without photo → 400" "$CODE" "400"

echo "==> Start trip with all required fields (expect 201)"
RESP=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"startOdometer\":50000,\"startFuelLevel\":\"3/4\",\"startClusterPhoto\":\"$PHOTO\"}" \
  "$BASE_URL/api/driver/trips/start")
TRIP_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['trip']['id'])")
STATUS=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['trip']['status'])")
[ "$STATUS" = "active" ] && pass "Trip active (id=$TRIP_ID)" || fail "Trip status" "$STATUS" "active"

echo "==> Add fuel expense without receipt (expect 400)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expenseType":"fuel","amount":850,"litres":42}' \
  "$BASE_URL/api/driver/trips/$TRIP_ID/expenses")
assert_status "Fuel without receipt → 400" "$CODE" "400"

echo "==> Add fuel expense with receipt (expect 201)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"expenseType\":\"fuel\",\"amount\":850,\"litres\":42,\"receiptUrl\":\"$PHOTO\"}" \
  "$BASE_URL/api/driver/trips/$TRIP_ID/expenses")
assert_status "Fuel with receipt → 201" "$CODE" "201"

echo "==> Add toll expense without receipt (expect 201)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expenseType":"toll","amount":15}' \
  "$BASE_URL/api/driver/trips/$TRIP_ID/expenses")
assert_status "Toll without receipt → 201" "$CODE" "201"

echo "==> Invalid expenseType (expect 400)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expenseType":"bribe","amount":100}' \
  "$BASE_URL/api/driver/trips/$TRIP_ID/expenses")
assert_status "Invalid expenseType → 400" "$CODE" "400"

echo "==> Add stop without stopType (expect 400)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"stopKey":"WB-001"}' \
  "$BASE_URL/api/driver/trips/$TRIP_ID/stops")
assert_status "Stop without stopType → 400" "$CODE" "400"

echo "==> Add stop with stopType (expect 201)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"stopKey":"WB-001","stopType":"delivery","photoUrl":"'"$PHOTO"'"}' \
  "$BASE_URL/api/driver/trips/$TRIP_ID/stops")
assert_status "Stop with stopType → 201" "$CODE" "201"

echo "==> End trip (expect 200, status closed)"
RESP=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"endOdometer\":50100,\"endFuelLevel\":\"1/2\",\"endClusterPhoto\":\"$PHOTO\"}" \
  "$BASE_URL/api/driver/trips/$TRIP_ID/end")
STATUS=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['trip']['status'])")
[ "$STATUS" = "closed" ] && pass "Trip closed" || fail "End status" "$STATUS" "closed"

echo "==> Add expense to closed trip (expect 409)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expenseType":"toll","amount":10}' \
  "$BASE_URL/api/driver/trips/$TRIP_ID/expenses")
assert_status "Expense on closed trip → 409" "$CODE" "409"

echo "==> Add stop to closed trip (expect 409)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"stopKey":"WB-002","stopType":"pickup"}' \
  "$BASE_URL/api/driver/trips/$TRIP_ID/stops")
assert_status "Stop on closed trip → 409" "$CODE" "409"

echo
echo "All Vehicle Logs API checks passed."
