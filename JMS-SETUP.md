# JMS 洛杉矶适配（开发测试版）

保留上游普通转换页面。JMS 模式在网页填写原始 Clash 订阅及流量 API，调用 Aethersailor 公共转换后端，按当前 OpenClash 覆写模块处理洛杉矶分组，然后补充 `subscription-userinfo`。

## Cloudflare 一次性配置

- 建立独立 KV 命名空间，并在 Pages 项目目标环境中绑定为 `JMS_CONFIGS`。生产和预览必须分开。
- 在目标环境设置加密 Secret `JMS_ADMIN_KEY`，取 32–128 位 URL 安全随机字符。管理密钥只用于生成和撤销链接；用户在网页输入，不保存于浏览器或 Git。
- Pages 项目必须重新部署才能使用新绑定。预览测试使用虚构地址，绝不在公开预览环境放生产凭据。
- Pages 部署仍按上游 `DEPLOY_CLOUDFLARE.md`：`npm ci`、`npm run build`，输出 `dist`。需保留 `functions/` 和 `/jms/*` 路由。

## 使用与隐私边界

在网页输入 JMS Clash 订阅、Bandwidth Counter API 和管理密钥，点击生成并保存得到的订阅地址。配置保存于 KV，使用由随机订阅令牌派生的密钥作 AES-GCM 加密，KV 键保存令牌摘要。链接令牌能取回配置并派生解密密钥，**拿到链接的人可获取代理节点**；它不是管理密钥，仍要像密码保管。不要把任何凭据提交到仓库、聊天、截图或日志。

JMS 原始订阅地址会发送到 Aethersailor 公共后端。流量 API 不发送到该后端。输出的 provider 地址指向本站，并包含订阅令牌。Cloudflare 及被授权的站点代码能够处理明文；加密不能防范 Cloudflare 账号或 Worker 代码被攻陷。HTTP、浏览器、客户端及 Cloudflare 日志仍可能保存订阅链接或令牌，使用前必须检查日志和跟踪设置。

生成入口要求管理密钥及同源请求，限制指定 JMS HTTPS 主机名和路径，不接受重定向。应额外在 Cloudflare 配置免费可用的请求速率限制以降低滥用；不承诺管理端已抵抗暴力破解。网页可填写管理密钥并粘贴旧链接执行撤销；KV 缓存因最终一致性可能暂时继续生效，已下载节点仍可能有效。

## 功能限制

- JMS 模式当前固定 Aethersailor 重度分流模板，不读取普通转换表单的其他选项。普通模式仍由上游实现。
- 转换时向 Aethersailor 后端明确传入 `udp=true`，并校验返回 provider 的 UDP 覆写；不另行重写节点 UDP。并不等于 UDP 实测可用。
- API 无上下载拆分：`upload=0; download=合计` 只用于展示总量。每月第 1–28 日以洛杉矶时间零点估算下次重置并作为 `expire`；客户端可能误标为到期日。29–31 暂不显示日期。API 失败时不构造流量头。
- 当前仅本地虚构数据和公共后端模板测试，尚未在 Cloudflare 实际运行、检查 CPU、复核真实协议参数，或在 OpenClash/FlClash 验收；勿替换现有生产订阅。

## 验证

```sh
npm ci
npm run build
node --test tests/jms.test.js
```
