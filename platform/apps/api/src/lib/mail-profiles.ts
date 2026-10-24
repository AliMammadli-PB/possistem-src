import { env } from '../env.js';

export type MailProfile = {
  id: string;
  label: string;
  email: string;
  protected: boolean;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function listMailProfiles(): MailProfile[] {
  const raw = (process.env.MAIL_PROFILES ?? '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as MailProfile[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((p) => p?.id && p?.email)
          .map((p) => ({
            id: String(p.id),
            label: String(p.label || p.email),
            email: String(p.email),
            protected: Boolean(p.protected),
          }));
      }
    } catch {
      /* fall through to defaults */
    }
  }

  const supportTo = (process.env.SMTP_SUPPORT_TO ?? 'canurek3@gmail.com').trim();
  return [
    { id: 'canurek', label: 'Canurek', email: supportTo, protected: false },
    { id: 'support', label: 'Dəstək', email: env.emailSupport, protected: false },
    { id: 'info', label: 'Info', email: env.emailInfo, protected: false },
    { id: 'admin', label: 'Admin', email: env.emailAdmin, protected: false },
    { id: 'tarlan', label: 'Terlan Ali', email: env.emailTarlan, protected: true },
    { id: 'ali', label: 'Ali Məmmədli', email: env.emailAli, protected: true },
  ].filter((p) => p.email);
}

export function getMailProfile(id: string): MailProfile | null {
  return listMailProfiles().find((p) => p.id === id) ?? null;
}

export function profilePassword(profileId: string): string {
  if (profileId === 'tarlan') return env.mailViewPasswordTarlan;
  if (profileId === 'ali') return env.mailViewPasswordAli;
  const custom = (process.env[`MAIL_VIEW_PASSWORD_${profileId.toUpperCase()}`] ?? '').trim();
  return custom;
}

export function matchMailProfile(
  toHeader: string,
  deliveredTo: string | undefined,
  profiles: MailProfile[],
): MailProfile {
  const haystack = `${toHeader}\n${deliveredTo ?? ''}`.toLowerCase();
  for (const profile of profiles) {
    const needle = normalizeEmail(profile.email);
    if (haystack.includes(needle)) return profile;
  }
  return profiles[0] ?? { id: 'inbox', label: 'Inbox', email: '', protected: false };
}

export function imapConfigured(): boolean {
  return Boolean(env.imapUser && env.imapPass);
}
