import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function parseEnvArray(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .replace(/[\[\]]/g, '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

async function createAdmins() {
  console.log('🚀 Starting admin creation process...\n');

  const emails = parseEnvArray(process.env.ADMIN_EMAILS);
  const passwords = parseEnvArray(process.env.ADMIN_PASSWORDS);
  const firstNames = parseEnvArray(process.env.ADMIN_FIRSTNAMES);
  const lastNames = parseEnvArray(process.env.ADMIN_LASTNAMES);
  const phones = parseEnvArray(process.env.ADMIN_PHONES);
  const zones = parseEnvArray(process.env.ADMIN_ZONES);
  const specialites = parseEnvArray(process.env.ADMIN_SPECIALITES);

  if (emails.length === 0) {
    console.error('❌ No admin emails found in ADMIN_EMAILS environment variable');
    console.log('\n📋 Example .env configuration:');
    console.log('ADMIN_EMAILS=[email1@example.com, email2@example.com]');
    console.log('ADMIN_PASSWORDS=[Password123!, Password456!]');
    console.log('ADMIN_FIRSTNAMES=[John, Jane]');
    console.log('ADMIN_LASTNAMES=[Doe, Smith]');
    console.log('ADMIN_PHONES=[+33612345678, +33698765432]');
    console.log('ADMIN_ZONES=[Paris, Lyon]');
    console.log('ADMIN_SPECIALITES=[CSPS, Coordination]');
    return;
  }

  if (passwords.length !== emails.length) {
    console.error('❌ Number of passwords must match number of emails');
    return;
  }

  if (firstNames.length !== emails.length) {
    console.error('❌ Number of first names must match number of emails');
    return;
  }

  if (lastNames.length !== emails.length) {
    console.error('❌ Number of last names must match number of emails');
    return;
  }

  console.log(`Found ${emails.length} admin(s) to create\n`);

  for (let i = 0; i < emails.length; i++) {
    try {
      console.log(`\n📝 Creating admin: ${emails[i]}...`);

      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: emails[i],
        password: passwords[i],
        email_confirm: true,
        user_metadata: {
          firstName: firstNames[i],
          lastName: lastNames[i],
        }
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          console.log(`⚠️  User ${emails[i]} already exists`);
          continue;
        }
        console.error(`❌ Auth error for ${emails[i]}:`, authError.message);
        continue;
      }

      if (!authData.user) {
        console.error(`❌ No user created for ${emails[i]}`);
        continue;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: authData.user.id,
          email: emails[i],
          firstName: firstNames[i],
          lastName: lastNames[i],
          phone: phones[i] || null,
          role: 'admin',
          zone_geographique: zones[i] || null,
          specialite: specialites[i] || null,
          isActive: true,
        });

      if (profileError) {
        console.error(`❌ Profile error for ${emails[i]}:`, profileError.message);
        continue;
      }

      console.log(`✅ Admin created successfully!`);
      console.log(`   Email: ${emails[i]}`);
      console.log(`   Password: ${passwords[i]}`);
      console.log(`   Name: ${firstNames[i]} ${lastNames[i]}`);
    } catch (error) {
      console.error(`❌ Error creating admin ${emails[i]}:`, error);
    }
  }

  console.log('\n✨ Admin creation process terminee!');
}

createAdmins();
