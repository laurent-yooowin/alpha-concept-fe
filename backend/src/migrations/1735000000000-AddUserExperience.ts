import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUserExperience1735000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    const experienceColumn = table?.findColumnByName('experience');

    if (!experienceColumn) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'experience',
          type: 'integer',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    const experienceColumn = table?.findColumnByName('experience');

    if (experienceColumn) {
      await queryRunner.dropColumn('users', 'experience');
    }
  }
}
