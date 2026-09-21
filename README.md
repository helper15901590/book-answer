# book_answer

经典著作与导师人物 AI 思想蒸馏平台。匿名用户可以浏览市场和技能详情，所有 AI 对话、历史会话和配额操作都要求登录。

## 本地运行

前置：Node.js 22、npm。

```bash
npm install
cp .env.example .env.local
```

至少配置：

```dotenv
APP_ORIGIN=http://localhost:3000
APP_ENCRYPTION_KEY=<openssl rand -base64 32 的结果>
ADMIN_PHONE=13800000000
ADMIN_PASSWORD=AdminPass12345678!
```

启动：

```bash
npm run dev
```

用户入口：`http://localhost:3000/`
管理后台：`http://localhost:3000/admin`

## 认证与权限

- 账号不开放自助注册，由管理员在后台创建。
- 用户首次登录使用一次性临时密码，必须设置至少 6 位的新密码（不强制字符组合，界面会实时提示强度与风险）。
- 管理员密码至少 16 位且包含字母和数字，首次登录必须绑定 TOTP，并保存一次性恢复码。
- 登录态由服务端会话、HttpOnly Cookie 和 CSRF Token 提供，不使用 localStorage JWT。
- 匿名用户不能创建会话、读取历史或发送消息。

## 常用命令

```bash
npm run lint
npm test
npm run build
npm run verify
npm run config:check
npm run load:test
```

生产部署、备份恢复和管理员 MFA 操作参见 `docs/deploy.md`。
