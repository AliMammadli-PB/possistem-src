import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../env.js';

const AVATAR_SIZE = 128;

export function chatAvatarDir(): string {
  return env.chatAvatarDir;
}

export function chatAvatarFile(customerId: string): string {
  return path.join(chatAvatarDir(), `${customerId}.avif`);
}

export function chatAvatarUrl(customerId: string): string {
  return `/pos/api/public/chat/avatars/${customerId}.avif`;
}

export async function saveChatAvatar(customerId: string, input: Buffer): Promise<{ path: string; bytes: number }> {
  await mkdir(chatAvatarDir(), { recursive: true });
  const target = chatAvatarFile(customerId);

  const processed = await sharp(input, { limitInputPixels: 20_000_000, failOn: 'error' })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
    .avif({ quality: 45, effort: 4 })
    .toBuffer();

  await writeFile(target, processed);
  return { path: `${customerId}.avif`, bytes: processed.length };
}

export async function removeChatAvatar(customerId: string): Promise<void> {
  await unlink(chatAvatarFile(customerId)).catch(() => undefined);
}
