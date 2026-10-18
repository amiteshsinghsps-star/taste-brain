# Authentication Server (`server/`)

Production-ready Node.js + Express + TypeScript + Prisma ORM + PostgreSQL authentication backend with salted Argon2 password hashing and HTTP-Only cookie Refresh Token rotation.

## 🚀 Features

- **Salted Password Hashing**: Passwords are saved with Argon2id ( salted, unique salt per hash, memory hard, fallback to PBKDF2).
- **Access Token**: Short-lived JWT (`15m`) sent via Authorization Header (`Bearer <token>`).
- **Refresh Token Rotation**: 7-day secure tokens stored in **HTTP-Only Cookies**, hashed with SHA-256 in PostgreSQL, rotated on every refresh, with token reuse detection and revocation.
- **PostgreSQL Database**: Managed via Prisma ORM schemas and migrations.
- **REST Endpoints**:
  - `POST /api/auth/register` - Create user
  - `POST /api/auth/login` - Authenticate & obtain tokens
  - `POST /api/auth/refresh` - Rotate refresh cookie & obtain new access token
  - `POST /api/auth/logout` - Revoke refresh token & clear cookies
  - `GET /api/auth/me` - Fetch profile (Protected)

## 🛠️ Quick Start

```bash
cd server

# 1. Install dependencies
npm install

# 2. Configure environment
# Ensure PostgreSQL is running on port 5432 or update DATABASE_URL in .env
cp .env.example .env

# 3. Generate Prisma client & run database migrations
npx prisma migrate dev --name init

# 4. Start Development Server
npm run dev
```
