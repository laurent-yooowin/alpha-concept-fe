import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import { User, UserRole } from '../user/user.entity';

config();

async function createAdmins() {
  const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim()) || [];
  const adminFirstNames = process.env.ADMIN_FIRSTNAMES?.split(',').map(n => n.trim()) || [];
  const adminLastNames = process.env.ADMIN_LASTNAMES?.split(',').map(n => n.trim()) || [];
  const adminPasswords = process.env.ADMIN_PASSWORDS?.split(',').map(p => p.trim()) || [];
  const adminPhones = process.env.ADMIN_PHONES?.split(',').map(p => p.trim()) || [];
  const adminCompanies = process.env.ADMIN_COMPANIES?.split(',').map(c => c.trim()) || [];

  if (adminEmails.length === 0) {
    console.error('❌ No admin emails found in ADMIN_EMAILS environment variable');
    console.log('Please add to .env file:');
    console.log('ADMIN_EMAILS=admin@example.com,admin2@example.com');
    console.log('ADMIN_FIRSTNAMES=John,Jane');
    console.log('ADMIN_LASTNAMES=Doe,Smith');
    console.log('ADMIN_PASSWORDS=password123,password456');
    console.log('ADMIN_PHONES=+1234567890,+0987654321 (optional)');
    console.log('ADMIN_COMPANIES=Company1,Company2 (optional)');
    process.exit(1);
  }

  if (adminFirstNames.length !== adminEmails.length ||
      adminLastNames.length !== adminEmails.length ||
      adminPasswords.length !== adminEmails.length) {
    console.error('❌ Mismatch in admin data arrays');
    console.error(`Emails: ${adminEmails.length}, FirstNames: ${adminFirstNames.length}, LastNames: ${adminLastNames.length}, Passwords: ${adminPasswords.length}`);
    console.error('All arrays must have the same length!');
    process.exit(1);
  }

  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT, 10) || 3306,
    username: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || 'csps_db',
    entities: [User],
    synchronize: false,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Database connection established');

    const userRepository = dataSource.getRepository(User);
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < adminEmails.length; i++) {
      const email = adminEmails[i];
      const firstName = adminFirstNames[i];
      const lastName = adminLastNames[i];
      const password = adminPasswords[i];
      const phone = adminPhones[i] || null;
      const company = adminCompanies[i] || null;

      const existingUser = await userRepository.findOne({ where: { email } });

      if (existingUser) {
        console.log(`⚠️  User ${email} already exists - skipping`);
        skipped++;
        continue;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const admin = userRepository.create({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        role: UserRole.ADMIN,
        phone,
        company,
        isActive: true,
      });

      await userRepository.save(admin);
      console.log(`✅ Created admin: ${email} (${firstName} ${lastName})`);
      created++;
    }

    console.log('\n📊 Summary:');
    console.log(`  ✅ Created: ${created}`);
    console.log(`  ⚠️  Skipped: ${skipped}`);
    console.log(`  📝 Total: ${adminEmails.length}`);

    await dataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admins:', error);
    await dataSource.destroy();
    process.exit(1);
  }
}

createAdmins();
