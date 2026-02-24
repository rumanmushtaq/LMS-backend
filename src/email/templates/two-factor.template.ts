import { getBaseTemplate, BaseTemplateData } from './base.template';

export interface TwoFactorTemplateData extends BaseTemplateData {
  firstName: string;
  otp: string;
}

const GRADIENT = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';

export function getTwoFactorEmailHtml(data: TwoFactorTemplateData): string {
  const content = `
    <h2>Two-Factor Authentication</h2>
    <p>
      Hi ${data.firstName}, here is your verification code to complete your login:
    </p>
    <div class="btn-center">
      <div style="display: inline-block; background: ${GRADIENT}; padding: 20px 40px; border-radius: 12px; letter-spacing: 8px;">
        <span style="color: #ffffff; font-size: 32px; font-weight: 700;">${data.otp}</span>
      </div>
    </div>
    <hr class="divider">
    <p class="small">
      This code will expire in 5 minutes. If you didn't attempt to log in, please secure your account immediately by changing your password.
    </p>
  `;

  return getBaseTemplate(content, data, GRADIENT);
}

export function getTwoFactorEmailText(data: TwoFactorTemplateData): string {
  return `
Hi ${data.firstName},

Your ${data.appName} verification code is: ${data.otp}

This code will expire in 5 minutes.

If you didn't attempt to log in, please secure your account immediately.

© ${data.year} ${data.appName}. All rights reserved.
  `.trim();
}
