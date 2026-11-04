# 用户自助注册 Implementation Plan

**Goal:** 在现有「管理员建号」之外，开放手机号 + 密码自助注册：登录框新增注册入口，注册成功自动登录；登录框常驻「忘记密码请联系管理员 陈亮」提示。注册用户默认普通会员，沿用现有免费额度与会员体系。

> **实施状态（2026-11-02）：已完成。** `npm run lint`、`npm test`（25 用例，新增注册集成用例）、`npm run build`、`npm run config:check` 全部通过；生产构建产物冒烟验证了注册成功、自动登录、重复手机号拒绝与公开配置 `registrationEnabled=true`。

**已确认的产品决策（2026-11-02）：**

| # | 决策 |
|---|------|
| D1 | 注册**始终开放**：不做后台开关，`authPolicy.registrationEnabled` 固定为 `true` |
| D2 | 注册成功**自动登录**：服务端直接签发会话，前端 `onSuccess` 进入平台 |
| D3 | 用户协议 / 隐私政策正文本次**不改**（其中「不开放自助注册」表述由运营后续在后台自行编辑） |

**非目标：** 短信验证码、找回密码/自助重置密码（仅提示联系管理员）、注册赠送会员、邀请码/风控验证码、后台注册开关。

---

## 1. 服务端设计

### 1.1 新接口

| 方法 | 路径 | 鉴权 | 请求 / 响应 |
|------|------|------|-------------|
| POST | `/api/auth/register` | 匿名（CSRF 中间件对无会话请求放行，与登录一致） | `{ phone: 11 位数字, password: ≥6 位 }` → `{ success: true, user }`，同时种下用户会话与 CSRF Cookie |

错误码：`INVALID_PHONE`（手机号格式）、`PHONE_EXISTS`（已注册或为管理员手机号）、`INVALID_PASSWORD`（不符合密码策略）、`RATE_LIMITED`（限流）。

### 1.2 注册流程

1. 独立限流桶：`5 次/分钟/IP`（注册是一次性动作，比登录更收紧，控制批量建号）。
2. 校验手机号格式；`phone === ADMIN_PHONE || db.getUserByPhone(phone)` → 400 `PHONE_EXISTS`。
3. 复用 `validateStrongPassword(password, USER_PASSWORD_MIN_LENGTH, phone, false)`：≥6 位、不含空白、不含手机号。
4. 建号字段与后台建号保持一致：`role='member'`、`status='active'`、`membershipTier='free_member'`、`nickname=手机尾号 4 位`、默认头像、`mustChangePassword=false`、`dailyMaxChats=tierDailyLimit(config,'free_member')`、`lastActiveDate=今天`。
5. `db.saveUser()` 落库；若并发撞 `phone` 唯一约束（SQLITE_CONSTRAINT）同样返回 `PHONE_EXISTS`。
6. `createUserSession()` 签发 30 天会话（含 CSRF Cookie），写 `audit(user_registered)`，返回 `sanitizeUser`。
7. `GET /api/config/public` 的 `authPolicy.registrationEnabled` 改为 `true`。

### 1.3 数据模型

无 schema 变更：复用 `users` 表与既有字段；手机号唯一约束天然阻止重复注册。

## 2. 前端设计（LoginModal）

- 新增 `step: 'register'`；登录表单底部显示两行小字：
  - 「忘记密码？请联系管理员 陈亮」（静态提示，无自助找回）；
  - 「还没有账号？立即注册」按钮，切到注册表单；注册表单底部「已有账号？去登录」。
- 注册表单：手机号、设置密码（≥6 位，实时强度提示）、确认密码、同意协议勾选；校验与登录一致（11 位手机号、两次密码一致、必须勾选协议）。
- 提交 `POST /api/auth/register`，成功直接 `onSuccess(user)` 自动登录；失败按错误码翻译（`PHONE_EXISTS` / `INVALID_PHONE` / `INVALID_PASSWORD`）。
- 注册入口按 `authPolicy.registrationEnabled` 显示（当前恒为 true；字段保留便于以后加开关）。
- 管理后台无改动。

## 3. i18n

`src/i18n/locales/zh-CN.ts` 的 `login` 分组新增：注册标题、注册提交按钮、切换登录/注册、忘记密码提示（含管理员姓名「陈亮」）、注册失败兜底；`server` 分组新增 `PHONE_EXISTS`、`INVALID_PHONE`。`en.ts` / `zh-TW.ts` 同步补齐；`serverMessage.ts` 增加两个错误码映射。

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| 批量垃圾注册 | 5 次/分钟/IP 限流；免费额度本身有限；后续如需验证码可在此接口前加 |
| 手机号枚举 | 注册接口必然返回「已注册」，属行业常规；登录失败仍保持统一模糊提示 |
| 并发同号注册 | 数据库唯一约束兜底，捕获 SQLITE_CONSTRAINT 转 `PHONE_EXISTS` |
| 管理员手机号被注册 | 与后台建号一致，显式排除 `ADMIN_PHONE` |
| 协议正文与新功能不一致 | 本次按决策不改；README/手册同步说明，正文由运营在后台编辑 |

## 5. 验收标准

- 匿名用户可在登录框注册；注册成功自动进入平台并可立即聊天（免费额度生效）。
- 重复手机号、管理员手机号、弱密码、连续快速请求均被正确拒绝且给出可翻译的错误码。
- 登录框常驻「忘记密码？请联系管理员 陈亮」提示。
- `npm run lint`、`npm test`、`npm run build`、`npm run config:check` 全部通过。
