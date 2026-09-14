# 部署手册（Remix AI 单机生产版）

> 适用架构：单台 Linux VPS、单实例 Node、SQLite WAL、Caddy HTTPS。该架构不支持多副本或水平扩展。

## 1. 系统准备

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin sqlite3 restic curl
sudo usermod -aG docker "$USER"
```

重新登录后确认 `docker compose version` 可用。

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

## 5. 首次管理员登录

1. 打开 `https://域名/leonchan1590`。
2. 输入 `ADMIN_PHONE` 和 `ADMIN_PASSWORD`。
3. 系统要求绑定 TOTP，显示 Base32 密钥和 8 个恢复码。
4. 恢复码仅显示一次，必须离线保存。
5. 输入认证器动态验证码完成绑定，后续登录必须提供 TOTP 或一次性恢复码。

管理员会话固定 8 小时，不滚动续期。修改环境变量中的管理员密码或重置 MFA 后，已有管理员会话失效。

## 6. 用户账号

系统不开放自助注册：

- 管理员在后台创建账号。
- 系统生成 16 字符临时密码，只显示一次。
- 用户首次登录必须设置至少 12 位、包含字母和数字的长期密码。
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
BASE=https://域名 ADMIN_PHONE=管理员手机号 ADMIN_CODE=管理员密码 bash scripts/smoke.sh
BASE_URL=https://域名/api/health CONNECTIONS=50 DURATION=30 npm run load:test
```

容量目标为 500 DAU、50 个并发登录用户、10 条并发 SSE。SSE 成本测试应使用模拟上游，禁止直接消耗真实模型预算。

## 9. 备份与恢复

每日异地备份，保留 30 天，RPO 24 小时、RTO 4 小时：

```bash
0 4 * * * cd /opt/remix && DATA_DIR=/opt/remix/data /opt/remix/scripts/backup.sh >> /opt/remix/data/backups/cron.log 2>&1
```

恢复：

```bash
docker compose -f docker/compose.yaml stop app
DATA_DIR="$PWD/data" bash scripts/restore.sh data/backups/remix-YYYY-MM-DD_HHMMSS.tar.gz
docker compose -f docker/compose.yaml --profile https up -d app
curl -fsS https://域名/api/health
```

每周至少执行一次 `scripts/verify-backup.sh` 并在隔离目录完成恢复演练。

## 10. 上线检查

```bash
npm run verify
docker compose -f docker/compose.yaml config
```

验收要求：

- 未登录访问聊天、会话 API 返回 401
- 公开技能接口不含 `systemPrompt`、`bookContent`、`catalogContent`
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