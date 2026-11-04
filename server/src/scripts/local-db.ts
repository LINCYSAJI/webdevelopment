/**
 * Development only: runs a private MongoDB on this computer, so nothing needs installing.
 * Data is kept in server/.data/db between restarts. Production uses MongoDB Atlas instead.
 *
 * It runs as a one-member replica set because the workflow uses MongoDB transactions.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoBinary } from 'mongodb-memory-server';

const PORT = 27017;
const REPL_SET = 'rs0';
const dbPath = path.resolve('.data/db');
fs.mkdirSync(dbPath, { recursive: true });

console.log('Preparing the local database (the first run downloads MongoDB, which can take a few minutes)...');
const binary = await MongoBinary.getPath();

const mongod = spawn(
  binary,
  // The log file explains any unexpected stop (server/.data is not committed).
  ['--port', String(PORT), '--dbpath', dbPath, '--replSet', REPL_SET, '--bind_ip', '127.0.0.1', '--quiet', '--logpath', path.resolve('.data/mongod.log'), '--logappend'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
mongod.on('exit', (code) => {
  console.log(`Local database stopped (code ${code}).`);
  process.exit(code ?? 0);
});

const stop = () => mongod.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Wait for mongod to accept connections, then make sure the replica set is initialised.
const uri = `mongodb://127.0.0.1:${PORT}/?directConnection=true`;
let conn: mongoose.Connection | undefined;
for (let attempt = 0; attempt < 60 && !conn; attempt++) {
  try {
    conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 1000 }).asPromise();
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!conn) {
  console.error('The local database did not start.');
  stop();
  process.exit(1);
}

const admin = conn.db!.admin();
try {
  await admin.command({ replSetGetStatus: 1 });
} catch (err) {
  if ((err as { code?: number }).code !== 94) throw err; // 94 = NotYetInitialized
  await admin.command({
    replSetInitiate: { _id: REPL_SET, members: [{ _id: 0, host: `127.0.0.1:${PORT}` }] },
  });
}

for (let attempt = 0; attempt < 30; attempt++) {
  const hello = await admin.command({ hello: 1 });
  if (hello.isWritablePrimary) break;
  await new Promise((r) => setTimeout(r, 500));
}
await conn.close();

console.log(`Local database ready at mongodb://127.0.0.1:${PORT}/?replicaSet=${REPL_SET} (data in ${dbPath})`);
