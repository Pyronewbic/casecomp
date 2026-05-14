#!/bin/sh
# Post-build smoke tests for the custom Node 24 base image
# Run: docker run --rm --entrypoint node <image> /app/test.sh
# Or called from CI after docker load

IMAGE="$1"
PASS=0
FAIL=0

check() {
  DESC="$1"; shift
  if OUTPUT=$(docker run --rm "$IMAGE" "$@" 2>&1); then
    echo "  PASS: $DESC"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $DESC — $OUTPUT"
    FAIL=$((FAIL + 1))
  fi
}

check_contains() {
  DESC="$1"; EXPECT="$2"; shift 2
  OUTPUT=$(docker run --rm "$IMAGE" "$@" 2>&1)
  if echo "$OUTPUT" | grep -q "$EXPECT"; then
    echo "  PASS: $DESC"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $DESC — expected '$EXPECT', got '$OUTPUT'"
    FAIL=$((FAIL + 1))
  fi
}

check_fails() {
  DESC="$1"; shift
  if docker run --rm --entrypoint "$1" "$IMAGE" "${@:2}" >/dev/null 2>&1; then
    echo "  FAIL: $DESC — should have failed but succeeded"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $DESC"
    PASS=$((PASS + 1))
  fi
}

echo "Node 24 base image tests"
echo "Image: $IMAGE"
echo ""

# Node version
check_contains "node version is 24.x" "v24" --version

# npm available
check_contains "npm available" "11." -e "const {execSync}=require('child_process');console.log(execSync('npm --version').toString().trim())"

# no shell
check_fails "no sh" sh -c "echo hi"
check_fails "no bash" bash -c "echo hi"

# non-root user
check_contains "runs as non-root" "65532" -e "console.log(process.getuid())"

# can create and write files in /tmp
check "can write to /tmp" -e "require('fs').writeFileSync('/tmp/test','ok');console.log('ok')"

# crypto works (needed for API key hashing)
check_contains "crypto SHA256" "9f86d0" -e "console.log(require('crypto').createHash('sha256').update('test').digest('hex').slice(0,6))"

# HTTPS works (needed for TCGdex, eBay, etc.)
check "HTTPS fetch works" -e "fetch('https://api.tcgdex.net/v2/en/cards?limit=1').then(r=>{console.log(r.status);process.exit(r.ok?0:1)})"

# can resolve DNS
check "DNS resolution" -e "require('dns').resolve('google.com',(e,a)=>{console.log(e?'fail':'ok');process.exit(e?1:0)})"

echo ""
echo "$PASS passed, $FAIL failed"
exit $FAIL
