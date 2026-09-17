# 部署手册（book_answer 单机生产版）

> 适用架构：单台 Linux VPS、单实例 Node、SQLite WAL、Caddy HTTPS。该架构不支持多副本或水平扩展。

## 1. 系统准备

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin sqlite3 restic curl
sudo usermod -aG docker "$USER"
```

重新登录后确认 `docker compose version` 可用。

**另外需要宿主机有 Node 22 + npm**：§7、§8、§10 里的 `npm run ...` 命令是在源码目录里执行的运维脚本，不在容器内，镜像里也不包含它们。

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # 应输出 v22.x
```

不想装 Node 的话，这些脚本也可以用容器跑，例如清空账号：

```bash
docker run --rm -v "$PWD:/app" -w /app node:22-bookworm-slim bash -lc 'npm ci && CONFIRM_ACCOUNT_RESET=RESET_ACCOUNTS npm run db:reset-accounts'
```

## 2. 配置环境变量

```bash
cp .env.example .env
openssl rand -base64 32
```

将生成值写入 `APP_ENCRYPTION_KEY`，并配置：

- `APP_ORIGIN=https://实际域名`
- `APP_ENCRYPTION_KEY`：32 字节 base64，缺失时拒绝启动
- `ADMIN_PHONE`：11 位手机号
- `ADMIN_PASSWORD`：至少 16 位且包含字母和数字
- `TRUST_PROXY=1`：仅 Caddy 反代时启用
- `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`：可选，也可首次登录后台配置
- `SENTRY_DSN`：错误跟踪
- `HEALTHCHECK_PING_URL`：外部健康检查回调
- `RESTIC_REPOSITORY` / `RESTIC_PASSWORD` / S3 凭据：异地备份

项目不再使用 `JWT_SECRET`，登录态由服务端会话表和 HttpOnly Cookie 提供。

## 3. 数据目录

```bash
mkdir -p data
sudo chown -R 1000:1000 data
```

SQLite、上传图片和本地备份均位于 `data/`。异地备份由 restic 写入 S3 兼容对象存储。

## 4. 启动 HTTPS 服务

```bash
cp docker/Caddyfile.template docker/Caddyfile
# 编辑 docker/Caddyfile，替换域名
docker compose -f docker/compose.yaml --profile https up -d --build
docker compose -f docker/compose.yaml ps
```

应用 3000 端口默认仅绑定宿主机回环地址，不允许绕过 Caddy 直接访问。

### 内测替代方案：无域名、IP 直连

尚无域名与证书时，可用 `http://公网IP:3000` 先跑内测。该模式**没有传输加密**，密码与手机号在公网明文传输，仅限小范围可信内测，正式上线前必须切回上文的 HTTPS 方案。

`.env` 需按下列三处调整：

```dotenv
APP_ORIGIN="http://公网IP:3000"   # 必须是用户实际访问的地址，否则 CSRF 校验会拒绝所有写请求
BIND_ADDRESS="0.0.0.0"            # 默认 127.0.0.1 只监听回环，公网访问不到
TRUST_PROXY="0"                   # 直连没有反向代理，必须为 0，否则限流可被伪造请求头绕过
ALLOW_INSECURE_HTTP="1"           # 关闭 Cookie Secure、CSP upgrade-insecure-requests 与 HSTS
```

启动（**不加** `--profile https`，不启动 Caddy）：

```bash
docker compose --env-file .env -f docker/compose.yaml up -d --build
```

随后在云厂商控制台的安全组放行 3000 端口（TCP 入方向，来源按内测范围收紧到具体 IP 更安全）。

`ALLOW_INSECURE_HTTP=1` 会关闭三项 HTTPS 强制策略，缺一不可：

- **Cookie `Secure` 标记**：带该标记的 Cookie 在 `http://` 下会被浏览器直接丢弃，表现为"登录成功但立刻掉线"。
- **CSP `upgrade-insecure-requests`**：浏览器会把所有 JS/CSS/接口请求升级为 `https://`，而服务端没有 TLS 监听，导致整页白屏。
- **HSTS**：一旦后续在同一台机器上启用过 HTTPS，浏览器会记住并强制跳转，排查困难。

服务启动时会打印一条 `⚠️ ALLOW_INSECURE_HTTP=1` 告警，属预期提示。

**切换到 HTTPS 时**：配置域名并解析 → 将 `APP_ORIGIN` 改为 `https://域名`、`BIND_ADDRESS` 改回 `127.0.0.1`、`TRUST_PROXY` 设为 `1`、删除或置 `ALLOW_INSECURE_HTTP=0` → 准备 `docker/Caddyfile` 后按 §4 用 `--profile https` 重新启动。切换后所有用户需要重新登录。

## 5. 首次管理员登录

1. 打开 `https://域名/leonchan1590`。
2. 输入 `ADMIN_PHONE` 和 `ADMIN_PASSWORD`。
3. 系统要求绑定 TOTP，显示 Base32 密钥和 8 个恢复码。
4. 恢复码仅显示一次，必须离线保存。
5. 输入认证器动态验证码完成绑定，后续登录必须提供 TOTP 或一次性恢复码。

管理员会话固定 8 小时，不滚动续期。修改环境变量中的管理员密码或重置 MFA 后，已有管理员会话失效。

**不想使用认证器 App 时**：在 `.env` 中设置 `ADMIN_SECOND_PASSWORD`（至少 8 位、需与管理员密码不同）并把 `ADMIN_MFA_ENABLED` 设为 `0`，登录时额外填写这个安全码即可，全程无需任何 App。（两者同时启用时两重都需通过，一般二选一即可。）

**若两者都未配置**，管理员账号就只剩单重密码防护——而管理员可重置任意用户密码、查看全部手机号、修改 LLM 接口地址，一旦泄露等同于整个系统失守。因此正式对外前，务必启用动态验证码，或至少配置一个安全码。

## 6. 用户账号

系统不开放自助注册：

- 管理员在后台创建账号。
- 系统生成 16 字符临时密码，只显示一次。
- 用户首次登录必须设置至少 6 位的新密码（不强制字符组合，界面实时提示强度与风险）。
- 管理员重置密码会撤销用户全部旧会话。
- 禁用账号会立即撤销全部会话。

## 7. 发布前清空旧账号

本次上线将清空旧账号、会话和订单，保留技能、标签、LLM 地址/模型和协议配置。先完成备份：

```bash
chmod +x scripts/*.sh
DATA_DIR="$PWD/data" bash scripts/backup.sh
CONFIRM_ACCOUNT_RESET=RESET_ACCOUNTS npm run db:reset-accounts
```

确认脚本输出后再重新运行冒烟测试。

## 8. 冒烟和容量验证

```bash
BASE_URL=http://公网IP:3000 ADMIN_PHONE=管理员手机号 ADMIN_PASSWORD=管理员密码 ADMIN_SECOND_PASSWORD=安全码 bash scripts/smoke.sh
BASE_URL=http://公网IP:3000/api/health CONNECTIONS=50 DURATION=30 npm run load:test
```

两点必须注意，否则冒烟会**假通过**：

- 变量名是 `BASE_URL` / `ADMIN_PASSWORD`（不是 `BASE` / `ADMIN_CODE`）。少了管理员密码，脚本会打印 `SKIP admin chain` 并照常报「通过」——后台登录、建号、清理整条链路其实一条都没验证。
- `BASE_URL` 必须与 `.env` 里的 `APP_ORIGIN` **完全一致**（含协议与端口）。脚本里的写操作会带 `Origin` 头，与 `APP_ORIGIN` 不符会被 CSRF 来源校验拒绝。

已启用动态验证码时再加 `ADMIN_TOTP_CODE=认证器当前 6 位码`。走 HTTPS 时把 `http://公网IP:3000` 换成 `https://域名`。

容量目标为 500 DAU、50 个并发登录用户、10 条并发 SSE。SSE 成本测试应使用模拟上游，禁止直接消耗真实模型预算。

## 9. 备份与恢复

每日异地备份，保留 30 天，RPO 24 小时、RTO 4 小时：

```bash
0 4 * * * cd /opt/book_answer && DATA_DIR=/opt/book_answer/data /opt/book_answer/scripts/backup.sh >> /opt/book_answer/data/backups/cron.log 2>&1
```

恢复：

```bash
docker compose -f docker/compose.yaml stop app
DATA_DIR="$PWD/data" bash scripts/restore.sh data/backups/book_answer-YYYY-MM-DD_HHMMSS.tar.gz
# 有域名时：docker compose -f docker/compose.yaml --profile https up -d app
# 无域名直连时：docker compose -f docker/compose.yaml up -d app
curl -fsS http://127.0.0.1:3000/api/health
```

`restore.sh` 结束前会把 `data/` 的属主归还为 `1000:1000`——容器以非 root 用户运行，若文件变成 root 所有，SQLite 会报 `readonly database`，登录与建号会全部失败。

每周至少执行一次 `scripts/verify-backup.sh` 并在隔离目录完成恢复演练。

## 10. 上线检查

```bash
npm run verify
docker compose -f docker/compose.yaml config
```

验收要求：

- 未登录访问聊天、会话 API 返回 401
- 公开技能接口不含 `systemPrompt`
- 用户无法读取、续写或删除他人会话
- 管理员必须完成 TOTP，恢复码只能使用一次
- 改密或禁用后旧会话立即失效
- LLM 上游失败时配额自动回退
- 健康检查包含数据库连通性
- 异地备份可恢复且 `PRAGMA integrity_check` 返回 ok

## 11. 当前边界

- 不支持多实例、高可用或蓝绿发布
- 不包含在线支付、退款、发票和支付回调
- 会员仍由管理员手工开通
- SQLite 写操作同步执行，业务增长后应评估 PostgreSQL、Redis 和对象存储