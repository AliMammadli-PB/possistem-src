import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { chatAvatarDir } from './chat-avatar.js';

const MAX_EDGE = 1600;
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tif{1,2})$/i;

export function looksLikeImage(mime: string, filename: string): boolean {
  const type = mime.toLowerCase().trim();
  if (type.startsWith('image/')) return true;
  if (!type || type === 'application/octet-stream') return IMAGE_NAME.test(filename);
  return false;
}

export function chatUploadDir(): string {
  return path.join(chatAvatarDir(), 'uploads');
}

export function chatUploadFile(id: string): string {
  return path.join(chatUploadDir(), `${id}.webp`);
}

export function chatUploadUrl(id: string): string {
  return `/pos/api/public/chat/uploads/${id}.webp`;
}

export async function saveChatUpload(input: Buffer): Promise<{ id: string; url: string; bytes: number }> {
  if (!input.length) throw new Error('empty_image');
  await mkdir(chatUploadDir(), { recursive: true });
  const id = randomUUID();
  const processed = await sharp(input, { limitInputPixels: 20_000_000, failOn: 'error', sequentialRead: true })
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  if (!processed.length) throw new Error('empty_image');
  await writeFile(chatUploadFile(id), processed);
  return { id, url: chatUploadUrl(id), bytes: processed.length };
}
