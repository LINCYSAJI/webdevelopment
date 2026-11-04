import mongoose from 'mongoose';
import { config } from './config';
import { connectDb } from './db';
import { createApp } from './app';
import { runMigrations } from './migrations/runner';

async function main() {
  await connectDb();
  console.log('Connected to database.');
  await runMigrations(mongoose.connection.db!);

  const server = createApp().listen(config.PORT, () => {
    console.log(`API server running at http://localhost:${config.PORT}`);
  });

  const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
