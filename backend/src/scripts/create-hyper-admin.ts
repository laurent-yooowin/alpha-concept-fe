/**
 * Seed a Hyper Admin user.
 * Usage: ts-node backend/src/scripts/create-hyper-admin.ts
 *
 * Reads from .env:
 *   HYPER_ADMIN_EMAIL
 *   HYPER_ADMIN_PASSWORD
 *   HYPER_ADMIN_FIRSTNAME
 *   HYPER_ADMIN_LASTNAME
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import * as bcrypt from 'bcrypt';
import dataSource from '../config/typeorm.config';
import { User, UserRole } from '../user/user.entity';

config();

async function main() {
  const email = process.env.HYPER_ADMIN_EMAIL;
  const password = process.env.HYPER_ADMIN_PASSWORD;
  const firstName = process.env.HYPER_ADMIN_FIRSTNAME || 'Hyper';
  const lastName = process.env.HYPER_ADMIN_LASTNAME || 'Admin';

  if (!email || !password) {
    console.error('HYPER_ADMIN_EMAIL and HYPER_ADMIN_PASSWORD are required.');
    process.exit(1);
  }

  await dataSource.initialize();
  const repo = dataSource.getRepository(User);

  const existing = await repo.findOne({ where: { email } });
  if (existing) {
    if (existing.role !== UserRole.HYPER_ADMIN) {
      existing.role = UserRole.HYPER_ADMIN;
      existing.organizationId = null;
      await repo.save(existing);
      console.log(`Promoted ${email} to HYPER_ADMIN.`);
    } else {
      console.log(`Hyper admin ${email} already exists.`);
    }
    await dataSource.destroy();
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const user = repo.create({
    email,
    password: hash,
    firstName,
    lastName,
    role: UserRole.HYPER_ADMIN,
    organizationId: null,
    isActive: true,
  });
  await repo.save(user);
  console.log(`Hyper admin ${email} created.`);

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
