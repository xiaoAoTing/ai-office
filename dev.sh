#!/usr/bin/env bash
# 一条命令起前端 + 后端，改动代码自动生效。
# 用法：./dev.sh [--api-port 8000] [--web-port 3000] [--skip-migrate] [--open] [-y]
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT"

API_PORT=${API_PORT:-8000}
WEB_PORT=${WEB_PORT:-3000}
MIGRATE=1
DO_OPEN=0
ASSUME_YES=0
API_PID=""
WEB_PID=""

if [ -t 1 ]; then
  C_DIM=$'\033[2m'; C_CYAN=$'\033[36m'; C_YEL=$'\033[33m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_OFF=$'\033[0m'
else
  C_DIM=""; C_CYAN=""; C_YEL=""; C_RED=""; C_GRN=""; C_OFF=""
fi

step() { printf '%s==>%s %s\n' "$C_CYAN" "$C_OFF" "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%s注意:%s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
die()  { printf '%s失败:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --api-port)     [ $# -ge 2 ] || die "--api-port 后面要跟端口号"; API_PORT=$2; shift 2 ;;
    --web-port)     [ $# -ge 2 ] || die "--web-port 后面要跟端口号"; WEB_PORT=$2; shift 2 ;;
    --skip-migrate) MIGRATE=0; shift ;;
    --open)         DO_OPEN=1; shift ;;
    -y|--yes)       ASSUME_YES=1; shift ;;
    -h|--help)      sed -n '2,3p' "$0"; exit 0 ;;
    *)              die "未知参数：$1（--help 看用法）" ;;
  esac
done

confirm() {
  if [ "$ASSUME_YES" = 1 ]; then return 0; fi
  printf '%s%s%s [Y/n] ' "$C_YEL" "$1" "$C_OFF"
  read -r reply
  case "$reply" in [nN]*) return 1 ;; *) return 0 ;; esac
}

port_free() { ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

who_holds() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1" (pid "$2")"; exit}'; }

# 本机常年有别的 dev server 占着 3000/3001，所以从指定端口往上找第一个空位
find_free_port() {
  for offset in 1 2 3 4 5; do
    probe=$(($1+offset))
    if port_free "$probe"; then printf '%s' "$probe"; return 0; fi
  done
  return 1
}

# /dev/tcp 是 bash 内建：没装 pg_isready 的机器上也能探 TCP 可达性
tcp_ok() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }

tail_log() {
  if [ -f "$1" ]; then
    printf '    %s---- %s 最后 15 行 ----%s\n' "$C_DIM" "$(basename "$1")" "$C_OFF" >&2
    tail -n 15 "$1" | sed "s/^/    /" >&2
  fi
  return 0
}

# 后序递归杀：先子后父，否则父进程可能把子进程重新拉起来
kill_tree() {
  for c in $(pgrep -P "$1" 2>/dev/null || true); do kill_tree "$c"; done
  kill -TERM "$1" 2>/dev/null || true
  return 0
}

shutdown() {
  trap '' INT TERM EXIT
  for pid in "$WEB_PID" "$API_PID"; do
    if [ -n "$pid" ]; then kill_tree "$pid"; fi
  done
  WEB_PID=""; API_PID=""
}
trap 'shutdown; exit 130' INT TERM
trap 'shutdown' EXIT

# 上次被 kill -9 之类留下的孤儿会占住端口。只按我们自己的启动命令行匹配并杀它们的进程树，
# 认不出归属的进程一律不动，交给使用者自己决定。
reclaim_stale() {
  target_port=$1; pattern=$2
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  [ -n "$pids" ] || return 1
  oneline=$(printf '%s' "$pids" | tr '\n' ' ')
  confirm "${target_port} 端口上是上一次没退干净的本项目实例（pid ${oneline}），先停掉它？" || return 1
  for p in $pids; do kill_tree "$p"; done
  waited=0
  while [ $waited -lt 15 ]; do
    if port_free "$target_port"; then return 0; fi
    sleep 1; waited=$((waited+1))
  done
  warn "${target_port} 还被 $(who_holds "$target_port") 占着，可能有认不出的残留进程"
  return 1
}

# ---------------------------------------------------------------- 依赖与配置

command -v npm >/dev/null 2>&1 || die "找不到 npm，请先装 Node.js 22+"
command -v python3 >/dev/null 2>&1 || die "找不到 python3，请先装 Python 3.11+"

if [ ! -f backend/.env ]; then
  [ -f backend/.env.example ] || die "backend/.env 和 backend/.env.example 都不存在"
  cp backend/.env.example backend/.env
  step "已生成 backend/.env（沿用示例配置）"
fi
if [ ! -f frontend/.env.local ] && [ -f frontend/.env.example ]; then
  cp frontend/.env.example frontend/.env.local
  step "已生成 frontend/.env.local"
fi

# 必须是绝对路径：迁移和 uvicorn 都要 cd 到 backend/ 下执行
PY="$ROOT/backend/.venv/bin/python"
if [ ! -x "$PY" ]; then
  confirm "backend/.venv 不存在，创建虚拟环境并装依赖？" || die "需要先有 backend/.venv 才能起后端"
  step "创建 Python 虚拟环境"
  python3 -m venv backend/.venv
  step "安装后端依赖（可能要几分钟）"
  pip_hint="pip 失败：python.org 装的 Python 不带 CA bundle，先 export SSL_CERT_FILE=/etc/ssl/cert.pem 再重跑"
  "$PY" -m pip install -q --upgrade pip || die "$pip_hint"
  "$PY" -m pip install -q -r backend/requirements-dev.txt || die "$pip_hint"
elif ! "$PY" -c 'import fastapi, uvicorn' 2>/dev/null; then
  step "补齐后端依赖"
  "$PY" -m pip install -q -r backend/requirements-dev.txt || die "pip 失败，见上面的报错"
fi

if [ ! -d frontend/node_modules ]; then
  confirm "frontend/node_modules 不存在，执行 npm ci？" || die "需要先装前端依赖"
  step "安装前端依赖（可能要几分钟）"
  ( cd frontend && npm ci )
fi

# ---------------------------------------------------------------- 数据库

db_url=$(sed -n 's/^DATABASE_URL=//p' backend/.env | head -n1 | sed 's/^["'"'"']*//; s/["'"'"']*$//')
[ -n "$db_url" ] || die "backend/.env 里缺少 DATABASE_URL"
db_user=$(printf '%s' "$db_url" | sed -e 's#^[^:]*://##' -e 's#:.*##')
db_pass=$(printf '%s' "$db_url" | sed -e 's#^[^:]*://[^:]*:##' -e 's#@[^@]*$##')
db_hostport=$(printf '%s' "$db_url" | sed -e 's#^[^:]*://[^@]*@##' -e 's#/.*##')
db_name=$(printf '%s' "$db_url" | sed -e 's#.*/##')
db_host=${db_hostport%%:*}
db_port=${db_hostport##*:}
if [ "$db_port" = "$db_hostport" ]; then db_port=5432; fi

step "检查 PostgreSQL（$db_user@$db_host:$db_port/${db_name}）"
if ! tcp_ok "$db_host" "$db_port"; then
  case "$db_host" in localhost|127.0.0.1)
    if [ -d /opt/homebrew/opt/postgresql@16 ] || [ -d /usr/local/opt/postgresql@16 ]; then
      step "本机装了 Homebrew postgresql@16，尝试启动它"
      brew services start postgresql@16 >/dev/null 2>&1 || true
      waited=0
      while [ $waited -lt 15 ]; do
        if tcp_ok "$db_host" "$db_port"; then break; fi
        sleep 1; waited=$((waited+1))
      done
    fi ;;
  esac
fi

if ! tcp_ok "$db_host" "$db_port"; then
  if [ "$db_port" != "5432" ] && tcp_ok 127.0.0.1 5432; then
    step "$db_port 连不上，但本机 5432 上有 PostgreSQL（Homebrew 装的那个）"
    if confirm "把 backend/.env 的连接串改到 127.0.0.1:5432？（先备份成 backend/.env.bak）"; then
      cp backend/.env backend/.env.bak
      sed "s#@${db_hostport}/#@127.0.0.1:5432/#" backend/.env > backend/.env.new && mv backend/.env.new backend/.env
      db_host=127.0.0.1; db_port=5432; db_hostport="127.0.0.1:5432"
      info "已改写，原文件在 backend/.env.bak"
    fi
  fi
  if ! tcp_ok "$db_host" "$db_port"; then
    die "连不上 $db_host:${db_port}。任选一种：docker compose up -d db / brew services start postgresql@16"
  fi
fi

if command -v psql >/dev/null 2>&1; then
  if ! PGPASSWORD="$db_pass" psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -tAc 'select 1' >/dev/null 2>&1; then
    die "库 $db_name 连不上（角色或库还没建，见 docs/start-local-macos.md 的首次搭建）"
  fi
  n_agents=$(PGPASSWORD="$db_pass" psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" \
    -tAc 'select count(*) from agents' 2>/dev/null || echo "")
  if [ "$n_agents" = "0" ]; then
    warn "库里还没有 agent，界面会是空的：cd backend && .venv/bin/python -m app.seed --demo"
  fi
else
  info "没装 psql，跳过库和数据的预检（迁移会报出缺什么）"
fi

if [ "$MIGRATE" = 1 ]; then
  step "应用数据库迁移（alembic upgrade head）"
  ( cd backend && "$PY" -m alembic upgrade head ) || die "迁移失败，检查 backend/.env 的 DATABASE_URL"
else
  step "跳过迁移（--skip-migrate）"
fi

# ---------------------------------------------------------------- 端口与 CORS

WEB_ORIGIN="http://localhost:$WEB_PORT"
if ! port_free "$WEB_PORT"; then
  if reclaim_stale "$WEB_PORT" "next dev -H 127.0.0.1 -p $WEB_PORT"; then
    info "已回收上一次的前端实例，继续用 $WEB_PORT"
  else
    busy_by=$(who_holds "$WEB_PORT")
    if next_port=$(find_free_port "$WEB_PORT"); then
      step "$WEB_PORT 被 $busy_by 占用，改用 $next_port"
      WEB_PORT=$next_port; WEB_ORIGIN="http://localhost:$WEB_PORT"
    else
      die "端口 $WEB_PORT 已被 $busy_by 占用，往上 5 个也没有空位，用 --web-port 指定一个"
    fi
  fi
fi
if ! port_free "$API_PORT"; then
  if reclaim_stale "$API_PORT" "uvicorn app.main:app --host 127.0.0.1 --port $API_PORT"; then
    info "已回收上一次的后端实例，继续用 $API_PORT"
  elif next_port=$(find_free_port "$API_PORT"); then
    step "后端端口 $API_PORT 被 $(who_holds "$API_PORT") 占用，改用 $next_port"
    API_PORT=$next_port
  else
    die "后端端口 $API_PORT 已被 $(who_holds "$API_PORT") 占用，用 --api-port 指定一个"
  fi
fi

# 环境变量优先于 .env 文件，所以这里临时补 CORS，不去改用户的 backend/.env。
# 浏览器可能用 localhost 也可能用 127.0.0.1 打开页面（next dev 打印的就是 127.0.0.1 那个），
# 少一个来源，页面就会被 CORS 拦住取不到 /api/v1/state。
cors=$(sed -n 's/^CORS_ORIGINS=//p' backend/.env | head -n1)
missing=""
for origin in "http://localhost:$WEB_PORT" "http://127.0.0.1:$WEB_PORT"; do
  if ! printf '%s' "$cors" | grep -qF "\"$origin\""; then missing="${missing}\"$origin\","; fi
done
if [ -n "$missing" ]; then
  inner=$(printf '%s' "$cors" | sed -e 's/^\[//' -e 's/\]$//')
  missing=${missing%,}
  if [ -n "$inner" ]; then
    CORS_ORIGINS="[${inner},${missing}]"
  else
    CORS_ORIGINS="[${missing}]"
  fi
  export CORS_ORIGINS
  added=$(printf '%s' "$missing" | tr -d '"')
  step "CORS 临时加上 ${added} （不改 backend/.env）"
fi

# ---------------------------------------------------------------- 起服务

LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ai-office-dev.XXXXXX")
# awk 代替 sed：BSD sed 没有 -u，行缓冲要靠 awk 的 fflush；同时喂终端和日志文件
relay() {
  awk -v tag="$2" -v outfile="$1" '{
    print tag " " $0; fflush()
    print tag " " $0 >> outfile; fflush(outfile)
  }'
}

step "启动后端（uvicorn --reload：改 backend/app 下的 .py 自动重启）"
( cd backend && exec "$PY" -m uvicorn app.main:app \
    --host 127.0.0.1 --port "$API_PORT" --reload --reload-dir app \
    --timeout-graceful-shutdown 2 ) > >(relay "$LOG_DIR/api.log" "${C_DIM}[api]${C_OFF}") 2>&1 &
API_PID=$!

waited=0
while :; do
  health=$(curl -s -m 2 "http://127.0.0.1:$API_PORT/health" 2>/dev/null || true)
  case "$health" in *'"db":true'*) break ;; esac
  if ! kill -0 "$API_PID" 2>/dev/null; then
    tail_log "$LOG_DIR/api.log"; die "后端进程已退出"
  fi
  case "$health" in
    *'"db":false'*) die "后端起来了但连不上数据库：核对 backend/.env 的 DATABASE_URL，或先起 PostgreSQL" ;;
  esac
  if [ $waited -ge 60 ]; then
    warn "后端 60 秒内没有就绪"; tail_log "$LOG_DIR/api.log"
    die "看上面的日志；常见原因：端口被占、EXECUTOR_WORKER 缺依赖、模型或 CLI 不可用"
  fi
  sleep 1; waited=$((waited+1))
done
info "后端就绪：http://localhost:$API_PORT/health ${C_GRN}db: ok${C_OFF}"

step "启动前端（next dev：改 frontend/src 下的代码即时热更新）"
# NEXT_PUBLIC_* 必须在 next 进程的环境里，所以写在命令前而不是 export
( cd frontend && exec env NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" npm run dev -- -H 127.0.0.1 -p "$WEB_PORT" ) \
  > >(relay "$LOG_DIR/web.log" "${C_DIM}[web]${C_OFF}") 2>&1 &
WEB_PID=$!

waited=0
while :; do
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$WEB_ORIGIN" 2>/dev/null || true)
  # 只要应答了就认为起来了：代码有编译错误时 next 返回 500，这时候更该把服务留着让人看日志
  if [ -n "$code" ] && [ "$code" != "000" ]; then break; fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    tail_log "$LOG_DIR/web.log"; die "前端进程已退出"
  fi
  if [ $waited -ge 90 ]; then
    warn "前端 90 秒内没有响应"; tail_log "$LOG_DIR/web.log"; die "首次编译可能很慢，稍后重跑本脚本"
  fi
  sleep 1; waited=$((waited+1))
done
if [ "$code" != "200" ] && [ "$code" != "302" ]; then
  warn "前端应答 HTTP ${code}，页面可能有编译错误，日志见 $LOG_DIR/web.log"
else
  info "前端就绪"
fi

printf '\n'
printf '%s  AI Office 已启动%s\n' "$C_GRN" "$C_OFF"
printf '    界面      %s\n' "$WEB_ORIGIN"
printf '    也可以用  http://127.0.0.1:%s （两个来源都已放行）\n' "$WEB_PORT"
printf '    API       http://localhost:%s/health\n' "$API_PORT"
printf '    日志      %s\n' "$LOG_DIR"
printf '    热更新    后端 .py 改动自动重启，前端改动即时生效\n'
printf '    停止      Ctrl+C（两个服务一起退出）\n'
printf '%s    .env 和依赖的改动不会被自动重启覆盖，改完重启本脚本%s\n\n' "$C_DIM" "$C_OFF"

if [ "$DO_OPEN" = 1 ]; then open "$WEB_ORIGIN" >/dev/null 2>&1 || true; fi

while :; do
  if ! kill -0 "$API_PID" 2>/dev/null; then warn "后端退出了，一并停掉前端"; tail_log "$LOG_DIR/api.log"; exit 1; fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then warn "前端退出了，一并停掉后端"; tail_log "$LOG_DIR/web.log"; exit 1; fi
  sleep 2
done
