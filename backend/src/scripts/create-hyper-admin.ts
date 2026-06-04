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

function firstEnvValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
      ?.split(',')
      .map((item) => item.trim())
      .find(Boolean);

    if (value) return value;
  }

  return undefined;
}

async function main() {
  const email = firstEnvValue('HYPER_ADMIN_EMAIL', 'HYPER_ADMIN_EMAILS');
  const password = firstEnvValue('HYPER_ADMIN_PASSWORD', 'HYPER_ADMIN_PASSWORDS');
  const firstName = firstEnvValue('HYPER_ADMIN_FIRSTNAME', 'HYPER_ADMIN_FIRSTNAMES') || 'Hyper';
  const lastName = firstEnvValue('HYPER_ADMIN_LASTNAME', 'HYPER_ADMIN_LASTNAMES') || 'Admin';

  if (!email || !password) {
    console.error(
      'HYPER_ADMIN_EMAIL/HYPER_ADMIN_PASSWORD are required. HYPER_ADMIN_EMAILS/HYPER_ADMIN_PASSWORDS are also accepted.',
    );
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
