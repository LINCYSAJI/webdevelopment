import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Production: the built website (client/dist) served by this server, so the website and the
  // API share one address. Relative to server/. Leave empty when the website is hosted elsewhere.
  CLIENT_DIST_DIR: z.string().trim().optional(),
  // How many proxies / load balancers sit in front of the server (for correct visitor IPs).
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
  // Email. `dev_outbox` stores emails in the database and shows them on the development mailbox
  // page (refused in production); `smtp` sends through any email provider's SMTP service.
  EMAIL_PROVIDER: z.enum(['dev_outbox', 'smtp']).default('dev_outbox'),
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().trim().optional(),
  EMAIL_REPLY_TO: z.string().trim().optional(),
  // SMS. `dev_outbox` shows messages in the test mailbox (refused in production);
  // `networkz` sends through the Networkz Systems gateway with DLT-registered templates.
  SMS_PROVIDER: z.enum(['dev_outbox', 'networkz']).default('dev_outbox'),
  // Networkz Systems gateway (https://message.networkzsystems.com). The token and its key are
  // secrets: keep them in .env only. Entity ID and sender ID come from your DLT registration.
  NETWORKZ_SMS_BASE_URL: z.string().url().default('https://message.networkzsystems.com'),
  NETWORKZ_SMS_ACCESS_TOKEN: z.string().trim().optional(),
  NETWORKZ_SMS_ACCESS_TOKEN_KEY: z.string().trim().optional(),
  NETWORKZ_SMS_ENTITY_ID: z.string().trim().optional(),
  NETWORKZ_SMS_SENDER_ID: z.string().trim().optional(),
  NETWORKZ_SMS_ROUTE: z.enum(['transactional', 'promotional']).default('transactional'),
  // 1 = the gateway checks each message against the DLT templates listed in its panel.
  NETWORKZ_SMS_TEMPLATE_MATCHING: z.enum(['0', '1']).default('0'),
  // Optional delivery webhook: the webhook ID from the Networkz panel, and a secret sent by the
  // panel in the "X-Webhook-Secret" header so only Networkz can post delivery updates.
  NETWORKZ_SMS_WEBHOOK_ID: z.string().trim().optional(),
  NETWORKZ_SMS_WEBHOOK_SECRET: z.string().trim().optional(),
  // Private file storage. `local` keeps files in a folder on this computer (development only);
  // `s3` uses a private S3-compatible bucket (AWS S3, Cloudflare R2, DigitalOcean Spaces, ...).
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().min(1).default('storage'),
  S3_BUCKET: z.string().trim().optional(),
  S3_REGION: z.string().trim().default('ap-south-1'),
  // Only for providers other than AWS, e.g. https://<account>.r2.cloudflarestorage.com
  S3_ENDPOINT: z.string().trim().optional(),
  S3_ACCESS_KEY_ID: z.string().trim().optional(),
  S3_SECRET_ACCESS_KEY: z.string().trim().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid server configuration (check server/.env):');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const fail = (message: string) => {
  console.error(message);
  process.exit(1);
};
const env = parsed.data;

// A provider's required settings, whatever the environment.
if (env.EMAIL_PROVIDER === 'smtp') {
  if (!env.SMTP_HOST) fail('EMAIL_PROVIDER=smtp needs SMTP_HOST.');
  if (!env.EMAIL_FROM) fail('EMAIL_PROVIDER=smtp needs EMAIL_FROM, e.g. "Franchise Portal <no-reply@yourcompany.in>".');
}
if (env.STORAGE_PROVIDER === 's3') {
  if (!env.S3_BUCKET) fail('STORAGE_PROVIDER=s3 needs S3_BUCKET.');
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) fail('STORAGE_PROVIDER=s3 needs S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
}

if (env.NODE_ENV === 'production') {
  if (!env.CLIENT_ORIGIN.startsWith('https://')) fail('CLIENT_ORIGIN must be an https:// address in production.');
  if (/mongodb:\/\/(localhost|127\.0\.0\.1)/.test(env.MONGODB_URI)) fail('MONGODB_URI points to a local database. Use the MongoDB Atlas connection string in production.');
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
