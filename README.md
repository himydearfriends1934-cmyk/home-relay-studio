# Home Relay Studio

一个本地化的静态家宽中转管理器。

目标：

- 吃各种常见订阅
- 把前端原始订阅和后端家宽出口分开维护
- 用规则把指定协议/节点分配到指定家宽
- 生成 sing-box 可用的链式代理配置
- 做端口、UDP、规则和链路一致性检测

## 运行

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

