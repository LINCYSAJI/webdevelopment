import type { Schema } from 'mongoose';

/** Makes a collection permanent: any attempt to change or delete a row throws. */
export function appendOnly(schema: Schema, what: string) {
  const block = function () {
    throw new Error(`${what} are permanent and cannot be changed or deleted.`);
  };
  schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], block);
  schema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], block);
}
