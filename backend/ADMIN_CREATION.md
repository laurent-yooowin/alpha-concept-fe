# Admin Creation Script

## Overview

This script allows you to create multiple admin users from environment variables. It's useful for initial setup or adding new administrators to your CSPS system.

## Setup

### 1. Configure Environment Variables

Add the following to your `.env` file:

```env
# Admin Creation Configuration
# Comma-separated values for multiple admins
ADMIN_EMAILS=admin@example.com,admin2@example.com
ADMIN_FIRSTNAMES=John,Jane
ADMIN_LASTNAMES=Doe,Smith
ADMIN_PASSWORDS=SecurePassword123!,SecurePassword456!
ADMIN_PHONES=+1234567890,+0987654321
ADMIN_COMPANIES=Company ABC,Company XYZ
```

### 2. Important Notes

- **All arrays must have the same length** (same number of entries)
- Email addresses must be unique
- Passwords should be strong (at least 8 characters)
- `ADMIN_PHONES` and `ADMIN_COMPANIES` are **optional** (can be left empty or omitted)
- Comma-separated values should **not** have spaces after commas (spaces will be trimmed automatically)

### 3. Minimum Required Configuration

```env
# Minimum required fields
ADMIN_EMAILS=admin@example.com
ADMIN_FIRSTNAMES=John
ADMIN_LASTNAMES=Doe
ADMIN_PASSWORDS=SecurePassword123!
```

## Usage

### Run the Script

```bash
cd backend
npm run create-admins
```

### Expected Output

```
✅ Database connection established
✅ Created admin: admin@example.com (John Doe)
✅ Created admin: admin2@example.com (Jane Smith)

📊 Summary:
  ✅ Created: 2
  ⚠️  Skipped: 0
  📝 Total: 2
```

### If User Already Exists

```
✅ Database connection established
⚠️  User admin@example.com already exists - skipping
✅ Created admin: admin2@example.com (Jane Smith)

📊 Summary:
  ✅ Created: 1
  ⚠️  Skipped: 1
  📝 Total: 2
```

## Examples

### Single Admin

```env
ADMIN_EMAILS=john.admin@company.com
ADMIN_FIRSTNAMES=John
ADMIN_LASTNAMES=Administrator
ADMIN_PASSWORDS=MySecurePass2024!
ADMIN_PHONES=+33612345678
ADMIN_COMPANIES=CSPS Company
```

### Multiple Admins

```env
ADMIN_EMAILS=admin1@csps.com,admin2@csps.com,admin3@csps.com
ADMIN_FIRSTNAMES=Alice,Bob,Charlie
ADMIN_LASTNAMES=Anderson,Brown,Chen
ADMIN_PASSWORDS=AdminPass1!,AdminPass2!,AdminPass3!
ADMIN_PHONES=+33611111111,+33622222222,+33633333333
ADMIN_COMPANIES=CSPS Paris,CSPS Lyon,CSPS Marseille
```

### Without Optional Fields

```env
ADMIN_EMAILS=admin@company.com
ADMIN_FIRSTNAMES=Admin
ADMIN_LASTNAMES=User
ADMIN_PASSWORDS=SecurePassword!
```

## Error Handling

### Missing Required Fields

```
❌ No admin emails found in ADMIN_EMAILS environment variable
Please add to .env file:
ADMIN_EMAILS=admin@example.com,admin2@example.com
ADMIN_FIRSTNAMES=John,Jane
ADMIN_LASTNAMES=Doe,Smith
ADMIN_PASSWORDS=password123,password456
```

### Array Length Mismatch

```
❌ Mismatch in admin data arrays
Emails: 2, FirstNames: 1, LastNames: 2, Passwords: 2
All arrays must have the same length!
```

### Database Connection Error

```
❌ Error creating admins: Error: connect ECONNREFUSED 127.0.0.1:3306
```

Make sure your database is running and `.env` credentials are correct.

## Security Best Practices

1. **Strong Passwords**: Use complex passwords with uppercase, lowercase, numbers, and special characters
2. **Unique Emails**: Each admin must have a unique email address
3. **Secure .env**: Never commit your `.env` file to version control
4. **Change Defaults**: Always change example passwords in production
5. **Regular Updates**: Regularly update admin passwords

## Production Usage

For production environments:

1. Use strong, randomly generated passwords
2. Store `.env` file securely
3. Consider using a password manager
4. Enable 2FA (if implemented)
5. Run the script only once during initial setup
6. Remove or comment out admin credentials from `.env` after creation

## Troubleshooting

### Script Won't Run

Ensure TypeScript and ts-node are installed:
```bash
npm install
```

### Database Connection Issues

1. Check database is running
2. Verify credentials in `.env`
3. Ensure database exists
4. Check firewall settings

### User Creation Fails

1. Check database migrations have been run: `npm run migration:run`
2. Verify the `users` table exists
3. Check database permissions

## Admin Capabilities

Once created, admins have the following privileges:

- View **all** missions (not just their own)
- View **all** visits across all missions
- View **all** reports from all users
- Assign missions to other users
- Full CRUD access to all resources

## Next Steps

After creating admins:

1. Test admin login via API: `POST /api/auth/login`
2. Verify role-based access works
3. Change passwords if using example values
4. Set up additional security measures
5. Document admin responsibilities

## Related Documentation

- `BACKEND_INFO.md` - Complete backend documentation
- `MIGRATIONS.md` - Database migration guide
- `README.md` - General project setup
