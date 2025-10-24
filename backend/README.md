# CSPS Backend API

NestJS REST API for the CSPS Coordinator application with MySQL database and JWT authentication.

## 🚀 Installation

```bash
cd backend
npm install
```

## ⚙️ Configuration

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your database credentials:

```env
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=root
DATABASE_PASSWORD=your_password
DATABASE_NAME=csps_db

JWT_SECRET=your_secret_key
JWT_EXPIRES_IN=24h

PORT=3000
NODE_ENV=development
```

## 🗄️ Database Setup

```sql
CREATE DATABASE csps_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 🏃 Running the App

```bash
npm run dev
```

API available at: `http://localhost:3000/api`

## 📚 API Endpoints

### Users
- `GET /api/users/profile` - Get current user
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

## 🛠️ Tech Stack

- NestJS 10
- TypeScript
- TypeORM
- MySQL
- JWT Authentication
- Bcrypt

## 📁 Project Structure

```
backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   └── database.config.ts
│   ├── common/
│   │   └── decorators/
│   ├── auth/
│   ├── user/
│   ├── missions/
│   ├── visits/
│   └── reports/
├── package.json
├── tsconfig.json
└── .env.example
```

## ✅ Status

- ✅ User module (complete)
- ⏳ Auth module (pending)
- ⏳ Missions module (pending)
- ⏳ Visits module (pending)
- ⏳ Reports module (pending)
