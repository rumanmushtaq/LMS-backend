# Varona Academy - Backend API

A production-ready, secure, and scalable NestJS backend for a tutoring platform with comprehensive authentication, role-based access control, and admin management features.

## 🚀 Features

### Authentication & Security
- **JWT Authentication** with access and refresh tokens
- **Refresh Token Rotation** for enhanced security
- **Email Verification** on signup via SMTP
- **Password Reset** with secure hashed tokens
- **Two-Factor Authentication (2FA)** - TOTP (authenticator app) and email OTP
- **Bcrypt Password Hashing** with configurable salt rounds
- **Rate Limiting** to prevent brute-force attacks
- **Helmet** security headers
- **CORS** configuration

### User Management
- Three roles: **Student**, **Tutor**, **Admin**
- User statuses: **Active**, **Pending**, **Suspended**
- Profile management (update profile, change password)
- Email verification workflow

### Admin Features
- View all users with pagination and filtering
- Change user roles
- Suspend/activate users
- Delete users
- Verify user emails manually
- Create new admin accounts
- Dashboard statistics

### Technical Features
- **Clean Architecture** with modular structure
- **Swagger/OpenAPI** documentation
- **Global Validation** using class-validator
- **Global Exception Filters**
- **Logging Interceptors**
- **MongoDB** with Mongoose ODM
- **Environment-based Configuration**
- **Modular Email Templates** for easy customization

## 📁 Project Structure

```
src/
├── admin/                    # Admin module
│   ├── controllers/          # Admin endpoints
│   ├── dto/                  # Data transfer objects
│   └── services/             # Business logic
│
├── auth/                     # Authentication module
│   ├── controllers/          # Auth endpoints
│   ├── dto/                  # Auth DTOs (login, signup, etc.)
│   ├── guards/               # JWT & refresh guards
│   ├── services/             # Auth business logic
│   └── strategies/           # Passport JWT strategies
│
├── common/                   # Shared utilities
│   ├── decorators/           # Custom decorators (@Roles, @Public, etc.)
│   ├── filters/              # Exception filters
│   ├── guards/               # Role-based guards
│   ├── interceptors/         # Logging & transform interceptors
│   └── utils/                # Crypto utilities
│
├── config/                   # Configuration
│   ├── configuration.ts      # Config namespaces
│   └── env.validation.ts     # Environment validation
│
├── database/                 # Database module
│   └── database.module.ts    # MongoDB connection
│
├── email/                    # Email service module
│   ├── services/             # SMTP email service
│   └── templates/            # Email templates
│       ├── base.template.ts          # Base HTML template
│       ├── verification.template.ts  # Email verification
│       ├── password-reset.template.ts # Password reset
│       ├── two-factor.template.ts    # 2FA OTP
│       └── welcome.template.ts       # Welcome email
│
├── users/                    # Users module
│   ├── controllers/          # User endpoints
│   ├── dto/                  # User DTOs
│   ├── schemas/              # Mongoose schemas
│   └── services/             # User business logic
│
├── app.module.ts             # Root module
└── main.ts                   # Application entry point
```

## 🛠️ Installation

### Prerequisites
- Node.js 18+
- MongoDB 6+
- SMTP server (Gmail, AWS SES, Mailgun, etc.)

### Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd varona-academy
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
```bash
cp env.example .env
```

Edit `.env` with your configuration:
```env
# Application
NODE_ENV=development
PORT=3000
APP_NAME=Varona Academy
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:4200

# Database
MONGODB_URI=mongodb://localhost:27017/varona-academy

# JWT Configuration
JWT_ACCESS_SECRET=your-super-secret-access-key-min-32-chars
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-chars
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# SMTP Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM_EMAIL=noreply@varona-academy.com
SMTP_FROM_NAME=Varona Academy

# Security
BCRYPT_SALT_ROUNDS=12
TWO_FA_APP_NAME=VaronaAcademy
```

4. **Start the server**
```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## 📧 Email Configuration

### Gmail SMTP Setup
1. Enable 2-Step Verification in your Google Account
2. Generate an App Password at https://myaccount.google.com/apppasswords
3. Use the App Password as `SMTP_PASS`

### Other SMTP Providers

**AWS SES:**
```env
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-ses-smtp-username
SMTP_PASS=your-ses-smtp-password
```

**Mailgun:**
```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@your-domain.mailgun.org
SMTP_PASS=your-mailgun-password
```

**SendGrid SMTP:**
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

### Email Templates

All email templates are located in `src/email/templates/`. Each template exports:
- HTML version (with responsive styling)
- Plain text version (fallback)

Available templates:
- **base.template.ts** - Base layout with header, footer, and styling
- **verification.template.ts** - Email verification after signup
- **password-reset.template.ts** - Password reset request
- **two-factor.template.ts** - 2FA OTP codes
- **welcome.template.ts** - Welcome email after verification

To customize templates, modify the corresponding file in the templates folder.

## 📖 API Documentation

Once running, access Swagger documentation at:
```
http://localhost:3000/api/docs
```

### API Endpoints Overview

#### Authentication (`/api/v1/auth`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/signup` | Register new student/tutor |
| POST | `/login` | Student/Tutor login |
| POST | `/admin/login` | Admin login |
| POST | `/verify-email` | Verify email with token |
| POST | `/resend-verification` | Resend verification email |
| POST | `/forgot-password` | Request password reset |
| POST | `/reset-password` | Reset password with token |
| POST | `/refresh` | Refresh access token |
| POST | `/logout` | Logout (invalidate refresh token) |
| POST | `/change-password` | Change password |
| GET | `/me` | Get current user |
| POST | `/2fa/generate` | Generate 2FA secret & QR |
| POST | `/2fa/enable` | Enable 2FA |
| POST | `/2fa/verify` | Verify 2FA code |
| POST | `/2fa/disable` | Disable 2FA |

#### Users (`/api/v1/users`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/profile` | Get user profile |
| PATCH | `/profile` | Update user profile |
| DELETE | `/account` | Delete account |

#### Admin (`/api/v1/admin`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard/stats` | Get dashboard statistics |
| GET | `/users` | List all users (paginated) |
| GET | `/users/:id` | Get user by ID |
| POST | `/users/admin` | Create admin user |
| PATCH | `/users/:id` | Update user |
| PATCH | `/users/:id/status` | Update user status |
| PATCH | `/users/:id/role` | Update user role |
| POST | `/users/:id/suspend` | Suspend user |
| POST | `/users/:id/activate` | Activate user |
| POST | `/users/:id/verify-email` | Manually verify email |
| DELETE | `/users/:id` | Delete user |

## 🔐 Authentication Flow

### Signup Flow
1. User submits signup form with email, name, password, and role
2. System validates data and checks for existing email
3. Password is hashed with bcrypt
4. Verification token is generated and hashed (stored in DB)
5. User record created with `status: pending`, `emailVerified: false`
6. Verification email sent via SMTP
7. User clicks link in email with plain token
8. System hashes provided token and matches with DB
9. User status updated to `active`, `emailVerified: true`

### Login Flow
1. User submits credentials
2. System validates credentials
3. Check if email is verified
4. Check account status (not suspended)
5. If 2FA enabled:
   - Generate session token
   - Send OTP via email
   - Return `requires2FA: true` with session token
   - User submits 2FA code
   - Verify TOTP or email OTP
6. Generate access + refresh tokens
7. Store hashed refresh token in DB
8. Return tokens to client

### Token Refresh Flow
1. Client sends refresh token
2. Validate refresh token JWT
3. Hash token and compare with stored hash
4. Generate new token pair (rotation)
5. Update stored refresh token hash
6. Return new tokens

## 🔒 Security Features

### Password Requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character (@$!%*?&)

### Token Security
- Access tokens expire in 15 minutes
- Refresh tokens expire in 7 days
- Refresh token rotation on every use
- Tokens invalidated on password change/logout

### Reset Token Security
- Tokens hashed before storage (SHA-256)
- 1-hour expiration for password reset
- 24-hour expiration for email verification

## 🧪 Database Schema

### User Model
```typescript
{
  email: string;           // Unique, lowercase
  firstName: string;
  lastName: string;
  password: string;        // Bcrypt hashed
  role: 'student' | 'tutor' | 'admin';
  status: 'active' | 'pending' | 'suspended';
  emailVerified: boolean;
  emailVerificationToken: string | null;
  emailVerificationTokenExpires: Date | null;
  passwordResetToken: string | null;
  passwordResetTokenExpires: Date | null;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  refreshTokenHash: string | null;
  phone: string | null;
  profilePicture: string | null;
  bio: string | null;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

## 🚀 Deployment

### Production Checklist
- [ ] Set strong JWT secrets (minimum 32 characters)
- [ ] Use HTTPS in production
- [ ] Set `NODE_ENV=production`
- [ ] Configure proper CORS origins
- [ ] Set up MongoDB authentication
- [ ] Configure rate limiting appropriately
- [ ] Set up logging and monitoring
- [ ] Use environment variables for all secrets
- [ ] Configure production SMTP server

### Docker Support (Optional)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
```

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
#   v a r o n a - a c a d e m y - b a c k e n d  
 