import { getBaseTemplate, BaseTemplateData } from './base.template';

export interface AccountStatusTemplateData extends BaseTemplateData {
  firstName: string;
  loginUrl?: string;
}

export function getAccountDeletedEmailHtml(
  data: AccountStatusTemplateData,
): string {
  const gradient = 'linear-gradient(135deg, #FF4B1F 0%, #FF9068 100%)';
  const content = `
    <h2>Account Deleted</h2>
    <p>Hi ${data.firstName},</p>
    <p>Your account on ${data.appName} has been deleted by the administrator.</p>
    <p>If you believe this was a mistake, please contact our support team.</p>
    <hr class="divider">
    <p class="small">Thank you for being part of ${data.appName}.</p>
  `;
  return getBaseTemplate(content, data, gradient);
}

export function getAccountDeletedEmailText(
  data: AccountStatusTemplateData,
): string {
  return `
Hi ${data.firstName},

Your account on ${data.appName} has been deleted by the administrator.

If you believe this was a mistake, please contact our support team.

© ${data.year} ${data.appName}. All rights reserved.
  `.trim();
}

export function getAccountActivatedEmailHtml(
  data: AccountStatusTemplateData,
): string {
  const gradient = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
  const content = `
    <h2>Account Activated</h2>
    <p>Hi ${data.firstName},</p>
    <p>Great news! Your account on ${data.appName} has been activated by the administrator.</p>
    <p>You can now log in and access all our features.</p>
    <div class="btn-center">
      <a href="${data.loginUrl}" class="btn">Log In to Your Account</a>
    </div>
    <hr class="divider">
    <p class="small">Welcome back to ${data.appName}!</p>
  `;
  return getBaseTemplate(content, data, gradient);
}

export function getAccountActivatedEmailText(
  data: AccountStatusTemplateData,
): string {
  return `
Hi ${data.firstName},

Great news! Your account on ${data.appName} has been activated by the administrator.
You can now log in and access all our features.

Log In: ${data.loginUrl}

© ${data.year} ${data.appName}. All rights reserved.
  `.trim();
}

export function getAccountSuspendedEmailHtml(
  data: AccountStatusTemplateData,
): string {
  const gradient = 'linear-gradient(135deg, #f8ad42 0%, #ff7e5f 100%)';
  const content = `
    <h2>Account Suspended</h2>
    <p>Hi ${data.firstName},</p>
    <p>Your account on ${data.appName} has been suspended by the administrator.</p>
    <p>While your account is suspended, you will not be able to log in or access your data.</p>
    <p>Please contact our support team if you have any questions regarding this suspension.</p>
    <hr class="divider">
    <p class="small">Account safety is important to us at ${data.appName}.</p>
  `;
  return getBaseTemplate(content, data, gradient);
}

export function getAccountSuspendedEmailText(
  data: AccountStatusTemplateData,
): string {
  return `
Hi ${data.firstName},

Your account on ${data.appName} has been suspended by the administrator.
While your account is suspended, you will not be able to log in or access your data.

Please contact our support team if you have any questions regarding this suspension.

© ${data.year} ${data.appName}. All rights reserved.
  `.trim();
}
