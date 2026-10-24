import { timingSafeEqual } from 'node:crypto';
import { getMailProfile, profilePassword } from './mail-profiles.js';

const UNLOCK_TTL_MS = 30 * 60 * 1000;
const unlocks = new Map<string, number>();

function unlockKey(userId: string, profileId: string): string {
  return `${userId}:${profileId}`;
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export function verifyProfileViewPassword(profileId: string, password: string): boolean {
  const profile = getMailProfile(profileId);
  if (!profile?.protected) return true;
  const expected = profilePassword(profileId);
  if (!expected || !password) return false;
  return safeEqual(expected, password);
}

export function grantProfileUnlock(userId: string, profileId: string): void {
  unlocks.set(unlockKey(userId, profileId), Date.now() + UNLOCK_TTL_MS);
}

export function isProfileUnlocked(userId: string, profileId: string): boolean {
  const profile = getMailProfile(profileId);
  if (!profile?.protected) return true;
  const exp = unlocks.get(unlockKey(userId, profileId));
  if (!exp) return false;
  if (Date.now() > exp) {
    unlocks.delete(unlockKey(userId, profileId));
    return false;
  }
  return true;
}
