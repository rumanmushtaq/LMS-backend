import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import {
  getVerificationEmailHtml,
  getVerificationEmailText,
  getPasswordResetEmailHtml,
  getPasswordResetEmailText,
  getTwoFactorEmailHtml,
  getTwoFactorEmailText,
  getWelcomeEmailHtml,
  getWelcomeEmailText,
  getTeacherVerifiedEmailHtml,
  getTeacherVerifiedEmailText,
  getAccountDeletedEmailHtml,
  getAccountDeletedEmailText,
  getAccountActivatedEmailHtml,
  getAccountActivatedEmailText,
  getAccountSuspendedEmailHtml,
  getAccountSuspendedEmailText,
} from '../templates';

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly frontendUrl: string;
  private readonly appName: string;

  constructor(private readonly configService: ConfigService) {
    this.fromEmail = this.configService.get<string>('email.fromEmail')!;
    this.fromName = this.configService.get<string>('email.fromName')!;
    this.frontendUrl = this.configService.get<string>('app.frontendUrl')!;
    this.appName = this.configService.get<string>('app.name')!;

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('email.smtpHost'),
      port: this.configService.get<number>('email.smtpPort'),
      secure: this.configService.get<boolean>('email.smtpSecure'),
      auth: {
        user: this.configService.get<string>('email.smtpUser'),
        pass: this.configService.get<string>('email.smtpPass'),
      },
    });

    this.verifyConnection();
  }

  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection established successfully');
    } catch (error) {
      this.logger.warn(
        'SMTP connection failed - emails will not be sent:',
        error,
      );
    }
  }

  private getBaseTemplateData() {
    return {
      appName: this.appName,
      year: new Date().getFullYear(),
    };
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const mailOptions = {
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(
        `Email sent successfully to ${options.to} (ID: ${info.messageId})`,
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}:`, error);
      return false;
    }
  }

  async sendVerificationEmail(
    email: string,
    firstName: string,
    token: string,
  ): Promise<boolean> {
    const verificationUrl = `${this.frontendUrl}/api/v1/auth/verify-email?token=${token}`;

    const templateData = {
      ...this.getBaseTemplateData(),
      firstName,
      verificationUrl,
    };

    return this.sendEmail({
      to: email,
      subject: `Verify your email - ${this.appName}`,
      html: getVerificationEmailHtml(templateData),
      text: getVerificationEmailText(templateData),
    });
  }

  async sendPasswordResetEmail(
    email: string,
    firstName: string,
    token: string,
  ): Promise<boolean> {
    const resetUrl = `${this.frontendUrl}/auth/reset-password?token=${token}`;

    const templateData = {
      ...this.getBaseTemplateData(),
      firstName,
      resetUrl,
    };

    return this.sendEmail({
      to: email,
      subject: `Reset your password - ${this.appName}`,
      html: getPasswordResetEmailHtml(templateData),
      text: getPasswordResetEmailText(templateData),
    });
  }

  async sendTwoFactorOTPEmail(
    email: string,
    firstName: string,
    otp: string,
  ): Promise<boolean> {
    const templateData = {
      ...this.getBaseTemplateData(),
      firstName,
      otp,
    };

    return this.sendEmail({
      to: email,
      subject: `Your verification code - ${this.appName}`,
      html: getTwoFactorEmailHtml(templateData),
      text: getTwoFactorEmailText(templateData),
    });
  }

  async sendWelcomeEmail(email: string, firstName: string): Promise<boolean> {
    const templateData = {
      ...this.getBaseTemplateData(),
      firstName,
      dashboardUrl: `${this.frontendUrl}/dashboard`,
    };

    return this.sendEmail({
      to: email,
      subject: `Welcome to ${this.appName}!`,
      html: getWelcomeEmailHtml(templateData),
      text: getWelcomeEmailText(templateData),
    });
  }

  async sendTeacherVerifiedEmail(
    email: string,
    firstName: string,
  ): Promise<boolean> {
    const loginUrl = `${this.frontendUrl}/login`;

    const templateData = {
      ...this.getBaseTemplateData(),
      firstName,
      loginUrl,
    };

    return this.sendEmail({
      to: email,
      subject: `Your teacher account is verified! - ${this.appName}`,
      html: getTeacherVerifiedEmailHtml(templateData),
      text: getTeacherVerifiedEmailText(templateData),
    });
  }

  async sendAccountDeletedEmail(
    email: string,
    firstName: string,
  ): Promise<boolean> {
    const templateData = {
      ...this.getBaseTemplateData(),
      firstName,
    };

    return this.sendEmail({
      to: email,
      subject: `Your account has been deleted - ${this.appName}`,
      html: getAccountDeletedEmailHtml(templateData),
      text: getAccountDeletedEmailText(templateData),
    });
  }

  async sendAccountActivatedEmail(
    email: string,
    firstName: string,
  ): Promise<boolean> {
    const loginUrl = `${this.frontendUrl}/login`;
    const templateData = {
      ...this.getBaseTemplateData(),
      firstName,
      loginUrl,
    };

    return this.sendEmail({
      to: email,
      subject: `Your account has been activated! - ${this.appName}`,
      html: getAccountActivatedEmailHtml(templateData),
      text: getAccountActivatedEmailText(templateData),
    });
  }

  async sendAccountSuspendedEmail(
    email: string,
    firstName: string,
  ): Promise<boolean> {
    const templateData = {
      ...this.getBaseTemplateData(),
      firstName,
    };

    return this.sendEmail({
      to: email,
      subject: `Your account has been suspended - ${this.appName}`,
      html: getAccountSuspendedEmailHtml(templateData),
      text: getAccountSuspendedEmailText(templateData),
    });
  }
}
