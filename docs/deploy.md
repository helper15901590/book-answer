# 部署手册（Remix Remix 0.991 · 生产上线）

> 适用场景：单台 Linux VPS + Docker 单实例部署（内测期 HTTP 直连，域名备案后经 Caddy 切 HTTPS）。
> 仓库内相关文件：`docker/Dockerfile`、`docker/compose.yaml`、`docker/Caddyfile.template`、`.env.example`、`scripts/smoke.sh`、`scripts/backup.sh`。

## 1. VPS 准备

```bash
# Docker 引擎 + Compose 插件（Debian/Ubuntu 官方脚本方式）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 重新登录生效
docker compose version          # 确认可用

# 备份脚本依赖宿主机 sqlite3（热备份 .backup 命令）
sudo apt install -y sqlite3

# 防火墙：内测期仅放行 SSH + 应用端口；80/443 备案后再开
sudo ufw allow OpenSSH
sudo ufw allow 3000/tcp
sudo ufw enable
```

## 2. 首次部署

```bash
git clone <仓库地址> remix && cd remix    # 或 scp/rsync 上传代码
cp .env.example .env
```

编辑根目录 `.env`（**严禁提交入库**，`.gitignore` 已排除）：

| 键 | 说明 |
|----|------|
| `JWT_SECRET` | 必填，≥16 字符，`openssl rand -hex 32` 生成；缺失时生产环境拒绝启动（fail-fast） |
| `ADMIN_PHONE` / `ADMIN_PASSWORD` | 管理后台登录凭证（`POST /api/admin/login` 直接比对，**管理员账号不入库**、不出现在用户列表）；密码**必须为 6 位数字**，缺失或格式错误时后台无法登录并在启动日志告警 |
| `HOST_PORT` | 宿主端口，默认 3000 |
| `TRUST_PROXY` | 直连部署保持 `0`；仅 Caddy 反代时置 `1`（见 §5） |
| LLM 各键 | 可留空（离线兜底模板回复），也可管理员登录后在 `/admin` 后台配置（存数据库） |

> **HOST_PORT 特别注意**：compose 的端口映射写作 `"${HOST_PORT:-3000}:3000"`，这里的变量插值由 **docker compose 自己**完成，读取的是 **docker/ 目录（compose 文件所在目录）下的 `.env` 或 shell 环境变量**，而 `env_file: ../.env` 只注入**容器内运行时变量**、不参与插值。因此改宿主端口有两种方式：① `HOST_PORT=8080 docker compose -f docker/compose.yaml up -d`；② 在 `docker/` 目录下另建一个只含 `HOST_PORT` 的 `.env`。写在项目根 `.env` 里的 `HOST_PORT` **不会生效**。

启动：

```bash
docker compose -f docker/compose.yaml up -d --build
docker compose -f docker/compose.yaml ps        # 等待 STATUS 变为 healthy（healthcheck 每 30s 探测 /api/health）
docker compose -f docker/compose.yaml logs app  # 应看到 DB 初始化日志且无 better-sqlite3 原生模块报错；若配置了管理员凭证则无「⚠️ 管理员凭证未配置」告警
```

数据持久化：compose 将宿主 `./data` 挂载为容器 `/app/data`（`DATA_DIR=/app/data`），数据库（`commercial.sqlite` + WAL/SHM）、上传素材（`assets/`）、备份（`backups/`）全部落在宿主 `data/` 目录，容器重建不丢数据。

> **升级注意（JWT_SECRET 已改为读取时 trim）**：若既有部署的 `JWT_SECRET` 值首尾含空白字符，升级后签名密钥实际值变化，**所有旧 token 失效，用户需重新登录**。属预期行为，无需处理；新建部署不受影响。

## 3. 冒烟验证

部署后（以及每次发布后）执行：

```bash
BASE=http://<IP>:3000 ADMIN_PHONE=<管理员手机号> ADMIN_CODE=<管理员6位密码> bash scripts/smoke.sh
```

脚本断言：health 200；公开配置不含 `apiKey`、含 `dailyLimits`；游客访问 admin 端点 403；注册/支付端点已移除（404）；未知手机号登录 404；管理员登录 → 访问 stats → 登录响应不含 password → 聊天链路（无 LLM key 时走离线兜底）；首页与 `/admin` 入口可达。全部通过时退出码为 0。

> **限流说明**：登录接口限流 10 次/分/IP，冒烟脚本管理员链路只发起 2 次登录请求，加上未注册手机号探测共 3 次，不会触发限流；但**1 分钟内反复重跑脚本可能撞上登录限流**（返回 429 导致断言失败），重跑请间隔 1 分钟。

## 4. 备份 crontab

```bash
chmod +x scripts/backup.sh
crontab -e
# 每天 04:00 热备份（sqlite3 .backup 在线一致性快照），保留 14 天：
0 4 * * * /opt/remix/scripts/backup.sh >> /opt/remix/data/backups/backup.log 2>&1
```

备份产物：`data/backups/db-YYYY-MM-DD.sqlite`，超过 14 天自动清理。

**恢复步骤**：

```bash
docker compose -f docker/compose.yaml stop app
cp data/backups/db-2026-09-07.sqlite data/commercial.sqlite
rm -f data/commercial.sqlite-wal data/commercial.sqlite-shm   # 旧 WAL/SHM 必须一并清除
docker compose -f docker/compose.yaml up -d app
curl -s http://localhost:3000/api/health                       # 确认恢复成功
```

## 5. 备案后切 HTTPS

1. 生成正式 Caddyfile：`cp docker/Caddyfile.template docker/Caddyfile`，把 `你的域名.com` 替换为已备案域名（该文件含真实域名，`.dockerignore` 已排除，勿提交）。
2. **在根 `.env` 中设置 `TRUST_PROXY=1`（必做）**：Caddy 反代后，若不开启该开关，express-rate-limit 看到的客户端 IP 全部是容器网关 IP，**所有用户共享同一个限流桶**（全局 300/分、登录 10/分会被全站用户共同消耗，极易误伤）。开启后以 `X-Forwarded-For` 第一跳计真实 IP。直连部署（无反代）严禁开启，否则客户端可伪造该头绕过限流。
3. 防火墙放行 `80/tcp`、`443/tcp`。
4. 启动：`docker compose -f docker/compose.yaml --profile https up -d`（Caddy 自动申请/续期 Let's Encrypt 证书；模板已含 `flush_interval -1` 保障 SSE 流式不缓冲）。
5. 验证：`https://域名/admin` 可打开管理后台登录页；`curl -s https://域名/api/health` 返回 200；再跑一遍 §3 冒烟（`BASE=https://域名`）。
6. 此时可将应用端口从公网收回（防火墙删除 3000 放行，仅保留 SSH + 80/443）。

## 6. 残余风险声明（内测期已知并接受）

- **HTTP 明文**：备案前直连 HTTP，JWT 与密码可被链路嗅探，仅限小范围可信网络内测使用。
- **6 位数字密码**：密码空间 10^6 有限，依赖登录限流（10 次/分/IP）缓解撞库；建议管理员账号使用高熵 6 位数字并定期更换。
- **单实例架构**：better-sqlite3 本地文件 + 进程内状态，不支持水平扩展/多副本；扩容需先改造存储层。
- **匿名聊天 IP 限流共享**：匿名聊天按 IP 限流 10 次/分：同一 NAT 出口的多位游客共享该桶（内测规模可接受；已认证用户不受影响，走配额体系）。
- **chat userId 无 JWT 时被信任（历史遗留）**：知道他人 userId 者可读其会话历史。UUID 随机化已大幅提高猜测门槛，内测期（≤500 用户、管理员建号）接受该风险；后续迭代应改为仅信 req.user 并为游客发放临时会话凭据。
- **管理员重置密码不吊销旧 JWT**：管理员重置用户密码后，该用户已签发的 JWT 在到期前（≤7 天）仍然有效；如需立即失效可删除用户重建或等待过期。

## 7. 日常运维

```bash
# 日志
docker compose -f docker/compose.yaml logs -f app

# 更新发布
git pull
docker compose -f docker/compose.yaml up -d --build   # 重建镜像并滚动替换，data/ 卷不动
bash scripts/smoke.sh                                  # 发布后冒烟（BASE=... ADMIN_PHONE=... ADMIN_CODE=...）

# 重启 / 停止（SIGTERM 优雅关闭：停止接流 → 关闭数据库，10s 超时兜底退出）
docker compose -f docker/compose.yaml restart app
docker compose -f docker/compose.yaml down             # 仅删容器与网络，data/ 在宿主持久保留
```

**数据目录说明**（宿主 `data/`，即容器 `/app/data`）：

| 路径 | 内容 |
|------|------|
| `commercial.sqlite`（+`-wal`/`-shm`） | 主数据库（users/skills/chat_sessions/orders/system_config），WAL 模式 write-through |
| `assets/` | 后台上传的素材（`/assets` 静态服务） |
| `backups/` | backup.sh 产物与 cron 日志 |

迁移/克隆部署时整目录打包 `data/` 即可；**任何情况下不要将 `data/`、`.env` 提交入 git**。
