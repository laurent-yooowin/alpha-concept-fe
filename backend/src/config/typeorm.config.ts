import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

const isTs = __filename.endsWith('.ts');

export default new DataSource({
  type: 'mysql',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '3306', 10),
  username: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'csps_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [
    isTs
      ? __dirname + '/../migrations/*.ts'
      : __dirname + '/../migrations/*.js',
  ],
  synchronize: false,
  logging: true,
});
