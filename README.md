# MerchantKit Community

面向小商家的微信小程序商城、网站与商家后台参考实现。原生小程序和 Next.js 服务端共用商品、会员、订单及履约接口。

**这是独立的社区发行版。示例商品、联系方式和图片用于开发测试；支付、短信默认模拟，邮件默认关闭。真实微信功能需要部署者自己的账号、权限和服务端密钥。**

Copyright 2026 青岛屿漠商贸有限公司 · [Apache-2.0](LICENSE) · [权利与来源边界](docs/rights-and-provenance.md)

## 功能

- 商品、款式与尺码选择、数量计价、购物袋、地址与结算。
- 会员资料、偏好问卷、积分、优惠券、邀请关系和任务记录。
- 微信学生身份验证、企微联系和社媒凭证的接入层；可选活动默认关闭。
- 订单、支付与退款状态、售后、物流与微信发货同步接入层。
- 自提点设置、按收货区域判断资格、取货码、核销与履约状态。
- 包裹服务、尺码表、洗护示例及分层隐私确认。
- 商家权限、状态校验、内容管理与操作记录。

第三方平台接入代码和模拟测试不代表平台权限已开通，也不代表真实交易、通知送达或各端体验已验收。见[验证范围](docs/verification.md)。

## 结构

```text
apps/web/       Next.js 网站、后台、接口与 Prisma 数据模型
apps/miniapp/   原生微信小程序及客户端回归测试
examples/      插件配置示例与原创占位图清单
scripts/       本地准备、公开内容检查与联合检查
tests/         社区发行、安全边界及示例配置测试
docs/          安装、架构、平台接入、权利和验证说明
```

## 本地启动

需要 Node.js 22.14+、pnpm 11.25.0、PostgreSQL 17。以下命令在项目根目录执行。

```sh
pnpm --dir apps/web install --frozen-lockfile --ignore-scripts
pnpm --dir apps/miniapp install --frozen-lockfile --ignore-scripts
pnpm --dir apps/web prisma:generate
npm run setup
```

使用自己的本地 PostgreSQL，或运行可选的 `docker compose up -d database`。默认只绑定本机 `127.0.0.1:55439`，数据库名 `merchantkit_demo`。Docker 示例的固定密码仅用于这个本机演示服务。

```sh
pnpm --dir apps/web db:migrate
pnpm --dir apps/web db:seed
npm run dev
```

打开 `http://127.0.0.1:3000`。演示后台入口为 `/admin/login`；虚构演示账号是 `13900000001`，密码由 `setup` 随机生成并保存到忽略的 `apps/web/.env.local` 的 `DEMO_ADMIN_PASSWORD`。请在本机查看，不要提交或发到公开讨论中。

`db:seed` 只接受本机专用演示/测试库，并要求空库；已有数据会被保留并拒绝重复初始化。详细步骤见[安装说明](docs/installation.md)。

## 小程序

在微信开发者工具导入 `apps/miniapp`。默认 `touristappid` 和占位组件用于查看结构；进行联网或完整功能测试前，按[微信接入](docs/wechat-integration.md)设置自己的 AppID、API 地址及需要的插件。

```sh
node scripts/configure-miniapp.mjs --api http://127.0.0.1:3000 --appid YOUR_APP_ID
```

开发者工具的本机 API 地址不能直接用于手机。手机测试需设置你自己的可访问 HTTPS 服务，并配置平台合法域名。所有 AppSecret、支付密钥和证书都只放服务端忽略的配置中。

## 检查

```sh
npm test
npm run check
```

集成测试单独运行，需要专用本机测试库：

```sh
# 先在本机创建 merchantkit_test，下面仅是虚构的本地连接示例。
# DATABASE_URL=postgresql://merchantkit_demo:merchantkit_demo@127.0.0.1:55439/merchantkit_test
pnpm --dir apps/web test:integration
```

测试入口拒绝远程数据库；每个集成套件使用新建的独立测试库，结束后清理。网络保护禁止对真实外部服务发起测试请求。

## 权利与贡献

开源许可覆盖本仓库实际包含的代码和文档。品牌照片、标识、原商业政策、客户数据、生产配置及未纳入文件不在这个发行版中。公开代码与商业版本有重合的部分，已授予的 Apache-2.0 权限持续适用。

第三方代码与图标保留各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。软件登记准备应区分自有部分、第三方部分和贡献者部分，见[权利说明](docs/rights-and-provenance.md)。

欢迎按 [CONTRIBUTING.md](CONTRIBUTING.md)提交可复现问题、测试和改进。此社区版首次公开时不宣称已有外部采用、下载量或社区规模。

## English summary

MerchantKit Community is a native WeChat commerce client with a Next.js storefront, merchant administration and PostgreSQL service layer. It includes membership, rewards, order/refund flows and offline pickup adapters. Fictional data and original demo graphics are included. External providers require the deployer's own credentials and permissions. See the installation, verification and licensing documents before deployment.
