import { getBaseTemplate, BaseTemplateData } from './base.template';

export interface TeacherVerifiedTemplateData extends BaseTemplateData {
  firstName: string;
  loginUrl: string;
}

export function getTeacherVerifiedEmailHtml(
  data: TeacherVerifiedTemplateData,
): string {
  const content = `
    <h2>Great news, ${data.firstName}! 🎉</h2>
    <p>
      Your teacher account has been verified and your profile is now active. You can now log in and start creating your courses.
    </p>
    <div class="btn-center">
      <a href="${data.loginUrl}" class="btn">Go to Login</a>
    </div>
    <hr class="divider">
    <p class="small">
      If you have any questions, please reach out to our support team.
    </p>
  `;

  return getBaseTemplate(content, data);
}

export function getTeacherVerifiedEmailText(
  data: TeacherVerifiedTemplateData,
): string {
  return `
Hello ${data.firstName},

Great news! Your teacher account on ${data.appName} has been verified and your profile is now active.

You can now log in and start creating your courses.

Login here: ${data.loginUrl}

If you have any questions, please reach out to our support team.

© ${data.year} ${data.appName}. All rights reserved.
  `.trim();
}
