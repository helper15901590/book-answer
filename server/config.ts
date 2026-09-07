import dotenv from 'dotenv';

// 本地开发加载 .env.local / .env（生产由容器环境变量注入，文件不存在时静默跳过）
dotenv.config({ path: ['.env.local', '.env'] });

export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3000;
