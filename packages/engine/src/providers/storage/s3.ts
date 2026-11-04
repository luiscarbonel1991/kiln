import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  PutObjectInput,
  PutObjectResult,
  StorageProvider,
} from "@/providers/storage/interface";
import { env } from "../../env";

function createClient(): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true, // path-style for MinIO/LocalStack (and harmless on AWS)
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
}

// Anonymous read on the bucket so <img src> resolves without signing (local dev).
function publicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: "*",
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

class S3StorageProvider implements StorageProvider {
  private readonly client = createClient();
  private readonly bucket = env.S3_BUCKET;
  private ready: Promise<void> | null = null;

  private async doEnsureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket: this.bucket,
        Policy: publicReadPolicy(this.bucket),
      }),
    );
  }

  // Idempotent, cached once per process; resets on failure so a later put retries.
  private ensureBucket(): Promise<void> {
    if (!this.ready) {
      this.ready = this.doEnsureBucket().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return { key: input.key, url: this.publicUrl(input.key) };
  }

  publicUrl(key: string): string {
    const base = env.S3_PUBLIC_URL ?? env.S3_ENDPOINT ?? "";
    return `${base}/${this.bucket}/${key}`;
  }

  readUrl(url: string): string {
    const shown = this.publicUrl("");
    if (!env.S3_ENDPOINT || !url.startsWith(shown)) return url;
    return `${env.S3_ENDPOINT}/${this.bucket}/${url.slice(shown.length)}`;
  }
}

export const s3StorageProvider: StorageProvider = new S3StorageProvider();
