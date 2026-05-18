#!/bin/bash
set -e

PORT=3033

cleanup() {
  echo "Cleaning up..."
  [ -n "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null
  wait $SERVER_PID 2>/dev/null
  echo "Done."
}
trap cleanup EXIT

echo "Starting API server on :$PORT..."
API_PORT=$PORT node api.js 2>/dev/null &
SERVER_PID=$!
SERVER_PID=$!

echo "Waiting for server..."
for i in $(seq 1 15); do
  if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "Server ready."
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "Server failed to start"
    exit 1
  fi
  sleep 1
done

# Run tests
echo ""
echo "Running API tests..."
API_URL="http://localhost:$PORT" node test/api-test.js
