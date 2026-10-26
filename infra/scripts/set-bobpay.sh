#!/usr/bin/env bash
# Type the Bob Pay credentials straight into one or more infra/docker/.env files.
#
# Prompted rather than passed as arguments so they never reach your shell history, and never
# have to be pasted into a chat window to get here. Nothing is echoed back.
#
# Usage:
#   infra/scripts/set-bobpay.sh                    # both known stacks on this VPS
#   infra/scripts/set-bobpay.sh /path/to/.env ...   # just the ones you name
#
# Get the values from the Bob Pay merchant dashboard: the account code and the notification
# passphrase, under your payment/API settings. Dev and prod are usually the same merchant
# account, so one run against both known .env paths sets it everywhere in one paste.
set -euo pipefail

TARGETS=("$@")
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=(/srv/delicate-engine/infra/docker/.env /srv/delicate-prod/infra/docker/.env)
fi

FOUND=()
for f in "${TARGETS[@]}"; do
  if [[ -f "$f" ]]; then
    FOUND+=("$f")
  else
    echo "skipping $f (not found)" >&2
  fi
done
[[ ${#FOUND[@]} -gt 0 ]] || { echo "none of the target .env files exist; nothing to do." >&2; exit 1; }

echo "Will set BOBPAY_API_TOKEN, BOBPAY_ACCOUNT_CODE and BOBPAY_PASSPHRASE in:"
printf '  %s\n' "${FOUND[@]}"
echo
echo "Bob Pay credentials — from your Bob Pay merchant dashboard."
echo "Nothing you type is shown or saved to history."
echo

read -rsp "API token:    " TOKEN; echo
read -rp  "Account code: " CODE
read -rsp "Passphrase:   " PASS; echo
echo

[[ -n "$TOKEN" && -n "$CODE" && -n "$PASS" ]] || { echo "All three are required; nothing changed." >&2; exit 1; }

set_key() {
  local file="$1" key="$2" value="$3"
  cp "$file" "$file.bak.$(date +%Y%m%d-%H%M%S)"
  if grep -q "^${key}=" "$file"; then
    python3 - "$file" "$key" "$value" <<'PY'
import sys
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path, encoding="utf-8").read().splitlines(keepends=True)
out = []
for line in lines:
    if line.startswith(key + "="):
        out.append(f"{key}={value}\n")
    else:
        out.append(line)
open(path, "w", encoding="utf-8", newline="\n").writelines(out)
PY
  else
    printf "%s=%s\n" "$key" "$value" >> "$file"
  fi
}

for f in "${FOUND[@]}"; do
  set_key "$f" BOBPAY_API_TOKEN "$TOKEN"
  set_key "$f" BOBPAY_ACCOUNT_CODE "$CODE"
  set_key "$f" BOBPAY_PASSPHRASE "$PASS"
done

echo "Saved. Set (length only, to spot an empty paste or a stray space — never the value itself):"
for f in "${FOUND[@]}"; do
  awk -F= -v f="$f" '/^BOBPAY_(API_TOKEN|ACCOUNT_CODE|PASSPHRASE)=/ { printf "  %s: %s (%d characters)\n", f, $1, length($2) }' "$f"
done
echo
echo "Now restart each stack so it picks up the new value, e.g.:"
echo "  cd /srv/delicate-engine/infra/docker && docker compose --env-file .env -f compose.dev-host.yml -p delicate-dev up -d"
echo "  cd /srv/delicate-prod/infra/docker  && docker compose --env-file .env -f compose.dev-host.yml -p delicate-prod up -d"
