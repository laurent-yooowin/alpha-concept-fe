import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserPermissions1830000001000 implements MigrationInterface {
  name = 'UserPermissions1830000001000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`users\` ADD COLUMN \`permissions\` json NULL`);

    // Backfill defaults based on role so existing users keep working
    // ADMIN_FULL preset
    const adminPreset = JSON.stringify({
      missions: 'write',
      visits: 'write',
      reports: 'write',
      clients: 'write',
      users: 'write',
    });
    // COORDINATOR preset
    const coordinatorPreset = JSON.stringify({
      missions: 'write',
      visits: 'write',
      reports: 'write',
      clients: 'read',
      users: 'none',
    });

    await q.query(
      `UPDATE \`users\` SET \`permissions\` = ? WHERE \`role\` = 'ROLE_ADMIN' AND \`permissions\` IS NULL`,
      [adminPreset],
    );
    await q.query(
      `UPDATE \`users\` SET \`permissions\` = ? WHERE \`role\` = 'ROLE_USER' AND \`permissions\` IS NULL`,
      [coordinatorPreset],
    );
    // HYPER_ADMIN bypasses checks anyway, leave NULL.
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`users\` DROP COLUMN \`permissions\``);
  }
}
