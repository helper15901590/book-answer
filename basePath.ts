// 子路径部署的唯一配置点：页面、API 与上传素材全部挂在这个前缀之下（如 /bookanswer）。
// vite.config.ts（构建期 base）与 server/config.ts（运行时挂载）都从这里取值，
// 改这一行后重新构建即可生效，无需环境变量或构建参数。
// 同步项：docker/.env 的 BASE_PATH 仅用于容器健康检查拼 URL，改动这里时请一并核对。
export const BASE_PATH = '/bookanswer';
