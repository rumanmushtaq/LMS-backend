import {
  getBaseTemplate,
  BaseTemplateData,
  BRAND,
  emailButton,
  emailLinkFallback,
  emailNotice,
} from './base.template';

export interface PasswordResetTemplateData extends BaseTemplateData {
  firstName: string;
  resetUrl: string;
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function getPasswordResetEmailHtml(
  data: PasswordResetTemplateData,
): string {
  const name = data.firstName?.trim() || 'there';

  const content = `
    <!-- Eyebrow: sets context before the headline. Deliberately typographic
         rather than an icon — remote images are blocked by default in most
         clients, so an image-based badge would leave a hole here. -->
    <p style="margin:0 0 12px 0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.accent};">
      Account security
    </p>

    <h1 class="sm-h1" style="margin:0 0 16px 0;font-family:${FONT};font-size:28px;line-height:1.25;font-weight:700;letter-spacing:-0.4px;color:${BRAND.text};">
      Reset your password
    </h1>

    <p style="margin:0 0 12px 0;font-family:${FONT};font-size:16px;line-height:1.65;color:${BRAND.textMuted};">
      Hi ${name}, we received a request to reset the password for your
      ${data.appName} account.
    </p>
    <p style="margin:0 0 32px 0;font-family:${FONT};font-size:16px;line-height:1.65;color:${BRAND.textMuted};">
      Choose a new password using the button below.
    </p>

    <!-- CTA -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td align="center" style="padding:0 0 32px 0;">
        ${emailButton('Reset password', data.resetUrl, BRAND.primary)}
      </td></tr>
    </table>

    ${emailNotice(
      'For your security this link expires in <strong style="color:' +
        BRAND.text +
        ';">1 hour</strong> and can only be used once.',
    )}

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td style="padding:28px 0 0 0;">
        ${emailLinkFallback(data.resetUrl)}
      </td></tr>
    </table>

    <!-- Divider -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td style="padding:32px 0 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="height:1px;background-color:${BRAND.border};font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
      </td></tr>
    </table>

    <p style="margin:24px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.7;color:#9498A6;">
      Didn't request this? You can safely ignore this email — your password
      will stay exactly as it is. If you keep receiving these, please contact
      support.
    </p>
  `;

  return getBaseTemplate(content, data, {
    accent: BRAND.accent,
    // Shown in the inbox list next to the subject. Without it, clients pull
    // the first line of the body, which was the raw greeting.
    preheader: `Reset your ${data.appName} password. This link expires in 1 hour.`,
  });
}

export function getPasswordResetEmailText(
  data: PasswordResetTemplateData,
): string {
  const name = data.firstName?.trim() || 'there';

  return `
Hi ${name},

We received a request to reset the password for your ${data.appName} account.

Reset your password using this link:
${data.resetUrl}

For your security this link expires in 1 hour and can only be used once.

Didn't request this? You can safely ignore this email — your password will
stay exactly as it is.

© ${data.year} ${data.appName}. All rights reserved.
  `.trim();
}
