import { getBaseTemplate, BaseTemplateData } from './base.template';

export interface PasswordResetTemplateData extends BaseTemplateData {
  firstName: string;
  resetUrl: string;
}

const GRADIENT = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';

export function getPasswordResetEmailHtml(data: PasswordResetTemplateData): string {
  const content = `
    <h2>Password Reset Request</h2>
    <p>
      Hi ${data.firstName}, we received a request to reset your password. Click the button below to create a new password.
    </p>
    <div class="btn-center">
      <a href="${data.resetUrl}" class="btn" style="background: ${GRADIENT}; box-shadow: 0 4px 15px rgba(240, 147, 251, 0.4);">Reset Password</a>
    </div>
    <p class="muted">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p class="link-text" style="color: #f5576c;">${data.resetUrl}</p>
    <hr class="divider">
    <p class="small">
      This link will expire in 1 hour. If you didn't request a password reset, please ignore this email or contact support if you have concerns.
    </p>
  `;

  return getBaseTemplate(content, data, GRADIENT);
}

export function getPasswordResetEmailText(data: PasswordResetTemplateData): string {
  return `
Hi ${data.firstName},

We received a request to reset your password for your ${data.appName} account.

Click the link below to reset your password:
${data.resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, please ignore this email.

© ${data.year} ${data.appName}. All rights reserved.
  `.trim();
}
