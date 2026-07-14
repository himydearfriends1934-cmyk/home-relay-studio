#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${HOME_RELAY_REPO_URL:-https://github.com/himydearfriends1934-cmyk/home-relay-studio.git}"
INSTALL_DIR="${HOME_RELAY_INSTALL_DIR:-$HOME/.home-relay-studio}"
CONFIG_FILE="$INSTALL_DIR/.home-relay-studio.json"
PID_FILE="$INSTALL_DIR/.home-relay-studio.pid"
LOG_FILE="$INSTALL_DIR/home-relay-studio.log"
DEFAULT_PORT=8787

say() { printf '%s\n' "$*"; }
ask() {
  local answer
  if [[ ! -r /dev/tty ]]; then
    say "当前终端不可交互，请直接在终端运行命令。" >&2
    return 1
  fi
  read -r -p "$1" answer </dev/tty
  printf '%s' "$answer"
}

is_installed() { [[ -d "$INSTALL_DIR/.git" && -f "$INSTALL_DIR/package.json" ]]; }

check_environment() {
  say ""
  say "正在进行安装前环境检测……"
  local missing=0 command_name
  for command_name in git node npm; do
    if command -v "$command_name" >/dev/null 2>&1; then
      say "✓ $command_name: $($command_name --version 2>/dev/null | head -n 1)"
    else
      say "✗ 未安装 $command_name"
      missing=1
    fi
  done
  if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; then
    say "✓ 下载工具可用"
  else
    say "✗ 未安装 curl 或 wget"
    missing=1
  fi
  if (( missing )); then
    say "环境检测未通过。请先安装 Git、Node.js 18+（含 npm）和 curl/wget。"
    return 1
  fi
  local node_major
  node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if (( node_major < 18 )); then
    say "✗ Node.js 版本过低，需要 18 或更高版本。"
    return 1
  fi
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ ! -w "$(dirname "$INSTALL_DIR")" ]]; then
    say "✗ 安装目录不可写：$(dirname "$INSTALL_DIR")"
    return 1
  fi
  say "✓ 安装目录可写：$INSTALL_DIR"
}

port_available() {
  node -e '
    const net = require("net");
    const server = net.createServer();
    server.once("error", () => process.exit(1));
    server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close(() => process.exit(0)));
  ' "$1"
}

find_port() {
  local port="$1"
  while (( port <= 65535 )); do
    if port_available "$port"; then printf '%s' "$port"; return 0; fi
    ((port += 1))
  done
  return 1
}

configured_port() {
  if [[ -f "$CONFIG_FILE" ]]; then
    node -e 'try { console.log(require(process.argv[1]).port || 8787) } catch { console.log(8787) }' "$CONFIG_FILE"
  else
    printf '%s\n' "$DEFAULT_PORT"
  fi
}

stop_service() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in {1..20}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.2
      done
    fi
    rm -f "$PID_FILE"
  fi
}

choose_port() {
  local requested replacement answer
  requested="$(configured_port)"
  if port_available "$requested"; then
    say "✓ 端口 $requested 可用" >&2
    printf '%s' "$requested"
    return
  fi
  replacement="$(find_port "$((requested + 1))")" || { say "没有找到可用端口。" >&2; return 1; }
  say "! 端口 $requested 已被占用，可替换为 $replacement。" >&2
  answer="$(ask "是否替换端口？[Y/n] ")" || return 1
  if [[ -n "$answer" && ! "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    say "已取消安装/更新。" >&2
    return 1
  fi
  printf '%s' "$replacement"
}

install_or_update() {
  check_environment
  local updating=0 port
  if is_installed; then
    updating=1
    say "检测到已安装版本，将执行更新。"
    stop_service
  else
    say "未检测到已安装版本，将执行全新安装。"
  fi
  port="$(choose_port)"

  if (( updating )); then
    git -C "$INSTALL_DIR" fetch origin main
    git -C "$INSTALL_DIR" checkout main
    git -C "$INSTALL_DIR" pull --ff-only origin main
  else
    if [[ -e "$INSTALL_DIR" ]]; then
      say "安装目录已存在但不是有效安装：$INSTALL_DIR"
      return 1
    fi
    git clone --branch main --single-branch "$REPO_URL" "$INSTALL_DIR"
  fi

  npm --prefix "$INSTALL_DIR" install --omit=dev
  printf '{\n  "host": "127.0.0.1",\n  "port": %s\n}\n' "$port" > "$CONFIG_FILE"
  (
    cd "$INSTALL_DIR"
    nohup node src/server.js >> "$LOG_FILE" 2>&1 &
    printf '%s\n' "$!" > "$PID_FILE"
  )
  sleep 1
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    say "启动失败，请查看日志：$LOG_FILE"
    return 1
  fi
  say ""
  say "$([[ $updating == 1 ]] && echo '更新' || echo '安装')完成。"
  say "访问地址：http://127.0.0.1:$port"
  say "日志文件：$LOG_FILE"
}

remove_system() {
  if ! is_installed; then
    say "系统尚未安装，无需删除。"
    return
  fi
  local answer
  answer="$(ask "删除系统会同时删除本地业务数据，确认继续？[y/N] ")" || return 1
  if [[ ! "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    say "已取消删除。"
    return
  fi
  stop_service
  rm -rf -- "$INSTALL_DIR"
  say "系统已删除。"
}

main() {
  local action_label choice
  if is_installed; then action_label="更新系统"; else action_label="全新安装"; fi
  say "========================================"
  say " Home Relay Studio 管理工具"
  say "========================================"
  say "1. $action_label"
  say "2. 删除系统"
  say "0. 退出"
  choice="$(ask "请选择 [0-2]：")" || exit 1
  case "$choice" in
    1) install_or_update ;;
    2) remove_system ;;
    0) say "已退出。" ;;
    *) say "无效选择：$choice"; exit 1 ;;
  esac
}

main "$@"
