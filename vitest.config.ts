import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      APP_ORIGIN: 'http://127.0.0.1:3000',
      APP_ENCRYPTION_KEY: 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=',
      ADMIN_PHONE: '13800000000',
      ADMIN_PASSWORD: 'AdminPass12345678!',
      DATA_DIR: './.test-runtime',
    },
  },
});