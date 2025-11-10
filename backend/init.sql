-- CSPS Database Initialization Script
-- This file is automatically executed when the MySQL container starts for the first time

-- Create database if not exists
CREATE DATABASE IF NOT EXISTS csps_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Use the database
USE csps_db;

-- Grant privileges to user
GRANT ALL PRIVILEGES ON csps_db.* TO 'csps_user'@'%';
FLUSH PRIVILEGES;

-- Note: Tables will be created automatically by TypeORM migrations when the backend starts
