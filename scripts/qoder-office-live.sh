#!/usr/bin/env bash
# Qoder CLI hook → ai-office heartbeat: the agent named in AI_OFFICE_AGENT_ID mirrors what this CLI
# session is doing right now (where it drives to, what it types above its head).
#
# Install (project or user settings.json):
#   "hooks": {
#     "PreToolUse":    [{"matcher": "", "hooks": [{"type": "command", "command": "~/.qoder-cn/hooks/qoder-office-live.sh"}]}],
#     "PostToolUse":   [{"matcher": "", "hooks": [{"type": "command", "command": "~/.qoder-cn/hooks/qoder-office-live.sh"}]}],
#     "Stop":          [{"matcher": "", "hooks": [{"type": "command", "command": "~/.qoder-cn/hooks/qoder-office-live.sh"}]}],
#     "SessionStart":  [{"matcher": "", "hooks": [{"type": "command", "command": "~/.qoder-cn/hooks/qoder-office-live.sh"}]}],
#     "SessionEnd":    [{"matcher": "", "hooks": [{"type": "command", "command": "~/.qoder-cn/hooks/qoder-office-live.sh"}]}]
#   }
#
# Environment: AI_OFFICE_URL (default http://127.0.0.1:8000), AI_OFFICE_AGENT_ID (default 7).
# A hook must never break the CLI: everything is best effort, and it exits 0 whatever happens.

set -u

URL="${AI_OFFICE_URL:-http://127.0.0.1:8000}"
AGENT="${AI_OFFICE_AGENT_ID:-7}"

command -v jq >/dev/null 2>&1 || exit 0
# Installed in the user's settings, this hook runs for every project: leave at once when the office is not
# listening, so a session in another project never pays for a request.
hostport=${URL#*://}; hostport=${hostport%%/*}
host=${hostport%%:*}; port=${hostport##*:}
[ "$port" = "$host" ] && port=80
if command -v nc >/dev/null 2>&1; then
  nc -z -w 1 "$host" "$port" 2>/dev/null || exit 0
fi
input="$(cat)"
[ -n "$input" ] || exit 0

event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)

case "$event" in
  Stop) kind="idle"; detail="thinking done, waiting" ;;
  SessionStart) kind="idle"; detail="session started" ;;
  SessionEnd) kind="idle"; detail="session ended" ;;
  PreToolUse | PostToolUse)
    case "$tool" in
      WebSearch | WebFetch)
        kind="searching"
        target=$(printf '%s' "$input" | jq -r '.tool_input.query // .tool_input.url // empty' 2>/dev/null)
        detail="$tool - ${target:0:44}"
        ;;
      Read | Grep | Glob)
        kind="reading"
        target=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.pattern // .tool_input.path // empty' 2>/dev/null)
        detail="$tool - $(basename "${target:-$tool}")"
        ;;
      Edit | Write | MultiEdit | NotebookEdit)
        kind="editing"
        target=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
        detail="$tool - $(basename "${target:-$tool}")"
        ;;
      Bash)
        kind="running"
        target=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
        detail="Bash - ${target:0:44}"
        ;;
      Agent | Task | Workflow)
        kind="delegating"
        target=$(printf '%s' "$input" | jq -r '.tool_input.description // .tool_input.prompt // empty' 2>/dev/null)
        detail="$tool - ${target:0:44}"
        ;;
      mcp__*)
        kind="tool"
        detail="${tool#mcp__}"
        detail="${detail:0:60}"
        ;;
      *)
        kind="working"
        detail="$tool"
        ;;
    esac
    ;;
  *) exit 0 ;;
esac

# The API answers only localhost and only to its own origin; the 3D labels use the font the app ships,
# which has no glyphs past ASCII, so the text is filtered to it (a middle dot would silently vanish).
detail=$(printf '%s' "$detail" | LC_ALL=C tr -cd '[:print:]' | cut -c1-60)
payload=$(jq -cn --arg kind "$kind" --arg detail "$detail" '{kind: $kind, detail: $detail}')

curl -s -m 1.5 -o /dev/null \
  -X POST "$URL/api/v1/agents/$AGENT/live" \
  -H 'Content-Type: application/json' \
  -H "Origin: ${AI_OFFICE_ORIGIN:-http://localhost:3001}" \
  -d "$payload" 2>/dev/null

exit 0
