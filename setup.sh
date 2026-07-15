#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${HOME_RELAY_REPO_URL:-https://github.com/himydearfriends1934-cmyk/home-relay-studio.git}"
INSTALL_DIR="${HOME_RELAY_INSTALL_DIR:-$HOME/.home-relay-studio}"
CONFIG_FILE="$INSTALL_DIR/.home-relay-studio.json"
PID_FILE="$INSTALL_DIR/.home-relay-studio.pid"
CHILD_PID_FILE="$INSTALL_DIR/.home-relay-studio.child.pid"
LOG_FILE="$INSTALL_DIR/home-relay-studio.log"
DEFAULT_PORT=8787
NODE_MAJOR="${HOME_RELAY_NODE_MAJOR:-22}"
PACKAGE_MANAGER=""

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

run_as_root() {
  if (( EUID == 0 )); then
    "$@"
  else
    sudo "$@"
  fi
}

ensure_root_privilege() {
  if (( EUID == 0 )); then return 0; fi
  if command -v sudo >/dev/null 2>&1; then
    sudo -v
    return 0
  fi
  say "✗ 自动安装依赖需要 root 或 sudo 权限。请切换 root 后重试。"
  return 1
}

detect_package_manager() {
  if [[ -n "$PACKAGE_MANAGER" ]]; then
    printf '%s' "$PACKAGE_MANAGER"
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    PACKAGE_MANAGER="apt"
  elif command -v dnf >/dev/null 2>&1; then
    PACKAGE_MANAGER="dnf"
  elif command -v yum >/dev/null 2>&1; then
    PACKAGE_MANAGER="yum"
  elif command -v apk >/dev/null 2>&1; then
    PACKAGE_MANAGER="apk"
  elif command -v pacman >/dev/null 2>&1; then
    PACKAGE_MANAGER="pacman"
  else
    say "✗ 未识别到支持的包管理器。请手动安装 Git、Node.js 18+（含 npm）和 curl/wget。"
    return 1
  fi
  printf '%s' "$PACKAGE_MANAGER"
}

install_packages() {
  local manager="$1"
  shift
  (( $# > 0 )) || return 0
  case "$manager" in
    apt)
      run_as_root apt-get update
      run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
      ;;
    dnf)
      run_as_root dnf install -y "$@"
      ;;
    yum)
      run_as_root yum install -y "$@"
      ;;
    apk)
      run_as_root apk add --no-cache "$@"
      ;;
    pacman)
      run_as_root pacman -Sy --noconfirm --needed "$@"
      ;;
    *)
      say "✗ 不支持的包管理器：$manager"
      return 1
      ;;
  esac
}

download_to_stdout() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
  else
    return 1
  fi
}

install_base_tools() {
  local manager="$1"
  say "正在安装基础环境：Git、curl、wget、CA 证书……"
  case "$manager" in
    apt|dnf|yum|pacman) install_packages "$manager" ca-certificates git curl wget ;;
    apk) install_packages "$manager" ca-certificates git curl wget bash ;;
    *) return 1 ;;
  esac
}

install_node_runtime() {
  local manager="$1"
  say "正在安装 Node.js ${NODE_MAJOR}.x LTS 和 npm……"
  case "$manager" in
    apt)
      download_to_stdout "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | run_as_root bash -
      install_packages "$manager" nodejs
      ;;
    dnf|yum)
      download_to_stdout "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | run_as_root bash -
      install_packages "$manager" nodejs
      ;;
    apk|pacman)
      install_packages "$manager" nodejs npm
      ;;
    *)
      return 1
      ;;
  esac
}

node_major_version() {
  if ! command -v node >/dev/null 2>&1; then
    printf '0'
    return
  fi
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0'
}

check_environment() {
  say ""
  say "正在进行安装前环境检测……"
  local missing_tools=0 need_node=0 command_name manager node_major

  for command_name in git; do
    if command -v "$command_name" >/dev/null 2>&1; then
      say "✓ $command_name: $($command_name --version 2>/dev/null | head -n 1)"
    else
      say "✗ 未安装 $command_name"
      missing_tools=1
    fi
  done
  if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; then
    say "✓ 下载工具可用"
  else
    say "✗ 未安装 curl 或 wget"
    missing_tools=1
  fi

  if command -v node >/dev/null 2>&1; then
    say "✓ node: $(node --version 2>/dev/null | head -n 1)"
  else
    say "✗ 未安装 node"
    need_node=1
  fi
  if command -v npm >/dev/null 2>&1; then
    say "✓ npm: $(npm --version 2>/dev/null | head -n 1)"
  else
    say "✗ 未安装 npm"
    need_node=1
  fi

  node_major="$(node_major_version)"
  if (( node_major < 18 )); then
    [[ "$node_major" == "0" ]] || say "✗ Node.js 版本过低，需要 18 或更高版本。"
    need_node=1
  fi

  if (( missing_tools || need_node )); then
    if [[ "${HOME_RELAY_SKIP_AUTO_INSTALL:-0}" == "1" ]]; then
      say "环境检测未通过，且已设置 HOME_RELAY_SKIP_AUTO_INSTALL=1，跳过自动安装。"
      return 1
    fi
    manager="$(detect_package_manager)" || return 1
    ensure_root_privilege || return 1
    say "检测到环境不完整，将使用 $manager 自动补齐依赖。"
    if (( missing_tools )); then install_base_tools "$manager"; fi
    if (( need_node )); then install_node_runtime "$manager"; fi
    say "依赖安装完成，正在复查环境……"
  fi

  for command_name in git node npm; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      say "✗ 自动安装后仍未检测到 $command_name，请手动检查系统包管理器。"
      return 1
    fi
  done
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    say "✗ 自动安装后仍未检测到 curl 或 wget。"
    return 1
  fi
  node_major="$(node_major_version)"
  if (( node_major < 18 )); then
    say "✗ 当前 Node.js 主版本为 $node_major，仍低于 18。"
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

stop_pid_file() {
  local file="$1" pid
  [[ -f "$file" ]] || return 0
  pid="$(cat "$file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$file"
}

stop_service() {
  stop_pid_file "$PID_FILE"
  stop_pid_file "$CHILD_PID_FILE"
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
  HOME_RELAY_CONFIG_FILE="$CONFIG_FILE" HOME_RELAY_PORT="$port" node <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const configPath = process.env.HOME_RELAY_CONFIG_FILE;
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {}
if (typeof config.subscriptionToken !== 'string' || config.subscriptionToken.length < 32) {
  config.subscriptionToken = crypto.randomBytes(32).toString('base64url');
}
config.host = '127.0.0.1';
config.port = Number(process.env.HOME_RELAY_PORT);
const tempPath = `${configPath}.${process.pid}.tmp`;
fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(tempPath, configPath);
try { fs.chmodSync(configPath, 0o600); } catch {}
NODE
  (
    cd "$INSTALL_DIR"
    nohup node src/supervisor.js >> "$LOG_FILE" 2>&1 &
    printf '%s\n' "$!" > "$PID_FILE"
  )
  sleep 1
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    say "启动失败，请查看日志：$LOG_FILE"
    return 1
  fi
  local child_pid
  child_pid="$(cat "$CHILD_PID_FILE" 2>/dev/null || true)"
  if [[ ! "$child_pid" =~ ^[0-9]+$ ]] || ! kill -0 "$child_pid" 2>/dev/null; then
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
