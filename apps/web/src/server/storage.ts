import "server-only";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  eventIdOfKey,
  MULTIPART_MAX_PARTS,
  READ_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from "@snapalbum/shared";
import { getServerEnv } from "@/config/env.server";

export interface StorageConfig {
  /** `https://{account}.eu.r2.cloudflarestorage.com` for R2 in the EU jurisdiction (G-002). */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Signing region: `auto` for R2, whatever the emulator expects in tests. */
  region?: string;
  /** Path-style addressing (`endpoint/bucket/key`): required by local S3 emulators. */
  forcePathStyle?: boolean;
}

export interface ObjectInfo {
  size: number;
  contentType: string | undefined;
  etag: string | undefined;
}

export interface SignedUpload {
  url: string;
  /** Headers the browser must send with the PUT, exactly as signed. */
  headers: Record<string, string>;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/** Longest lifetime of a signed address the server ever issues: one hour. */
const MAX_SIGNED_SECONDS = READ_URL_TTL_SECONDS;
/** S3 deletes at most 1 000 objects per request. */
const DELETE_BATCH = 1000;

function ttl(seconds: number | undefined, fallback: number): number {
  const value = Math.floor(seconds ?? fallback);
  if (!Number.isFinite(value) || value < 1)
    throw new Error("A signed address needs a positive lifetime");
  return Math.min(value, MAX_SIGNED_SECONDS);
}

/**
 * Storage in the private bucket (SPEC 9): signed addresses for direct browser uploads and reads,
 * checks, deletion and multipart uploads. The files themselves never pass through the server.
 * Built from a config so integration tests can point it at a local S3 emulator.
 */
export function createStorage(config: StorageConfig) {
  const client = new S3Client({
    region: config.region ?? "auto",
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? false,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Checksums computed by the SDK would have to be sent by the browser: not wanted.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = config.bucket;

  return {
    /**
     * Address for the browser to PUT one file. The content type and the exact size are part of
     * the signature: a file of another size or type is refused by the storage itself (S-002).
     */
    async presignUpload(
      key: string,
      options: { contentType: string; contentLength: number; expiresInSeconds?: number },
    ): Promise<SignedUpload> {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: options.contentType,
          ContentLength: options.contentLength,
        }),
        {
          expiresIn: ttl(options.expiresInSeconds, UPLOAD_URL_TTL_SECONDS),
          signableHeaders: new Set(["content-type", "content-length"]),
        },
      );
      return {
        url,
        headers: {
          "Content-Type": options.contentType,
          "Content-Length": String(options.contentLength),
        },
      };
    },

    /** Address to read one file for a short time (gallery, download). */
    presignRead(key: string, options: { expiresInSeconds?: number; downloadName?: string } = {}) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: options.downloadName
            ? `attachment; filename="${options.downloadName.replace(/[^\w.-]/g, "_")}"`
            : undefined,
        }),
        { expiresIn: ttl(options.expiresInSeconds, READ_URL_TTL_SECONDS) },
      );
    },

    /** Size and type of a stored file, or null when it is not there (upload confirmation). */
    async head(key: string): Promise<ObjectInfo | null> {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          size: result.ContentLength ?? 0,
          contentType: result.ContentType,
          etag: result.ETag,
        };
      } catch (error) {
        if (error instanceof NotFound || (error as { name?: string }).name === "NotFound")
          return null;
        throw error;
      }
    },

    /** The first bytes of a stored file, to check its real type by signature (S-002). */
    async readStart(key: string, bytes: number): Promise<Uint8Array> {
      const result = await client.send(
        new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${Math.max(1, bytes) - 1}` }),
      );
      return result.Body ? await result.Body.transformToByteArray() : new Uint8Array();
    },

    async deleteObject(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    /**
     * Deletes everything under `prefix` (purge of an event, R5). Refuses anything that is not the
     * prefix of one event, so a wrong argument can never empty the bucket.
     */
    async deleteEventObjects(prefix: string): Promise<number> {
      if (!eventIdOfKey(prefix) || !prefix.endsWith("/")) {
        throw new Error(`Refusing to delete outside an event: ${prefix}`);
      }
      let deleted = 0;
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: DELETE_BATCH,
          }),
        );
        const keys = (page.Contents ?? []).flatMap((object) =>
          object.Key ? [{ Key: object.Key }] : [],
        );
        if (keys.length > 0) {
          const result = await client.send(
            new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }),
          );
          if (result.Errors?.length)
            throw new Error(`Could not delete ${result.Errors.length} objects`);
          deleted += keys.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return deleted;
    },

    /** Starts a multipart upload (videos above 50 MB, NF-013) and returns its identifier. */
    async createMultipart(key: string, contentType: string): Promise<string> {
      const result = await client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }),
      );
      if (!result.UploadId) throw new Error("The storage did not return an upload id");
      return result.UploadId;
    },

    /** Address for the browser to PUT one part (1 to 10 000) of a multipart upload. */
    async presignPart(
      key: string,
      uploadId: string,
      partNumber: number,
      options: { contentLength: number; expiresInSeconds?: number },
    ): Promise<string> {
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MULTIPART_MAX_PARTS) {
        throw new Error(`Invalid part number: ${partNumber}`);
      }
      return getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          ContentLength: options.contentLength,
        }),
        {
          expiresIn: ttl(options.expiresInSeconds, UPLOAD_URL_TTL_SECONDS),
          signableHeaders: new Set(["content-length"]),
        },
      );
    },

    /** Parts already stored, so an interrupted upload resumes at the right part. */
    async listParts(
      key: string,
      uploadId: string,
    ): Promise<{ partNumber: number; size: number; etag: string }[]> {
      const parts: { partNumber: number; size: number; etag: string }[] = [];
      let marker: string | undefined;
      do {
        const page = await client.send(
          new ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
        );
        for (const part of page.Parts ?? []) {
          if (part.PartNumber && part.ETag) {
            parts.push({ partNumber: part.PartNumber, size: part.Size ?? 0, etag: part.ETag });
          }
        }
        marker = page.IsTruncated ? String(page.NextPartNumberMarker) : undefined;
      } while (marker);
      return parts;
    },

    async completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: ordered.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    },

    async abortMultipart(key: string, uploadId: string): Promise<void> {
      await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
    },
  };
}

export type Storage = ReturnType<typeof createStorage>;

/** Reads the R2 settings of the environment; fails with a clear message when one is missing. */
export function storageConfigFromEnv(): StorageConfig {
  const env = getServerEnv();
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET ||
    (!env.R2_ENDPOINT && !R2_ACCOUNT_ID)
  ) {
    throw new Error("Storage is not configured: set the R2_* variables (see .env.example)");
  }
  const jurisdiction = env.R2_JURISDICTION === "default" ? "" : "eu.";
  return {
    endpoint: env.R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.${jurisdiction}r2.cloudflarestorage.com`,
    bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    // A custom endpoint is a local emulator: path-style addresses and the region it signs for.
    forcePathStyle: Boolean(env.R2_ENDPOINT),
    region: env.R2_ENDPOINT ? "us-east-1" : undefined,
  };
}

let shared: Storage | undefined;

/** The application's storage, created on first use. */
export function getStorage(): Storage {
  shared ??= createStorage(storageConfigFromEnv());
  return shared;
}
