# ADR-003：路由围栏以 connection.requestRejection 为主

- 状态：Accepted（2026-10-18）
- 背景：分组路由只允许本机同源页面访问；Host spike 实测 `ctx.connection.requestRejection(req)` 会返回 401/403/undefined，覆盖无 cookie、坏 Host、跨站 Origin、cross-site fetch。
- 决策：
  - 正式路径必须使用 `requestRejection`；不可用时改用 `connection.fetch.register`；
  - 两者都不可用则 fail-closed 503，不启用弱 loopback-only 兜底；
  - body 限制 256 KiB，只接受 JSON；不设 CORS。
- 后果：第三方 host 插件若没有 connection 服务将无法提供分组路由；这是有意的安全取舍。
