import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Real providers are added in build step 9. `dev_outbox` stores emails in the database
  // and shows them on the development mailbox page; it is refused in production.
  EMAIL_PROVIDER: z.enum(['dev_outbox']).default('dev_outbox'),
  // SMS (mobile OTP only). `dev_outbox` shows messages in the test mailbox; a DLT-registered
  // Indian SMS gateway is added in build step 9. Refused in production.
  SMS_PROVIDER: z.enum(['dev_outbox']).default('dev_outbox'),
  // Private file storage. `local` keeps files in a folder on this computer (development only);
  // the private S3-compatible bucket is added in build step 9.
  STORAGE_PROVIDER: z.enum(['local']).default('local'),
  LOCAL_STORAGE_DIR: z.string().min(1).default('storage'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid server configuration (check server/.env):');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.EMAIL_PROVIDER === 'dev_outbox') {
  console.error('EMAIL_PROVIDER=dev_outbox is for development only. Configure a real email provider.');
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.SMS_PROVIDER === 'dev_outbox') {
  console.error('SMS_PROVIDER=dev_outbox is for development only. Configure a real SMS gateway.');
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.STORAGE_PROVIDER === 'local') {
  console.error('STORAGE_PROVIDER=local is for development only. Configure the private storage bucket.');
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  accessTokenMinutes: 10,
  refreshTokenDays: 7,
  loginLockout: { maxAttempts: 5, windowMinutes: 15, lockMinutes: 15 },
};
