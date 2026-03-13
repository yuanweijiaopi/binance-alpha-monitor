# Binance Alpha Monitor

币安 Alpha 代币实时监控工具，追踪积分倍数、价格基准变化、24h 涨跌等核心数据。

## 功能

- **积分倍数监控**：实时显示每个代币的 mulPoint（1x / 2x / 3x / 4x），4x 代币高亮闪烁
- **基准变化**：记录开始监控时的价格作为基准，实时计算涨跌幅，支持手动重置基准
- **24h 涨跌 / 成交量 / 市值**：直接来自币安 API
- **倍数筛选**：快速过滤 ≥1x / ≥2x / ≥3x / ≥4x 的代币
- **搜索**：按代币 symbol 搜索
- **排序**：支持按倍数、成交量、涨跌幅、市值排序
- **自动刷新**：5s / 15s / 30s / 1min / 3min 可选，内置倒计时

## 快速开始

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`

## 构建

```bash
npm run build
```

## 技术栈

- React 18
- Vite 5
- 币安 Alpha API（通过 CORS 代理访问）