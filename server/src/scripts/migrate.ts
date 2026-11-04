import mongoose from 'mongoose';
import { connectDb } from '../db';
import { runMigrations } from '../migrations/runner';

await connectDb(3);
await runMigrations(mongoose.connection.db!);
console.log('Migrations are up to date.');
await mongoose.disconnect();
