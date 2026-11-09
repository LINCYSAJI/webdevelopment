import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

/**
 * Private S3-compatible bucket (AWS S3, Cloudflare R2, DigitalOcean Spaces, Wasabi, MinIO, ...).
 *
 * - The bucket must be private (no public access). Files are only ever streamed by the API after a
 *   permission check; no public or long-lived links are created (CLAUDE.md rule 4).
 * - Files are never overwritten: every upload is sent with "If-None-Match: *", so the bucket
 *   refuses to replace an existing key.
 * - Encryption at rest is requested on AWS (SSE-S3); other providers encrypt by default.
 */
export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** AWS only: ask for server-side encryption (other providers reject the header or encrypt anyway). */
  serverSideEncryption: boolean;
}

export class S3Storage {
  private client: S3Client;

  constructor(private opts: S3StorageOptions) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint || undefined,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      maxAttempts: 3,
      // Plain uploads with a known size work on every S3-compatible provider.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, data: Buffer) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.opts.bucket,
          Key: key,
          Body: data,
          ContentLength: data.length,
          IfNoneMatch: '*',
          ...(this.opts.serverSideEncryption ? { ServerSideEncryption: 'AES256' as const } : {}),
        }),
      );
    } catch (err) {
      if (err instanceof S3ServiceException && (err.$metadata.httpStatusCode === 412 || err.name === 'PreconditionFailed')) {
        throw new Error(`Refusing to overwrite stored file ${key}`);
      }
      throw err;
    }
  }

  async open(key: string): Promise<{ stream: Readable; size: number }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    if (!res.Body) throw new Error(`Stored file ${key} is empty`);
    return { stream: res.Body as Readable, size: Number(res.ContentLength ?? 0) };
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    if (!res.Body) throw new Error(`Stored file ${key} is empty`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
}
