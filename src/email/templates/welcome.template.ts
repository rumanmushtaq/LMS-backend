import { getBaseTemplate, BaseTemplateData } from './base.template';

export interface WelcomeTemplateData extends BaseTemplateData {
  firstName: string;
  dashboardUrl: string;
}

export function getWelcomeEmailHtml(data: WelcomeTemplateData): string {
  const content = `
    <h2>Welcome aboard, ${data.firstName}! 🎉</h2>
    <p>
      Your email has been verified and your account is now active. You're all set to begin your learning journey with us!
    </p>
    <div class="btn-center">
      <a href="${data.dashboardUrl}" class="btn">Go to Dashboard</a>
    </div>
    <hr class="divider">
    <p class="small">
      Need help getting started? Check out our help center or contact our support team.
    </p>
  `;

  return getBaseTemplate(content, data);
}

export function getWelcomeEmailText(data: WelcomeTemplateData): string {
  return `
Welcome to ${data.appName}, ${data.firstName}!

Your email has been verified and your account is now active.

Visit your dashboard: ${data.dashboardUrl}

Need help? Contact our support team.

© ${data.year} ${data.appName}. All rights reserved.
  `.trim();
}
