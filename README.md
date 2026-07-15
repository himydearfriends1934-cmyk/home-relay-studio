# Home Relay Studio

一个本地化的静态家宽中转管理器。

目标：

- 吃各种常见订阅
- 把前端原始订阅和后端家宽出口分开维护
- 用规则把指定协议/节点分配到指定家宽
- 生成 sing-box 可用的链式代理配置
- 做端口、UDP、规则和链路一致性检测

## 一条命令安装、更新或删除（推荐）

在 Linux 服务器终端粘贴下面这一条命令：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/himydearfriends1934-cmyk/home-relay-studio/main/setup.sh)
```

命令运行后会显示菜单：

```text
1. 全新安装（已安装时自动显示“更新系统”）
2. 删除系统
0. 退出
```

选择安装或更新后，程序会先检查系统环境；如果发现 Git、curl/wget 或 Node.js/npm 不完整，会根据系统包管理器自动补齐。默认安装在 `~/.home-relay-studio`；再次运行同一条命令即可更新或删除。

## 仓库内安装脚本

安装程序会先做系统环境检测，并在可用时自动补齐依赖：

- Git、curl/wget、CA 证书
- Node.js 22 LTS（兼容要求 18 或更高版本）和 npm
- 项目目录是否可写
- 服务端口是否可用

目前支持 `apt`、`dnf`、`yum`、`apk` 和 `pacman`。自动安装需要 root 或 `sudo` 权限。

如果服务器已经登录 Tailscale，安装程序会自动检测 `tailscale ip -4`，并让管理后台监听该 Tailscale 地址。这样浏览器可通过 Tailnet 访问后台，公网 IP 不会直接开放管理页；导出的节点和订阅仍按配置生成，可给外网客户端使用。

Source 里还可以勾选“与节点同 VPS”。你先填原始订阅地址，勾选后系统会自动把主机换成本机地址；也可以手动改成内网或 Tailscale 地址，甚至直接写 `127.0.0.1:port/path`。

Windows 用户可以双击 `install.cmd`，也可以在 PowerShell 中运行：

```powershell
.\install.cmd
```

Linux / macOS（已下载本仓库时）：

```bash
./install.sh
```

默认使用 `8787` 端口。如果端口已被占用，安装程序会寻找下一个可用端口，并提示是否替换。确认后，所选端口会保存到 `.home-relay-studio.json`。

安装结束后运行 `npm start`，然后打开安装程序显示的地址。

无人值守安装可指定端口，并允许自动替换被占用的端口：

```bash
node scripts/install.js --port 8787 --replace-port --yes
```

## 一键删除

Windows 用户双击 `uninstall.cmd`，Linux / macOS 运行 `./uninstall.sh`。删除程序会移除依赖和本地安装配置，默认保留 `data` 中的业务数据；如需连数据一起删除：

```bash
node scripts/uninstall.js --remove-data --yes
```

## 手动运行

```bash
npm install
npm start
```

默认打开 `http://127.0.0.1:8787`

## 设计

- `sources`：前端原始订阅目录
- `egresses`：家宽出口目录
- `rules`：映射规则
- `generate`：导出 sing-box 链式配置
- `diagnose`：做结构和连通性检查

## Public subscription-only endpoint

Keep the admin UI on a private address such as Tailscale. If a mobile client
cannot reach that private address, configure a separate public subscription
endpoint instead of exposing the whole admin UI.

Add these fields to `.home-relay-studio.json` or set matching environment
variables before starting the server:

```json
{
  "publicBaseUrl": "http://PUBLIC_IP:8790",
  "publicSubscriptionHost": "0.0.0.0",
  "publicSubscriptionPort": 8790
}
```

The public listener only serves `GET /api/export/*` and still requires the
subscription token. It does not expose `/api/state`, `/api/runtime`, or the admin
UI.
