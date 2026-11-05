# JMS 洛杉矶适配（实验版）

基于 Aethersailor/subweb 原有 Cloudflare Pages 部署，普通转换流程保持原有逻辑。JMS 部分使用 Pages Functions，不能直接作为纯静态站点使用。

## 配置

创建隔离的 Pages 测试项目并配置 secrets：

- `JMS_ACCESS_TOKEN`：使用安全随机数生成的 32–128 位 URL 安全令牌。
- `JMS_SUBSCRIPTION_URL`：JMS 的 Clash YAML 订阅地址，必须为 jmssub.net 或 jjsubmarines.com HTTPS 地址。
- `JMS_BANDWIDTH_URL`：JMS bandwidth counter 的 justmysocks6.net HTTPS 地址。

不要将实际值写入代码、公开仓库、构建日志或测试数据。每个预览环境应使用单独令牌和测试凭据；不要向公共预览部署输入生产 Secret。按上游 `DEPLOY_CLOUDFLARE.md` 通过 `npm ci` 和 `npm run build` 构建，输出 `dist`，Pages Functions 从 `functions/` 构建。Pages 路由已包含 `/jms/*`。

在网页的 JMS 区域输入令牌并复制地址。此链接及其中的令牌应视为密码。生成的配置由公共 Aethersailor 后端转换，原始订阅地址会发给该后端。流量 API 不传给公共后端。配置内 provider 指向此服务，访问令牌同样会出现在 provider URL；客户端可获得节点凭据。使用时务必限制访问并检查 Cloudflare/客户端日志。

## 功能与限制

- 固定使用 Aethersailor Custom_Clash_Full 模板，原版普通转换页面仍可选择其他模板。JMS 模式当前不读取页面上的其他选项。
- 依据 `JMS_Full_Node_Adapter_v2.conf` 调整分组和 UDP；不影响路由器其他覆写。s4/s5 名称延续现有习惯，不能据此证明最终出口地区。
- 流量 API 返回合计用量，没有上下载拆分；以 `upload=0; download=合计` 适配客户端显示，不表示实际没有上传。重置日 1–28 按美国洛杉矶当地零点估算下一次日期并写入 expire，可能被客户端标为到期日；29–31 日暂不输出日期。API 不可用时不输出用量表头。
- 不接受来自网页的任意上游地址；上游地址只来自部署者设置的 Secret，并限制主机名。禁止重定向。生成配置不应包含原始订阅地址；实际部署前仍须验证完整输出和上游响应。
- 无法保证各客户端、地区网络和 Cloudflare 免费 CPU 限制下均可用。未经真实设备和 Cloudflare 预览环境测试，不应替换现有订阅。上线前检查用户认证、日志/追踪脱敏、上游规则和失败回退。

## 本地验证

```
npm ci
npm run build
node --test tests/jms.test.js
```
