#!/usr/bin/env bash
# Read-only inventory. Does not read application configuration, keys or databases.
set -eu
port="${1:-4327}"
case "$port" in ''|*[!0-9]*) printf 'Expected an unprivileged TCP port.\n' >&2; exit 2;; esac
if [ "${#port}" -gt 5 ] || [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ] || [ "$port" -eq 4317 ]; then
  printf 'Choose a port from 1024 to 65535 other than the existing application port 4317.\n' >&2
  exit 2
fi
if [ "$(uname -s)" != Linux ]; then
  printf 'Run this read-only inventory on the target Linux ECS.\n' >&2
  exit 2
fi
printf '\n[OS / architecture]\n'
if [ -r /etc/os-release ]; then
  awk -F= '/^(NAME|VERSION_ID)=/{print}' /etc/os-release
fi
uname -m
printf '\n[CPU / memory / filesystems]\n'
getconf _NPROCESSORS_ONLN
free -m
df -h / /opt /var
printf '\n[Runtime versions; missing is allowed at this stage]\n'
for tool in node pnpm nginx systemctl; do
  if command -v "$tool" >/dev/null 2>&1; then
    case "$tool" in
      nginx) nginx -v 2>&1;;
      systemctl) systemctl --version | head -n 1;;
      *) "$tool" --version;;
    esac
  else
    printf '%s: not on PATH\n' "$tool"
  fi
done
printf '\n[Listening TCP ports; no process command lines]\n'
ss -ltn
printf '\n[Candidate port %s]\n' "$port"
if ss -H -ltn | awk -v p="$port" '$4 ~ (":" p "$") {found=1} END {exit !found}'; then
  printf 'OCCUPIED: select a different port before deployment.\n'
else
  printf 'Not listening now; recheck immediately before service start.\n'
fi
printf '\n[Selected services; no logs or environment values]\n'
for service in nginx.service juntong-postdoc.service research-agent-api.service research-agent-worker.service; do
  systemctl show "$service" --property=Id,LoadState,ActiveState,SubState --no-pager || true
done
printf '\n[Proposed namespace; existing paths require inspection]\n'
for path in /opt/research-agent-platform /var/lib/research-agent-platform /var/backups/research-agent-platform /etc/research-agent-platform /etc/nginx/conf.d/research-agent-platform.conf; do
  if [ -e "$path" ] || [ -L "$path" ]; then
    printf 'EXISTS %s\n' "$path"
  else
    printf 'AVAILABLE %s\n' "$path"
  fi
done
if id research-agent >/dev/null 2>&1; then
  printf 'EXISTS system account research-agent\n'
else
  printf 'AVAILABLE system account research-agent\n'
fi
printf '\nNo changes made. This inventory is not a deployment or capacity approval.\n'
