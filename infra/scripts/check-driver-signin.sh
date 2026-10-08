#!/usr/bin/env bash
#
# Check everything the driver app needs to sign in, BEFORE spending twenty minutes on a build
# that cannot.
#
#   infra/scripts/check-driver-signin.sh driver@delicatecourier.co.za
#
# It asks for the password rather than taking it as an argument, so it stays out of your shell
# history and out of `ps`. Pass PROFILE=production to check that profile instead of preview.
#
# It checks the values a build would actually be compiled with. Those can live in two places,
# and it looks in both: the profile's `env` in apps/driver/eas.json, or — if you keep them on
# Expo's servers with `eas env:create` — whatever you export before running this:
#
#   EXPO_PUBLIC_SUPABASE_URL=… EXPO_PUBLIC_SUPABASE_ANON_KEY=… infra/scripts/check-driver-signin.sh you@…
#
# With the values in hand it walks the chain in the order it breaks:
#
#   1. the values are real, not a placeholder somebody pasted without filling in
#   2. the anon key belongs to the project the URL names
#   3. the project is up and accepts that key
#   4. the account exists, is confirmed, and the password works
#   5. the engine is configured to verify tokens signed by that project
#   6. the engine actually accepts a real token and knows this login is a driver
#
# Every one of those has cost somebody a build, and none of them needs a phone to find.
# Step 6 is the only one that proves the whole chain; the first five exist to tell you which
# link is broken when it does not.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

EMAIL="${1:-}"
PROFILE="${PROFILE:-preview}"
EAS="apps/driver/eas.json"
ENV_FILE="infra/docker/.env"

if [[ -t 1 ]]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; X=$'\033[0m'
else
  G=""; R=""; Y=""; B=""; X=""
fi
FAILED=0
ok()   { printf '  %s✓%s %s\n' "$G" "$X" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$R" "$X" "$*"; FAILED=1; }
warn() { printf '  %s!%s %s\n' "$Y" "$X" "$*"; }
note() { printf '      %s\n' "$*"; }
step() { printf '\n%s%s%s\n' "$B" "$*" "$X"; }

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }
[[ -f "$EAS" ]] || { echo "no $EAS — run this from the repository root"; exit 1; }

# NUL-separated, not one per line: a value pasted with a line break in it would otherwise be
# read as two fields and shift everything after it, so a wrapped key would be reported as an
# empty one. An empty value stays an empty field. `-` means the key is absent altogether,
# which is a different problem from being present and blank.
mapfile -d '' -t VALUES < <(
  PROFILE="$PROFILE" python3 -I - "$EAS" <<'PY'
import json, os, sys

try:
    build = json.load(open(sys.argv[1])).get("build", {})
except (OSError, ValueError) as err:
    sys.stdout.write(f"!{err}\0")
    raise SystemExit(0)
profile = os.environ["PROFILE"]
if profile not in build:
    sys.stdout.write(f"!no '{profile}' profile in {sys.argv[1]}\0")
    raise SystemExit(0)
env = build[profile].get("env", {})
for key in ("EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY", "EXPO_PUBLIC_API_URL"):
    value = env[key] if key in env else "-"
    sys.stdout.write(f"{value}\0")
PY
)
if [[ "${VALUES[0]:-}" == "!"* ]]; then
  printf '%s%s%s\n' "$R" "${VALUES[0]#!}" "$X"
  exit 1
fi

# An exported value wins over the file, because that is the only way to check a build whose
# values live on Expo's servers rather than in eas.json. Which source won gets printed, so a
# surprising result is traceable to the right place.
SOURCE_URL="$EAS"; SOURCE_ANON="$EAS"; SOURCE_API="$EAS"
SUPA_URL="${VALUES[0]}"
SUPA_ANON="${VALUES[1]}"
API_URL="${VALUES[2]}"
[[ -n "${EXPO_PUBLIC_SUPABASE_URL:-}" ]] && { SUPA_URL="$EXPO_PUBLIC_SUPABASE_URL"; SOURCE_URL="environment"; }
[[ -n "${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}" ]] && { SUPA_ANON="$EXPO_PUBLIC_SUPABASE_ANON_KEY"; SOURCE_ANON="environment"; }
[[ -n "${EXPO_PUBLIC_API_URL:-}" ]] && { API_URL="$EXPO_PUBLIC_API_URL"; SOURCE_API="environment"; }
SUPA_URL="${SUPA_URL%/}"
API_URL="${API_URL%/}"

# "-" is the sentinel for a key that is not there at all; an empty string means the key is
# present and blank, which EAS rejects outright. They are different problems, so show both.
shown() {
  case "$1" in
    "-") printf '(not set)' ;;
    "") printf '(empty)' ;;
    *) printf '%s' "$1" | tr '\n\r\t' '?' ;;
  esac
}

step "What a '$PROFILE' build would be compiled with"
note "engine    $(shown "$API_URL")   [$SOURCE_API]"
note "sign-in   $(shown "$SUPA_URL")   [$SOURCE_URL]"
if [[ -n "$SUPA_ANON" && "$SUPA_ANON" != "-" ]]; then
  note "anon key  ${SUPA_ANON:0:24}… (${#SUPA_ANON} chars)   [$SOURCE_ANON]"
else
  note "anon key  $(shown "$SUPA_ANON")   [$SOURCE_ANON]"
fi

# ── 1. real values, not a template ───────────────────────────────────────────
step "1. The values are filled in"
placeholder() { [[ "$1" == *xxxx* || "$1" == *"<"* || "$1" == *YOUR_* || "$1" == *"…"* || "$1" == *"..."* || "$1" == *your-project* ]]; }

if [[ "$SUPA_URL" == "-" ]]; then
  bad "EXPO_PUBLIC_SUPABASE_URL is set neither in the $PROFILE profile nor in the environment."
  note "Without it the app offers only the dev-token box, which a production engine refuses."
  note "Put it in the profile's env in $EAS, or export it here if you keep it in eas env:create."
elif [[ -z "$SUPA_URL" ]]; then
  bad "EXPO_PUBLIC_SUPABASE_URL is empty. EAS rejects empty env values — remove the key or fill it."
elif placeholder "$SUPA_URL"; then
  bad "EXPO_PUBLIC_SUPABASE_URL is still a placeholder: $SUPA_URL"
elif [[ "$SUPA_URL" != https://* ]]; then
  bad "EXPO_PUBLIC_SUPABASE_URL is not an https:// URL: $SUPA_URL"
else
  ok "sign-in URL is filled in"
fi

if [[ "$SUPA_ANON" == "-" ]]; then
  bad "EXPO_PUBLIC_SUPABASE_ANON_KEY is set neither in the $PROFILE profile nor in the environment."
  note "Put it in the profile's env in $EAS, or export it here if you keep it in eas env:create."
elif [[ -z "$SUPA_ANON" ]]; then
  bad "EXPO_PUBLIC_SUPABASE_ANON_KEY is empty. EAS rejects empty env values."
elif placeholder "$SUPA_ANON"; then
  bad "the anon key is a placeholder or was copied from an example, not from Supabase."
else
  # "Not a JWT" on its own is a dead end: the length usually looks right, so there is nothing
  # to go on. Say what the string actually is instead. A key copied from the dashboard before
  # clicking Reveal is the common one — the right length, made of bullets.
  shape=$(
    SUPA_ANON="$SUPA_ANON" python3 -I - <<'PY'
import os
import unicodedata

key = os.environ["SUPA_ANON"]
allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.")
odd = sorted({c for c in key if c not in allowed})
dots = key.count(".")

if odd:
    names = ", ".join(
        f"{unicodedata.name(c, 'U+%04X' % ord(c))} (U+{ord(c):04X})" for c in odd[:3]
    )
    print(f"!the key contains characters a JWT cannot: {names}.")
    if any(c in "\u2022\u00b7\u25cf\u2219*" for c in odd):
        print("@Those are mask characters. The dashboard hides the key until you press Reveal,")
        print("@and copying it while hidden gives you the right length made of dots or bullets.")
        print("@Supabase → Settings → API keys → Reveal, then copy.")
    elif any(c.isspace() for c in odd):
        print("@It picked up whitespace — a line break from a wrapped paste, most likely.")
    raise SystemExit(0)

if dots != 2:
    segs = [len(part) for part in key.split(".")]
    print(f"!the key has {dots} dots, not 2, so it is not a JWT. Section lengths: {segs}.")
    if dots > 2:
        print("@Two values look joined together. Copy just the anon key, on its own.")
    else:
        print("@It is truncated, or only part of it was selected.")
    raise SystemExit(0)

print("=anon key is shaped like a JWT")
PY
  )
  while IFS= read -r line; do
    case "$line" in
      "!"*) bad "${line#!}" ;;
      "@"*) note "${line#@}" ;;
      "="*) ok "${line#=}" ;;
    esac
  done <<<"$shape"
fi

if [[ "$API_URL" == "-" || -z "$API_URL" ]]; then
  warn "EXPO_PUBLIC_API_URL is not set; the app will fall back to app.json's simulator default."
  note "A phone cannot reach that. Set it to the engine's public URL."
elif placeholder "$API_URL"; then
  bad "EXPO_PUBLIC_API_URL is a placeholder: $API_URL"
else
  ok "engine URL is filled in"
fi

[[ "$FAILED" == "0" ]] || { printf '\n%sFix the above first — the later checks need real values.%s\n' "$R" "$X"; exit 1; }

# ── 2. the key belongs to that project ───────────────────────────────────────
step "2. The key belongs to the project the URL names"
PROJECT_REF=$(
  SUPA_URL="$SUPA_URL" SUPA_ANON="$SUPA_ANON" python3 -I - <<'PY'
import base64, json, os, sys


def payload_of(token):
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


url, key = os.environ["SUPA_URL"], os.environ["SUPA_ANON"]
try:
    claims = payload_of(key)
except Exception as err:  # noqa: BLE001 - any decode failure means the same thing
    print(f"!the anon key's payload will not decode ({err}). It is not a Supabase key.")
    raise SystemExit(0)

role = claims.get("role")
if role == "service_role":
    print("!that is the service_role key — the SECRET one. It must never be compiled into an app.")
    print("@Use the anon public key. If this one has shipped anywhere, rotate it.")
    raise SystemExit(0)
if role != "anon":
    print(f"!that key's role is {role!r}, not 'anon'.")
    raise SystemExit(0)

ref_in_key = claims.get("ref")
try:
    ref_in_url = url.split("//", 1)[1].split(".", 1)[0]
except IndexError:
    ref_in_url = None
if ref_in_key and ref_in_url and ref_in_key != ref_in_url:
    print(f"!the key belongs to project {ref_in_key!r} but the URL names {ref_in_url!r}.")
    print("@One of the two was pasted from a different project.")
    raise SystemExit(0)
print(f"={ref_in_key or ref_in_url}")
PY
)
while IFS= read -r line; do
  case "$line" in
    "!"*) bad "${line#!}" ;;
    "@"*) note "${line#@}" ;;
    "="*) ok "key and URL agree on project '${line#=}'"; PROJECT_REF="${line#=}" ;;
  esac
done <<<"$PROJECT_REF"

[[ "$FAILED" == "0" ]] || { printf '\n%sFix the above first.%s\n' "$R" "$X"; exit 1; }

# ── 3. the project answers ───────────────────────────────────────────────────
step "3. The project is up and accepts that key"
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
  -H "apikey: $SUPA_ANON" "$SUPA_URL/auth/v1/health" 2>/dev/null)
case "$code" in
  200) ok "the project answers and accepts this key" ;;
  401|403) bad "the project rejected the key ($code). It has probably been rotated." ;;
  000) bad "could not reach $SUPA_URL at all."
       note "A free Supabase project pauses after a week idle — open the dashboard and resume it." ;;
  404) bad "no auth service at $SUPA_URL (404). Check the project URL." ;;
  *)   bad "the project answered $code." ;;
esac

[[ "$FAILED" == "0" ]] || { printf '\n%sFix the above first.%s\n' "$R" "$X"; exit 1; }

# ── 4. the account ───────────────────────────────────────────────────────────
step "4. The driver can sign in"
if [[ -z "$EMAIL" ]]; then
  warn "no email given, so steps 4–6 were skipped."
  note "usage: $0 <driver-email>"
  printf '\n%sThe build values are sound, but nobody has been shown to sign in with them.%s\n' "$Y" "$X"
  exit 0
fi
if placeholder "$EMAIL"; then
  bad "'$EMAIL' is the placeholder from the usage line, not an address."
  note "Pass the driver's real email: $0 driver@delicatecourier.co.za"
  exit 1
fi

printf '  password for %s: ' "$EMAIL"
read -rs PASSWORD
printf '\n'
if [[ -z "$PASSWORD" ]]; then
  bad "no password entered."
  exit 1
fi

# The credentials go to curl via a file, not an argument: arguments are world-readable in `ps`
# for as long as the request takes, and this script exists to be run on a shared VPS.
BODY_FILE=$(mktemp)
RESP_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE" "$RESP_FILE"' EXIT
EMAIL="$EMAIL" PASSWORD="$PASSWORD" python3 -I -c \
  'import json, os, sys; sys.stdout.write(json.dumps({"email": os.environ["EMAIL"], "password": os.environ["PASSWORD"]}))' \
  >"$BODY_FILE"
unset PASSWORD

curl -sS -o "$RESP_FILE" --max-time 20 -X POST \
  "$SUPA_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPA_ANON" -H "content-type: application/json" \
  --data-binary "@$BODY_FILE" >/dev/null 2>&1
rm -f "$BODY_FILE"; BODY_FILE=""

ACCESS_TOKEN=""
TOKEN_ALG=""
TOKEN_ISS=""
while IFS= read -r line; do
  case "$line" in
    "!"*) bad "${line#!}" ;;
    "@"*) note "${line#@}" ;;
    "="*) ok "${line#=}" ;;
    "T"*) ACCESS_TOKEN="${line#T}" ;;
    "A"*) TOKEN_ALG="${line#A}" ;;
    "I"*) TOKEN_ISS="${line#I}" ;;
  esac
done < <(
  EMAIL="$EMAIL" python3 -I - "$RESP_FILE" <<'PY'
import base64, json, os, sys


def segment(token, index):
    part = token.split(".")[index]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


email = os.environ["EMAIL"]

try:
    body = json.load(open(sys.argv[1]))
except (OSError, ValueError):
    print("!the project's answer was not JSON — it may be down or behind something.")
    raise SystemExit(0)

token = body.get("access_token")
if not token:
    code = body.get("error_code") or body.get("error") or ""
    msg = body.get("msg") or body.get("error_description") or body.get("message") or ""
    if code == "email_not_confirmed":
        print(f"!{email} exists but has never confirmed their email.")
        print("@Supabase → Authentication → Users → the user → ⋯ → Confirm email.")
    elif code == "invalid_credentials":
        print(f"!{email} and that password were refused.")
        print("@Either no such user exists, or the password is wrong.")
        print("@Supabase → Authentication → Users → Add user, with 'Auto Confirm User' ticked.")
    elif code in ("over_request_rate_limit", "over_email_send_rate_limit"):
        print(f"!rate-limited by Supabase ({code}). Wait a minute and run this again.")
    else:
        print(f"!sign-in failed: {code or 'unknown'} {msg}".rstrip())
    raise SystemExit(0)

print(f"={email} can sign in")
print(f"T{token}")
try:
    header, claims = segment(token, 0), segment(token, 1)
except Exception as err:  # noqa: BLE001
    print(f"@could not read the token back ({err}); the engine checks below may be wrong.")
    raise SystemExit(0)
print(f"A{header.get('alg', '')}")
print(f"I{claims.get('iss', '')}")
if claims.get("aud") != "authenticated":
    print(f"@this token's audience is {claims.get('aud')!r}; the engine expects 'authenticated'.")
PY
)

[[ "$FAILED" == "0" ]] || { printf '\n%sFix the above before building.%s\n' "$R" "$X"; exit 1; }
[[ -n "$TOKEN_ALG" ]] && note "signed with $TOKEN_ALG, issued by $TOKEN_ISS"

# ── 5. the engine is configured for this project ─────────────────────────────
step "5. The engine is configured to verify that project's tokens"
if [[ ! -f "$ENV_FILE" ]]; then
  warn "no $ENV_FILE on this machine, so the engine's configuration was not read."
  note "Run this on the VPS to check it; step 6 still tests the live engine."
else
  # Strip the quotes and any CRLF an editor on Windows left behind.
  unquote() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | tr -d "\"'\r"; }
  engine_url=$(unquote SUPABASE_URL)
  engine_secret=$(unquote SUPABASE_JWT_SECRET)
  if [[ -z "$engine_url" ]]; then
    bad "$ENV_FILE has no SUPABASE_URL, so the engine trusts no Supabase project at all."
  elif [[ "${engine_url%/}" != "$SUPA_URL" ]]; then
    bad "the engine trusts a different project: ${engine_url%/}"
    note "Sign-in would succeed on the phone and every engine request would answer 401."
  else
    ok "the engine names the same project"
  fi
  # The engine only reaches for the shared secret when a token says HS256; for an asymmetric
  # algorithm it fetches the project's JWKS and the secret is irrelevant.
  if [[ "$TOKEN_ALG" == "HS256" && -z "$engine_secret" ]]; then
    bad "this project signs tokens with HS256 but SUPABASE_JWT_SECRET is empty in $ENV_FILE."
    note "The engine refuses every HS256 token without it. Supabase → Settings → API → JWT Secret."
  elif [[ "$TOKEN_ALG" == "HS256" ]]; then
    ok "HS256 tokens, and the engine has a JWT secret to check them with"
  elif [[ -n "$TOKEN_ALG" ]]; then
    ok "$TOKEN_ALG tokens, which the engine verifies against the project's published keys"
  fi
fi

# ── 6. the engine accepts a real token ───────────────────────────────────────
step "6. The engine accepts that token and knows this login is a driver"
if [[ "$API_URL" == "-" || -z "$API_URL" ]]; then
  warn "EXPO_PUBLIC_API_URL is not set, so there is no engine to test against."
else
  engine_code=$(curl -sS -o "$RESP_FILE" -w '%{http_code}' --max-time 20 \
    -H "authorization: Bearer $ACCESS_TOKEN" "$API_URL/v1/driver/me" 2>/dev/null)
  engine_msg=$(python3 -I -c 'import json, sys
try:
    print(json.load(open(sys.argv[1])).get("message") or "")
except Exception:
    print("")' "$RESP_FILE" 2>/dev/null)
  case "$engine_code" in
    200) ok "the engine accepted the token and returned this driver's profile" ;;
    401) bad "the engine rejected the token (401): ${engine_msg:-no message}"
         note "The token is good — Supabase just issued it — so this is the engine's configuration."
         note "Check SUPABASE_URL and SUPABASE_JWT_SECRET in $ENV_FILE, then look at the api logs:"
         note "docker compose -f infra/docker/compose.dev-host.yml logs api | grep 'rejected a bearer'" ;;
    403) bad "the engine knows this login but will not let it use the driver app (403): ${engine_msg:-no message}"
         note "Sign-in will work and the app will then show nothing."
         note "Admin → Drivers: add a driver with this exact email, and set them active." ;;
    000) bad "could not reach the engine at $API_URL."
         note "Is it running, is the DNS record pointed here, and does the certificate match?" ;;
    404) bad "the engine answered 404 for /v1/driver/me. Is $API_URL the engine, or a web app?" ;;
    *)   bad "the engine answered $engine_code: ${engine_msg:-no message}" ;;
  esac
fi

echo
if [[ "$FAILED" == "0" ]]; then
  printf '%sReady to build. This account signs in and the engine accepts it.%s\n' "$G" "$X"
else
  printf '%sFix the above before building — none of it is visible until the app is on a phone.%s\n' "$R" "$X"
  exit 1
fi
