export interface BaseTemplateData {
  appName: string;
  year: number;
}

export function getBaseTemplate(
  content: string,
  data: BaseTemplateData,
  headerGradient: string = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.appName}</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f4f7fa;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .header {
      background: ${headerGradient};
      padding: 30px;
      border-radius: 16px 16px 0 0;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 28px;
      font-weight: 600;
    }
    .content {
      background-color: #ffffff;
      padding: 40px 30px;
      border-radius: 0 0 16px 16px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .footer {
      text-align: center;
      padding: 20px;
    }
    .footer p {
      color: #999;
      font-size: 12px;
      margin: 0;
    }
    h2 {
      color: #333;
      margin: 0 0 20px 0;
      font-size: 24px;
    }
    p {
      color: #555;
      font-size: 16px;
      line-height: 1.6;
      margin: 0 0 20px 0;
    }
    .btn {
      display: inline-block;
      background: ${headerGradient};
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 40px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }
    .btn-center {
      text-align: center;
      margin: 30px 0;
    }
    .link-text {
      color: #667eea;
      font-size: 14px;
      word-break: break-all;
      margin: 10px 0 0 0;
    }
    .muted {
      color: #777;
      font-size: 14px;
      line-height: 1.6;
      margin: 20px 0 0 0;
    }
    .divider {
      border: none;
      border-top: 1px solid #eee;
      margin: 30px 0;
    }
    .small {
      color: #999;
      font-size: 12px;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${data.appName}</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>&copy; ${data.year} ${data.appName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
