import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1706000000000 implements MigrationInterface {
  name = 'InitialSchema1706000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        firstName VARCHAR(255) NOT NULL,
        lastName VARCHAR(255) NOT NULL,
        role ENUM('ROLE_USER', 'ROLE_ADMIN') DEFAULT 'ROLE_USER',
        phone VARCHAR(50),
        company VARCHAR(255),
        isActive BOOLEAN DEFAULT TRUE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS missions (
        id VARCHAR(36) PRIMARY KEY,
        userId VARCHAR(36) NOT NULL,
        title VARCHAR(255) NOT NULL,
        client VARCHAR(255) NOT NULL,
        address TEXT NOT NULL,
        date DATE NOT NULL,
        time VARCHAR(10) NOT NULL,
        type VARCHAR(100) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'planifiee',
        contactFirstName VARCHAR(255),
        contactLastName VARCHAR(255),
        contactEmail VARCHAR(255),
        contactPhone VARCHAR(50),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_missions_userId (userId),
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mission_assignments (
        id VARCHAR(36) PRIMARY KEY,
        missionId VARCHAR(36) NOT NULL,
        userId VARCHAR(36) NOT NULL,
        assignedBy VARCHAR(36) NOT NULL,
        notified BOOLEAN DEFAULT FALSE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mission_assignments_missionId (missionId),
        INDEX idx_mission_assignments_userId (userId),
        FOREIGN KEY (missionId) REFERENCES missions(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assignedBy) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_assignment (missionId, userId)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS visits (
        id VARCHAR(36) PRIMARY KEY,
        missionId VARCHAR(36) NOT NULL,
        userId VARCHAR(36) NOT NULL,
        visitDate TIMESTAMP NOT NULL,
        photos JSON,
        photoCount INT DEFAULT 0,
        notes TEXT,
        reportGenerated BOOLEAN DEFAULT FALSE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_visits_missionId (missionId),
        INDEX idx_visits_userId (userId),
        FOREIGN KEY (missionId) REFERENCES missions(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id VARCHAR(36) PRIMARY KEY,
        missionId VARCHAR(36) NOT NULL,
        visitId VARCHAR(36),
        userId VARCHAR(36) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        status ENUM('brouillon', 'envoye', 'archive') DEFAULT 'brouillon',
        conformityPercentage FLOAT DEFAULT 0,
        sentAt TIMESTAMP NULL,
        recipientEmail VARCHAR(255),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_reports_missionId (missionId),
        INDEX idx_reports_userId (userId),
        FOREIGN KEY (missionId) REFERENCES missions(id) ON DELETE CASCADE,
        FOREIGN KEY (visitId) REFERENCES visits(id) ON DELETE SET NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS reports`);
    await queryRunner.query(`DROP TABLE IF EXISTS visits`);
    await queryRunner.query(`DROP TABLE IF EXISTS mission_assignments`);
    await queryRunner.query(`DROP TABLE IF EXISTS missions`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
  }
}
