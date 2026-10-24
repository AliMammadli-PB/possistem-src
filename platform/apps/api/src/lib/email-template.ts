/** possistem brand tokens — aligned with marketing site (site.css). */
export const emailBrand = {
  logoUrl: 'https://possistem.az/assets/brands/possistem-logo.png?v=20260827-4',
  siteUrl: 'https://possistem.az',
  orange: '#f2a45f',
  orangeDark: '#d9894a',
  canvas: '#f8f3eb',
  canvasDark: '#080807',
  surface: '#fffdf9',
  surfaceDark: '#11110f',
  text: '#1a1208',
  textMuted: '#6b5c4f',
  border: '#e8ddd0',
  headerGradient: 'linear-gradient(145deg,#1c140e 0%,#090807 100%)',
} as const;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character] ?? character,
  );
}

export type EmailTemplateInput = {
  preheader?: string;
  eyebrow?: string;
  title: string;
  bodyHtml: string;
  cta?: { label: string; href: string };
  footerNote?: string;
};

export function renderEmailTemplate(input: EmailTemplateInput): { html: string; text: string } {
  const preheader = escapeHtml(input.preheader ?? input.title);
  const eyebrow = input.eyebrow ? escapeHtml(input.eyebrow) : '';
  const title = escapeHtml(input.title);
  const footerNote = escapeHtml(
    input.footerNote ?? 'Bu mesaj possistem.az sistemindən avtomatik göndərilib.',
  );
  const { logoUrl, siteUrl, orange, orangeDark, canvas, surface, text, textMuted, border, headerGradient } =
    emailBrand;

  const ctaHtml = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
        <tr>
          <td style="border-radius:12px;background:${orange};box-shadow:0 8px 24px rgba(242,164,95,0.35);">
            <a href="${escapeHtml(input.cta.href)}" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#1a1208;text-decoration:none;border-radius:12px;">${escapeHtml(input.cta.label)}</a>
          </td>
        </tr>
      </table>`
    : '';

  const eyebrowHtml = eyebrow
    ? `<p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${orange};">${eyebrow}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="az">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${canvas};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${canvas};padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:${surface};border:1px solid ${border};border-radius:20px;overflow:hidden;box-shadow:0 16px 48px rgba(26,18,8,0.1);">
          <tr>
            <td align="center" style="padding:32px 32px 24px;background:${headerGradient};">
              <img src="${logoUrl}" alt="possistem" width="88" height="88" style="display:block;width:88px;height:88px;margin:0 auto 16px;border:0;outline:none;text-decoration:none;" />
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:rgba(255,250,242,0.78);">Biznes əməliyyatları bir sistemdə</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 32px;">
              ${eyebrowHtml}
              <h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:${text};">${title}</h1>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${textMuted};">
                ${input.bodyHtml}
              </div>
              ${ctaHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px 28px;border-top:1px solid ${border};background:#f5efe6;">
              <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.65;color:${textMuted};">${footerNote}</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.65;color:${textMuted};">
                <a href="${siteUrl}" style="color:${orangeDark};text-decoration:none;font-weight:700;">possistem.az</a>
                &nbsp;·&nbsp;
                <a href="mailto:support@possistem.az" style="color:${orangeDark};text-decoration:none;font-weight:600;">support@possistem.az</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textParts = [input.title, '', stripHtml(input.bodyHtml)];
  if (input.cta) textParts.push('', `${input.cta.label}: ${input.cta.href}`);
  textParts.push('', footerNote, '', 'possistem.az · support@possistem.az');

  return { html, text: textParts.join('\n') };
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderDetailRows(
  rows: Array<{ label: string; value: string }>,
): string {
  const { border, text, textMuted, orange } = emailBrand;
  const items = rows
    .filter((row) => row.value)
    .map(
      (row) => `<tr>
        <td style="padding:12px 0;border-bottom:1px solid ${border};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${textMuted};width:36%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:12px 0;border-bottom:1px solid ${border};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;color:${text};vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 4px;border-collapse:collapse;border-top:2px solid ${orange};">${items}</table>`;
}
