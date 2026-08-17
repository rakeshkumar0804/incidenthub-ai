import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from workspace root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PORT: z.coerce.number().optional(),
  DATABASE_URL: z.string().default('postgresql://incidenthub:change_me@localhost:5432/incidenthub_dev'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:4000'),
  VITE_API_URL: z.string().default('http://localhost:4000'),
  JWT_SECRET: z.string().min(16).default('incidenthub-jwt-secret-key-development-minimum-32-chars-long'),
  JWT_REFRESH_SECRET: z.string().min(16).default('incidenthub-jwt-refresh-secret-key-development-minimum-32-chars-long'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  // eslint-disable-next-line no-console
  console.error('\n❌ Invalid or missing environment variables:');
  // eslint-disable-next-line no-console
  console.error(parseResult.error.format());
  // eslint-disable-next-line no-console
  console.error('\nCopy .env.example to .env and fill in required values.\n');
  process.exit(1);
}

if (parseResult.data.NODE_ENV === 'production') {
  if (parseResult.data.JWT_SECRET.includes('development')) {
    // eslint-disable-next-line no-console
    console.error('\n❌ Insecure JWT_SECRET in production mode');
    process.exit(1);
  }
}

const rawEnv = parseResult.data;

export const env = {
  ...rawEnv,
  PORT: rawEnv.API_PORT ?? rawEnv.PORT,
};

export type Env = typeof env;

export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
