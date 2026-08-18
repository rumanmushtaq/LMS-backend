import { getBaseTemplate, BaseTemplateData } from './base.template';

export interface VerificationTemplateData extends BaseTemplateData {
  firstName: string;
  verificationUrl: string;
}

export function getVerificationEmailHtml(
  data: VerificationTemplateData,
): string {
  const content = `
    <h2>Welcome, ${data.firstName}!</h2>
    <p>
      Thank you for signing up for ${data.appName}. To complete your registration and start your learning journey, please verify your email address.
    </p>
    <div class="btn-center">
      <a href="${data.verificationUrl}" class="btn">Verify Email Address</a>
    </div>
    <p class="muted">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p class="link-text">${data.verificationUrl}</p>
    <hr class="divider">
    <p class="small">
      This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
    </p>
  `;

  return getBaseTemplate(content, data);
}

export function getVerificationEmailText(
  data: VerificationTemplateData,
): string {
  return `
Welcome to ${data.appName}, ${data.firstName}!

Please verify your email address by clicking the link below:
${data.verificationUrl}

This link will expire in 24 hours.

If you didn't create an account, you can safely ignore this email.

© ${data.year} ${data.appName}. All rights reserved.
  `.trim();
}
