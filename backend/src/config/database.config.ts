import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'mysql',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT, 10) || 3306,
  username: process.env.DATABASE_USER || 'admin',
  password: process.env.DATABASE_PASSWORD || 'admin',
  database: process.env.DATABASE_NAME || 'csps_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  migrations: process.env.NODE_ENV === 'development' ? [__dirname + '/../migrations/*{.ts}'] : [__dirname + '/../migrations/*{.js}'],
  migrationsRun: false,
});
