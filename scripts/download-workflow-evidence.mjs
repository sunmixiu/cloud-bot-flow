import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { Client } from "minio";

const [objectKey, outputFile] = process.argv.slice(2);
if (!objectKey || !outputFile) {
  throw new Error("usage: node scripts/download-workflow-evidence.mjs <object-key> <output-file>");
}

const client = new Client({
  endPoint: process.env.MINIO_HOST || "127.0.0.1",
  port: Number(process.env.MINIO_PORT || 19000),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || "minio",
  secretKey: process.env.MINIO_SECRET_KEY || "minio123"
});

await mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
const metadata = await client.statObject(process.env.MINIO_BUCKET || "mlpipeline", objectKey);
const stream = await client.getObject(process.env.MINIO_BUCKET || "mlpipeline", objectKey);
await pipeline(stream, createWriteStream(outputFile));
console.log(JSON.stringify({ objectKey, outputFile: path.resolve(outputFile), size: metadata.size, etag: metadata.etag }));
