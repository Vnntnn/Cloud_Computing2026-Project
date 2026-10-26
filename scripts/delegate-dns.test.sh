#!/usr/bin/env bash
# Tests scripts/delegate-dns.sh against a local mock of Cloudflare's API and of DNS-over-HTTPS
# (no network, no terraform, no token). The mock keeps the NS records as state and answers the
# "published" lookup from them, so a successful sync also makes the delegation visible.
#
#   bash scripts/delegate-dns.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'kill $SRV 2>/dev/null; rm -rf "$TMP"' EXIT
fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }

cat > "$TMP/mock.py" <<'PY'
import json, sys, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
port, logf = int(sys.argv[1]), sys.argv[2]
records = {"r1": "ns-1.example.net", "r2": "ns-old.example.net"}   # id -> content at Cloudflare
nxt = [3]
def log(s):
    open(logf, "a").write(s + "\n")
class H(BaseHTTPRequestHandler):
    def reply(self, body, code=200):
        b = json.dumps(body).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def auth(self):
        a = self.headers.get("Authorization", "")
        log("auth " + ("ok" if a == "Bearer test-token" else "MISSING"))
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == "/dns-query":
            log("doh")
            self.reply({"Answer": [{"type": 2, "data": v + "."} for v in records.values()]})
        elif u.path == "/zones":
            self.auth(); log("zones " + q["name"][0]); self.reply({"success": True, "result": [{"id": "z1"}]})
        elif u.path == "/zones/z1/dns_records":
            self.auth(); self.reply({"success": True, "result": [{"id": i, "content": c} for i, c in records.items()]})
        else:
            self.reply({"success": False, "errors": ["nope"]}, 404)
    def do_DELETE(self):
        self.auth(); i = self.path.rsplit("/", 1)[1]; log("delete " + records.pop(i)); self.reply({"success": True, "result": {"id": i}})
    def do_POST(self):
        self.auth(); body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        assert body["type"] == "NS" and body["name"] == "eventide.example.com", body
        records["n%d" % nxt[0]] = body["content"]; nxt[0] += 1; log("create " + body["content"]); self.reply({"success": True, "result": {}})
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", port), H).serve_forever()
PY

PORT=$((20000 + RANDOM % 20000)); LOG="$TMP/log"; : > "$LOG"
python3 "$TMP/mock.py" "$PORT" "$LOG" & SRV=$!
for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$PORT/dns-query" >/dev/null 2>&1 && break; sleep 0.1; done
: > "$LOG"
run() { env DELEGATE_HOST=eventide.example.com WANT_NS="ns-1.example.net ns-2.example.net NS-3.example.net ns-4.example.net." \
  DOH_URL="http://127.0.0.1:$PORT/dns-query" CF_API_BASE="http://127.0.0.1:$PORT" DELEGATE_WAIT=30 "$@" bash "$ROOT/scripts/delegate-dns.sh" </dev/null; }

# 1. a token replaces the records: keep ns-1, delete ns-old, create the other three
OUT="$(run CLOUDFLARE_API_TOKEN=test-token 2>&1)"; RC=$?
[ "$RC" = 0 ] && ok "sync with a token exits 0" || bad "sync exits $RC: $OUT"
echo "$OUT" | grep -q "kept 1, deleted 1, created 3" && ok "kept 1, deleted 1, created 3" || bad "counts: $OUT"
grep -qx "delete ns-old.example.net" "$LOG" && ok "removed the stale record" || bad "stale record kept"
[ "$(grep -c '^create ' "$LOG")" = 3 ] && ok "created the 3 missing" || bad "creates: $(grep '^create ' "$LOG")"
! grep -q "auth MISSING" "$LOG" && grep -q "auth ok" "$LOG" && ok "the token was sent as a Bearer header" || bad "token header wrong"
echo "$OUT" | grep -q "test-token" && bad "the token leaked into the output" || ok "the token is not printed"

# 2. now delegated: nothing is changed, Cloudflare is not called
: > "$LOG"
OUT="$(run CLOUDFLARE_API_TOKEN=test-token 2>&1)"; RC=$?
[ "$RC" = 0 ] && echo "$OUT" | grep -q "already delegated" && ok "already delegated: no-op" || bad "second run: rc=$RC $OUT"
! grep -qE "^(zones|delete|create)" "$LOG" && ok "no Cloudflare writes when already correct" || bad "wrote when nothing to do"

# 3. no token, not a terminal, wrong NS: prints the names and exits 3
kill $SRV 2>/dev/null; python3 "$TMP/mock.py" "$PORT" "$LOG" & SRV=$!   # fresh state (stale records again)
for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$PORT/dns-query" >/dev/null 2>&1 && break; sleep 0.1; done
OUT="$(run 2>&1)"; RC=$?
[ "$RC" = 3 ] && ok "no token and no terminal: exit 3" || bad "exit $RC"
echo "$OUT" | grep -q "ns-4.example.net" && echo "$OUT" | grep -q "exactly these 4" && ok "prints the 4 name servers to paste" || bad "instructions: $OUT"

[ "$fail" = 0 ] && echo "all passed" || { echo "FAILED"; exit 1; }
