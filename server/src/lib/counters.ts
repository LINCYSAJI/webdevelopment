import mongoose, { type ClientSession } from 'mongoose';

/** Atomically returns the next number in a named sequence (1, 2, 3, …). */
export async function nextSequence(name: string, session?: ClientSession): Promise<number> {
  const result = await mongoose.connection
    .db!.collection<{ _id: string; seq: number }>('counters')
    .findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
  return result!.seq;
}
