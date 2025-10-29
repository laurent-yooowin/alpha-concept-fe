import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateActivityLogs1740000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('activity_logs');

    if (!tableExists) {
      await queryRunner.createTable(
        new Table({
          name: 'activity_logs',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              default: 'uuid_generate_v4()',
            },
            {
              name: 'user_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'action',
              type: 'varchar',
              length: '255',
              isNullable: false,
            },
            {
              name: 'entity_type',
              type: 'varchar',
              length: '100',
              isNullable: false,
            },
            {
              name: 'entity_id',
              type: 'uuid',
              isNullable: true,
            },
            {
              name: 'details',
              type: 'jsonb',
              isNullable: true,
            },
            {
              name: 'created_at',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
        true,
      );

      await queryRunner.createForeignKey(
        'activity_logs',
        new TableForeignKey({
          columnNames: ['user_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'users',
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id)`,
      );

      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('activity_logs');

    if (tableExists) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS idx_activity_logs_created_at`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS idx_activity_logs_user_id`,
      );

      const table = await queryRunner.getTable('activity_logs');
      const foreignKey = table?.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('user_id') !== -1,
      );

      if (foreignKey) {
        await queryRunner.dropForeignKey('activity_logs', foreignKey);
      }

      await queryRunner.dropTable('activity_logs');
    }
  }
}
