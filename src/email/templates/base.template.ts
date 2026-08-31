export interface BaseTemplateData {
  appName: string;
  year: number;
}

/**
 * Brand palette, taken from the web app's theme tokens.
 *
 * The app defines colour in `oklch()`, which no email client understands, so
 * these are the sRGB equivalents. Keep them in step with `app/globals.css`.
 */
export const BRAND = {
  /** --primary-rgb: 59, 53, 97 — the deep academic purple used across the UI. */
  primary: '#3B3561',
  primaryDark: '#2C2749',
  /** --accent: bright cyan, used for highlights and the "Academy" wordmark. */
  accent: '#00B6D1',
  /** --foreground */
  text: '#1D2130',
  /** --muted-foreground */
  textMuted: '#60636F',
  /** --muted */
  surfaceMuted: '#F4F5F9',
  border: '#E4E6EF',
  pageBg: '#F1F3F9',
  white: '#FFFFFF',
} as const;

/**
 * System font stack. Web fonts do not load in most email clients, and a
 * `@font-face` that fails silently drops the text to Times New Roman.
 */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Older templates pass a CSS gradient for their accent. Gradients do not
 * render in Outlook and cannot be used as a button background, so take the
 * first colour out of one and use it as a solid.
 */
function toSolid(colour?: string): string {
  if (!colour) return BRAND.primary;
  const hex = colour.match(/#[0-9a-fA-F]{3,8}/);
  return hex ? hex[0] : BRAND.primary;
}

/**
 * A button that survives every major client.
 *
 * An `<a>` with padding collapses in Outlook — which is exactly what happened
 * before: the CTA rendered as bare underlined text because Outlook and Gmail
 * dropped the `<style>` block the `.btn` class lived in. This uses a table
 * with the colour on the cell, plus VML so Outlook draws a real rounded
 * rectangle, and every style is inline.
 */
export function emailButton(
  label: string,
  href: string,
  colour: string = BRAND.primary,
): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
  <tr>
    <td align="center" bgcolor="${colour}" style="border-radius:10px;" >
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="${href}" style="height:50px;v-text-anchor:middle;width:260px;" arcsize="20%"
        stroke="f" fillcolor="${colour}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:${FONT};font-size:16px;font-weight:bold;">${label}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <a href="${href}"
         style="display:inline-block;padding:15px 40px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;background-color:${colour};mso-hide:all;">
        ${label}
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`.trim();
}

/**
 * The "copy this link instead" block.
 *
 * Presented as a bordered, muted panel rather than a bare coloured link — a
 * 100-character URL rendered as raw red text was the ugliest part of the old
 * design, and it wrapped unpredictably.
 */
export function emailLinkFallback(url: string): string {
  return `
<p style="margin:0 0 10px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${BRAND.textMuted};">
  Button not working? Copy and paste this link into your browser:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td style="padding:14px 16px;background-color:${BRAND.surfaceMuted};border:1px solid ${BRAND.border};border-radius:8px;">
      <a href="${url}" style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12px;line-height:1.7;color:${BRAND.primary};text-decoration:none;word-break:break-all;">${url}</a>
    </td>
  </tr>
</table>`.trim();
}

/** A soft callout for expiry windows and security notes. */
export function emailNotice(
  text: string,
  colour: string = BRAND.accent,
): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td style="padding:14px 18px;background-color:${BRAND.surfaceMuted};border-left:4px solid ${colour};border-radius:6px;">
      <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${BRAND.textMuted};">${text}</p>
    </td>
  </tr>
</table>`.trim();
}

export interface BaseTemplateOptions {
  /** Solid accent for the CTA and highlights. Gradients are converted. */
  accent?: string;
  /** Inbox preview line. Without it clients show the first body text. */
  preheader?: string;
}

/**
 * The email shell.
 *
 * Written as nested tables with every style inline. The previous version put
 * its styling in a `<style>` block with classes — Gmail strips those, which is
 * why the button, spacing and colours all vanished and the mail arrived
 * looking like unstyled text.
 */
export function getBaseTemplate(
  content: string,
  data: BaseTemplateData,
  accentOrOptions?: string | BaseTemplateOptions,
): string {
  const options: BaseTemplateOptions =
    typeof accentOrOptions === 'string'
      ? { accent: accentOrOptions }
      : (accentOrOptions ?? {});

  const accent = toSolid(options.accent);
  const preheader = options.preheader ?? '';

  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${data.appName}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    /* Progressive enhancement only — everything above is inline, so the mail
       is complete without any of this. */
    @media only screen and (max-width: 620px) {
      .sm-px { padding-left: 24px !important; padding-right: 24px !important; }
      .sm-py { padding-top: 32px !important; padding-bottom: 32px !important; }
      .sm-h1 { font-size: 22px !important; }
    }
    a { text-decoration: none; }

    /* ── Legacy class support ──────────────────────────────────────────────
       The other templates still write their content with these classes.
       They are re-declared here in the brand palette so those emails do not
       regress while they are migrated to inline styles.

       Note this only helps clients that honour <style>; Gmail strips it,
       which is precisely why new templates inline everything instead. */
    h2 { margin: 0 0 16px 0; font-size: 24px; font-weight: 700; color: ${BRAND.text}; }
    p { font-size: 16px; line-height: 1.65; color: ${BRAND.textMuted}; margin: 0 0 18px 0; }
    .btn {
      display: inline-block; padding: 15px 40px; border-radius: 10px;
      background-color: ${BRAND.primary}; color: #ffffff !important;
      font-size: 16px; font-weight: 600; text-decoration: none;
    }
    .btn-center { text-align: center; margin: 32px 0; }
    .link-text { font-size: 12px; color: ${BRAND.primary}; word-break: break-all; margin: 10px 0 0 0; }
    .muted { font-size: 14px; color: ${BRAND.textMuted}; line-height: 1.6; margin: 20px 0 0 0; }
    .divider { border: none; border-top: 1px solid ${BRAND.border}; margin: 32px 0; }
    .small { font-size: 13px; color: #9498A6; line-height: 1.7; margin: 0; }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BRAND.pageBg};-webkit-font-smoothing:antialiased;">
  <div style="display:none;font-size:1px;color:${BRAND.pageBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${preheader}
    &#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND.pageBg};">
    <tr>
      <td align="center" style="padding:32px 12px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">

          <!-- Header -->
          <tr>
            <td align="center" bgcolor="${BRAND.primary}" style="background-color:${BRAND.primary};padding:36px 30px 30px 30px;border-radius:16px 16px 0 0;">
              <p style="margin:0;font-family:${FONT};font-size:26px;font-weight:700;letter-spacing:-0.3px;color:#ffffff;">
                Varona <span style="color:${BRAND.accent};">Academy</span>
              </p>
            </td>
          </tr>
          <!-- Accent rule -->
          <tr>
            <td bgcolor="${accent}" style="background-color:${accent};font-size:0;line-height:0;height:4px;">&nbsp;</td>
          </tr>

          <!-- Content -->
          <tr>
            <td bgcolor="#ffffff" class="sm-px sm-py" style="background-color:#ffffff;padding:40px;border-radius:0 0 16px 16px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 24px 8px 24px;">
              <p style="margin:0 0 6px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${BRAND.textMuted};">
                Sent by ${data.appName}
              </p>
              <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:#9498A6;">
                &copy; ${data.year} ${data.appName}. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}
