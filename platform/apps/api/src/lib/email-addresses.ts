import { env } from '../env.js';

export function formatEmailFrom(displayName: string, email: string): string {
  return `${displayName} <${email}>`;
}

/** Verified @possistem.az senders available via Resend. */
export const emailFrom = {
  support: () => formatEmailFrom('possistem Dəstək', env.emailSupport),
  info: () => formatEmailFrom('possistem', env.emailInfo),
  admin: () => formatEmailFrom('possistem Admin', env.emailAdmin),
  tarlan: () => formatEmailFrom('Tarlan Nağıyev', env.emailTarlan),
  ali: () => formatEmailFrom('Ali Məmmədli', env.emailAli),
} as const;

export type EmailSenderRole = keyof typeof emailFrom;

export function leadNotificationRecipients(): string {
  if (env.smtpLeadTo) return env.smtpLeadTo;
  return [env.emailTarlan, env.emailAli, env.emailAdmin, env.emailSupport, env.emailInfo]
    .filter(Boolean)
    .join(', ');
}
