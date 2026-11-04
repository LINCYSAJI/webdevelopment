import mongoose from 'mongoose';
import { config } from './config';

// Indexes are created by migrations only (CLAUDE.md rule 1), never automatically.
mongoose.set('autoIndex', false);
mongoose.set('strictQuery', true);

export async function connectDb(retries = 30): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 2000 });
      return;
    } catch (err) {
      if (attempt >= retries) throw err;
      console.log(`Waiting for database (attempt ${attempt}/${retries})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
