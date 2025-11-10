# CSPS Backend - Docker Setup Guide

This guide explains how to run the CSPS backend application using Docker and Docker Compose.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 2GB of free RAM
- At least 5GB of free disk space

## Quick Start

### 1. Environment Configuration

Create a `.env` file in the backend directory:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Database Configuration
DATABASE_HOST=mysql
DATABASE_PORT=3306
DATABASE_USER=csps_user
DATABASE_PASSWORD=your_secure_password_here
DATABASE_NAME=csps_db

# JWT Configuration
JWT_SECRET=your_very_secure_jwt_secret_key_change_this
JWT_EXPIRES_IN=24h

# Application
PORT=3000
NODE_ENV=production

# OpenAI API
OPENAI_API_KEY=your_openai_api_key_here

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=your_region
AWS_S3_BUCKET=your_bucket_name
AWS_S3_ACCESS_POINT=your_access_point

# Admin Configuration
ADMIN_EMAILS=admin@example.com
ADMIN_FIRSTNAMES=Admin
ADMIN_LASTNAMES=User
ADMIN_PASSWORDS=SecurePassword123!
ADMIN_PHONES=+1234567890
ADMIN_COMPANIES=CSPS Company
```

### 2. Build and Start Services

```bash
docker-compose up -d
```

This will start:
- MySQL database (port 3306)
- Backend API (port 3000)
- Nginx reverse proxy with rate limiting (port 80)

### 3. Check Service Status

```bash
docker-compose ps
```

All services should show "Up (healthy)" status.

### 4. View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f mysql
docker-compose logs -f nginx
```

### 5. Run Database Migrations

Migrations run automatically when the backend starts. To run manually:

```bash
docker-compose exec backend npm run migration:run
```

### 6. Create Admin Users

```bash
docker-compose exec backend npm run create-admins
```

## Services

### Backend API

**URL:** http://localhost:3000

**Health Check:** http://localhost:3000/health

**Features:**
- TypeScript NestJS application
- Automatic migrations on startup
- File upload support (20MB max)
- OpenAI integration for photo analysis
- AWS S3 integration for file storage

### MySQL Database

**Host:** localhost:3306
**Database:** csps_db
**User:** csps_user (from .env)
**Password:** (from .env)

**Connection from host:**
```bash
mysql -h 127.0.0.1 -P 3306 -u csps_user -p csps_db
```

### Nginx Reverse Proxy

**URL:** http://localhost

**Features:**
- Rate limiting for all endpoints
- Request/response compression
- Health monitoring
- Security headers
- Error handling

## Rate Limiting

### Auth Endpoints (`/auth`, `/login`, `/register`)
- **Rate:** 10 requests per minute
- **Burst:** 5 additional requests
- **Use Case:** Login, registration, password reset

### Upload Endpoints (`/upload`)
- **Rate:** 20 requests per minute
- **Burst:** 10 additional requests
- **Max Size:** 20MB
- **Use Case:** Photo uploads, document uploads

### AI Analysis (`/ai`)
- **Rate:** 30 requests per minute
- **Burst:** 5 additional requests
- **Timeout:** 120 seconds
- **Use Case:** Photo analysis with OpenAI

### Bulk Import (`/missions/bulk-import`)
- **Rate:** 5 requests per hour
- **Burst:** 2 additional requests
- **Max Size:** 50MB
- **Timeout:** 600 seconds (10 minutes)
- **Use Case:** CSV/Excel mission imports

### General API (`/missions`, `/visits`, `/reports`, etc.)
- **Rate:** 100 requests per minute
- **Burst:** 20 additional requests
- **Use Case:** Standard CRUD operations

### Connection Limit
- **Max Connections:** 20 concurrent connections per IP

### Rate Limit Response

When rate limit is exceeded:

```json
{
  "statusCode": 429,
  "message": "Too many requests. Please try again later.",
  "error": "Rate Limit Exceeded"
}
```

## Docker Commands

### Start Services

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d backend
```

### Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (deletes database data)
docker-compose down -v
```

### Restart Services

```bash
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart backend
```

### Rebuild

```bash
# Rebuild and restart
docker-compose up -d --build

# Force rebuild without cache
docker-compose build --no-cache
docker-compose up -d
```

### View Logs

```bash
# Follow logs
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100

# Specific service
docker-compose logs -f backend
```

### Execute Commands

```bash
# Shell access
docker-compose exec backend sh

# Run npm commands
docker-compose exec backend npm run migration:run
docker-compose exec backend npm run create-admins

# Database access
docker-compose exec mysql mysql -u root -p
```

### Resource Usage

```bash
# View resource usage
docker stats

# View specific container
docker stats csps-backend
```

## Volumes

### Persistent Data

- **mysql_data:** Database files (persistent)
- **nginx_cache:** Nginx cache (persistent)
- **nginx_logs:** Nginx logs (persistent)
- **./logs:** Backend application logs (mounted)

### Backup Database

```bash
# Create backup
docker-compose exec mysql mysqldump -u root -p csps_db > backup.sql

# Restore backup
docker-compose exec -T mysql mysql -u root -p csps_db < backup.sql
```

## SSL/HTTPS Configuration

To enable HTTPS:

1. Place SSL certificates in `nginx/ssl/`:
   - `cert.pem` - SSL certificate
   - `key.pem` - SSL private key

2. Uncomment SSL configuration in `nginx/conf.d/backend.conf`:

```nginx
# Uncomment these lines:
listen 443 ssl http2;
ssl_certificate /etc/nginx/ssl/cert.pem;
ssl_certificate_key /etc/nginx/ssl/key.pem;
# ... other SSL settings
```

3. Uncomment HTTP to HTTPS redirect server block

4. Restart nginx:

```bash
docker-compose restart nginx
```

## Production Deployment

### Security Checklist

- [ ] Change all default passwords in `.env`
- [ ] Use strong JWT secret (minimum 64 characters)
- [ ] Configure SSL/HTTPS certificates
- [ ] Set `NODE_ENV=production`
- [ ] Configure firewall rules
- [ ] Enable Docker security features
- [ ] Set up log rotation
- [ ] Configure backup strategy
- [ ] Review rate limiting settings
- [ ] Set proper file permissions

### Performance Tuning

**For high traffic environments:**

1. Increase worker processes in `nginx/nginx.conf`:
```nginx
worker_processes auto;
worker_connections 4096;
```

2. Adjust rate limits in `nginx/nginx.conf`:
```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=200r/m;
```

3. Increase MySQL resources in `docker-compose.yml`:
```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 4G
```

### Monitoring

**Health Checks:**
- Backend: http://localhost/health
- MySQL: `docker-compose exec mysql mysqladmin ping`
- Nginx: http://localhost/

**Logs:**
```bash
# Application logs
docker-compose logs -f backend

# Nginx access logs
docker-compose exec nginx tail -f /var/log/nginx/access.log

# Nginx error logs
docker-compose exec nginx tail -f /var/log/nginx/error.log
```

## Troubleshooting

### Backend won't start

**Check logs:**
```bash
docker-compose logs backend
```

**Common issues:**
- Database not ready (wait for MySQL health check)
- Missing environment variables
- Port 3000 already in use

### Database connection failed

**Check MySQL status:**
```bash
docker-compose ps mysql
docker-compose logs mysql
```

**Verify credentials:**
```bash
docker-compose exec mysql mysql -u csps_user -p
```

### Rate limit issues

**Check current rates:**
```bash
docker-compose logs nginx | grep "limiting requests"
```

**Adjust limits in `nginx/nginx.conf`**

### Port conflicts

**Change ports in `docker-compose.yml`:**
```yaml
ports:
  - "8080:80"  # Change host port
```

### Out of disk space

**Clean Docker resources:**
```bash
docker system prune -a
docker volume prune
```

### High memory usage

**Check resource usage:**
```bash
docker stats
```

**Set memory limits in `docker-compose.yml`:**
```yaml
deploy:
  resources:
    limits:
      memory: 1G
```

## Development Mode

To run in development mode with hot reload:

```bash
docker-compose -f docker-compose.dev.yml up
```

Or run backend directly:

```bash
npm run dev
```

## Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DATABASE_HOST` | MySQL host | mysql | Yes |
| `DATABASE_PORT` | MySQL port | 3306 | Yes |
| `DATABASE_USER` | Database user | csps_user | Yes |
| `DATABASE_PASSWORD` | Database password | - | Yes |
| `DATABASE_NAME` | Database name | csps_db | Yes |
| `JWT_SECRET` | JWT signing key | - | Yes |
| `JWT_EXPIRES_IN` | Token expiry | 24h | No |
| `PORT` | Backend port | 3000 | No |
| `NODE_ENV` | Environment | production | No |
| `OPENAI_API_KEY` | OpenAI API key | - | Yes |
| `AWS_ACCESS_KEY_ID` | AWS access key | - | Yes |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | - | Yes |
| `AWS_REGION` | AWS region | - | Yes |
| `AWS_S3_BUCKET` | S3 bucket name | - | Yes |

## Support

For issues or questions:
1. Check logs: `docker-compose logs -f`
2. Verify configuration: `.env` file
3. Check service health: `docker-compose ps`
4. Review this documentation

## License

Proprietary - CSPS Application
