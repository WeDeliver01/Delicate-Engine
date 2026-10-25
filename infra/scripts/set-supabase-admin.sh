#!/usr/bin/env bash
# Type the Supabase service-role key straight into one or more infra/docker/.env files.
#
# Prompted rather than passed as an argument so it never reaches your shell history, and never
# has to be pasted into a chat window to get here. Nothing is echoed back. This key can do
# anything to any user in the Supabase project -- it is not something to type twice, paste into
# a message, or leave in a terminal scrollback.
#
# Usage:
#   infra/scripts/set-supabase-admin.sh                    # both known stacks on this VPS
#   infra/scripts/set-supabase-admin.sh /path/to/.env ...   # just the ones you name
#
# Get the value from the Supabase dashboard: Project Settings -> API -> Project API keys ->
# service_role ("reveal", then copy). Dev and prod share one Supabase project, so it is the same
# value in both .env files -- this script sets it everywhere in one paste rather than two.
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

echo "Will set SUPABASE_SERVICE_ROLE_KEY in:"
printf '  %s\n' "${FOUND[@]}"
echo
echo "Supabase service-role key — Project Settings -> API -> Project API keys -> service_role."
echo "Nothing you type is shown or saved to history."
echo
read -rsp "Service-role key: " KEY; echo
[[ -n "$KEY" ]] || { echo "Empty; nothing changed." >&2; exit 1; }

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
  set_key "$f" SUPABASE_SERVICE_ROLE_KEY "$KEY"
done

echo "Saved. Set (length only, to spot an empty paste or a stray space — never the value itself):"
for f in "${FOUND[@]}"; do
  awk -F= -v f="$f" '/^SUPABASE_SERVICE_ROLE_KEY=/ { printf "  %s: %d characters\n", f, length($2) }' "$f"
done
echo
echo "Now restart each stack so it picks up the new value, e.g.:"
echo "  cd /srv/delicate-engine/infra/docker && docker compose --env-file .env -f compose.dev-host.yml -p delicate-dev up -d"
echo "  cd /srv/delicate-prod/infra/docker  && docker compose --env-file .env -f compose.dev-host.yml -p delicate-prod up -d"
