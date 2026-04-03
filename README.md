# Binance Alpha Monitor

币安 Alpha 代币实时监控工具，追踪积分倍数、价格基准变化、24h 涨跌、本地稳定度和第三方参考稳定度等核心数据。

## 功能

- **积分倍数监控**：实时显示每个代币的 `mulPoint`（1x / 2x / 3x / 4x）
- **价格基准变化**：记录开始监控时的价格作为基准，实时计算涨跌幅，支持手动重置基准
- **24h 涨跌 / 成交量 / 市值**：来自 Binance API
- **本地稳定度**：本地服务基于 Binance `bidPrice/askPrice` 计算 `spread bps`，无盘口时降级为 24h 波动率估算
- **第三方参考稳定度**：单独展示第三方 feed 的稳定度、`spread bps` 和 `4倍天数`
- **SSE 实时推送**：本地代理启动后，前端优先通过 SSE 接收数据
- **轮询降级**：本地代理不可用时，前端自动退回浏览器侧拉取
- **倍数筛选 / 搜索 / 排序**：支持按倍数、成交量、涨跌幅、市值、本地稳定度筛选和排序

## 快速开始

```bash
npm install
```

启动本地代理服务：

```bash
npm run server
```

另开一个终端启动前端：

```bash
npm run dev
```

浏览器打开 `http://localhost:5173`

推荐同时启动 `npm run server` 和 `npm run dev`。这样页面会优先走本地代理和 SSE，更新更快，也能避免浏览器侧 CORS 代理带来的延迟。

## 数据来源

- **Alpha 列表**：Binance Alpha API
- **实时价格 / 24h 统计 / 本地稳定度**：本地 `server/index.js` 拉取 Binance API 后计算
- **第三方参考稳定度**：本地 `server/index.js` 每 `1s` 拉取第三方稳定度 feed，并通过 SSE / 本地接口下发给前端

### 稳定度说明

- **本地稳定度**：项目自己的算法，不是官方口径
  - 有现货盘口时，显示 `spread bps`
  - 无现货盘口时，显示 `24h vol`
- **第三方参考**：第三方 feed 提供的稳定度、`spread bps`、`mul4Days`
- 两列会同时展示，便于直接对比不同口径

## 构建

```bash
npm run build
```

## 技术栈

- React 18
- Vite 5
- Node.js 本地代理 + SSE
- Binance API / Binance Alpha API
- 第三方稳定度 feed（通过本地服务拉取）
