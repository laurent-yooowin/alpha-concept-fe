.PHONY: help build up down restart logs shell mysql-shell clean migrate create-admins

# Default target
help:
	@echo "Available commands:"
	@echo "  make build          - Build Docker images"
	@echo "  make up             - Start all services"
	@echo "  make down           - Stop all services"
	@echo "  make restart        - Restart all services"
	@echo "  make logs           - Show logs (follow mode)"
	@echo "  make shell          - Open backend shell"
	@echo "  make mysql-shell    - Open MySQL shell"
	@echo "  make migrate        - Run database migrations"
	@echo "  make create-admins  - Create admin users"
	@echo "  make clean          - Remove all containers and volumes"
	@echo "  make ps             - Show running containers"
	@echo "  make stats          - Show container resource usage"
	@echo ""
	@echo "Development:"
	@echo "  make dev-up         - Start development environment"
	@echo "  make dev-down       - Stop development environment"
	@echo ""
	@echo "Production:"
	@echo "  make prod-up        - Start production environment"
	@echo "  make prod-down      - Stop production environment"
	@echo "  make prod-logs      - Show production logs"

# Build images
build:
	docker-compose build

# Start services
up:
	docker-compose up -d

# Stop services
down:
	docker-compose down

# Restart services
restart:
	docker-compose restart

# Show logs
logs:
	docker-compose logs -f

# Backend shell
shell:
	docker-compose exec backend sh

# MySQL shell
mysql-shell:
	docker-compose exec mysql mysql -u root -p

# Run migrations
migrate:
	docker-compose exec backend npm run migration:run

# Create admin users
create-admins:
	docker-compose exec backend npm run create-admins

# Show running containers
ps:
	docker-compose ps

# Show container stats
stats:
	docker stats

# Clean up everything
clean:
	docker-compose down -v
	docker system prune -f

# Development environment
dev-up:
	docker-compose -f docker-compose.dev.yml up -d

dev-down:
	docker-compose -f docker-compose.dev.yml down

dev-logs:
	docker-compose -f docker-compose.dev.yml logs -f

# Production environment
prod-up:
	docker-compose -f docker-compose.prod.yml up -d

prod-down:
	docker-compose -f docker-compose.prod.yml down

prod-logs:
	docker-compose -f docker-compose.prod.yml logs -f

prod-build:
	docker-compose -f docker-compose.prod.yml build

# Database backup
backup:
	@echo "Creating database backup..."
	docker-compose exec mysql mysqldump -u root -p csps_db > backup_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "Backup completed!"

# Database restore
restore:
	@echo "Restoring database from backup..."
	@read -p "Enter backup file path: " backup_file; \
	docker-compose exec -T mysql mysql -u root -p csps_db < $$backup_file
	@echo "Restore completed!"

# Health check
health:
	@echo "Checking service health..."
	@curl -f http://localhost/health && echo "✓ API is healthy" || echo "✗ API is down"
	@docker-compose exec mysql mysqladmin ping -h localhost -u root -p --silent && echo "✓ MySQL is healthy" || echo "✗ MySQL is down"

# Update and restart
update:
	git pull
	docker-compose build --no-cache
	docker-compose up -d
	@echo "Services updated and restarted!"
