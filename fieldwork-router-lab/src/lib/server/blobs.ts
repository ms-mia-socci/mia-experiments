import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { awsConfig } from "./aws";
let s3: S3Client;
function location(path: string) {
  const key = relative(
    resolve(process.env.FIELDWORK_WORKSPACES!),
    resolve(path),
  );
  if (!key || key.startsWith("..") || key.startsWith("/"))
    throw Error("Invalid workspace path");
  return {
    Bucket: process.env.FIELDWORK_ARTIFACT_BUCKET!,
    Key: `workspaces/${key}`,
  };
}
export async function readBlob(path: string) {
  if (!process.env.FIELDWORK_ARTIFACT_BUCKET) return readFile(path);
  const result = await (s3 ??= new S3Client(awsConfig())).send(
    new GetObjectCommand(location(path)),
  );
  return Buffer.from(await result.Body!.transformToByteArray());
}
export async function writeBlob(path: string, bytes: Uint8Array) {
  if (process.env.FIELDWORK_ARTIFACT_BUCKET) {
    await (s3 ??= new S3Client(awsConfig())).send(
      new PutObjectCommand({
        ...location(path),
        Body: bytes,
        ServerSideEncryption: "AES256",
      }),
    );
  } else {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
  }
}
export async function removeBlob(path: string) {
  if (process.env.FIELDWORK_ARTIFACT_BUCKET)
    await (s3 ??= new S3Client(awsConfig())).send(
      new DeleteObjectCommand(location(path)),
    );
  else await rm(path, { force: true });
}
// Codex requires a real local image path; materialize only selected input images.
export async function localBlob(path: string) {
  const bytes = await readBlob(path);
  if (process.env.FIELDWORK_ARTIFACT_BUCKET) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
  }
  return { path, bytes };
}
