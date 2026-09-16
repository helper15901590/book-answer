import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    // 首次在新机器上运行时 Vite 依赖需冷启动编译，超过 vitest 默认的 10 秒钩子超时
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      APP_ORIGIN: 'http://127.0.0.1:3000',
      APP_ENCRYPTION_KEY: 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=',
      ADMIN_PHONE: '13800000000',
      ADMIN_PASSWORD: 'AdminPass12345678!',
      // 固定管理员登录方式：测试用例覆盖的是动态验证码链路，
      // 不固定则会被开发机 .env 里的开关影响，导致本地能过、CI 挂掉（或反之）
      ADMIN_MFA_ENABLED: '1',
      ADMIN_SECOND_PASSWORD: '',
      DATA_DIR: './.test-runtime',
    },
  },
});