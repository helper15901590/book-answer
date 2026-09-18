# ---- 构建阶段 ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
# --ignore-scripts：跳过 better-sqlite3 的隐式 node-gyp rebuild（slim 镜像无 Python；
# 其 npm 包已内置 prebuilds/linux-x64.node，运行时按平台自动加载，无需本地编译）。
# esbuild 的 postinstall（vite 构建依赖）随后显式补跑。
RUN npm ci --ignore-scripts && node node_modules/esbuild/install.js
COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# 同上：better-sqlite3 用内置 prebuilds，其余生产依赖无需 install 脚本
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# 非 root 运行（uid 1000）：宿主挂载的 data/ 需 chown 1000:1000，见 docs/deploy.md §2
USER node
EXPOSE 3000
CMD ["node", "dist-server/server.cjs"]
