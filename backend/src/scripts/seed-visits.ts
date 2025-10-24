import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { Visit } from '../visits/visit.entity';
import { Mission } from '../missions/mission.entity';

config();

async function seedVisits() {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT, 10) || 3306,
    username: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || 'csps_db',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    synchronize: false,
    logging: false,
  });

  try {
    await dataSource.initialize();
    console.log('Database connection established');

    const visitRepository = dataSource.getRepository(Visit);
    const missionRepository = dataSource.getRepository(Mission);

    // Get admin user
    const userRepository = dataSource.getRepository('User');
    const adminUser = await userRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' }
    });

    if (!adminUser) {
      console.error('No user found. Please run create-admins script first.');
      process.exit(1);
    }

    // Get missions
    const missions = await missionRepository.find({
      where: { userId: adminUser.id },
      take: 5
    });

    if (missions.length === 0) {
      console.error('No missions found. Please run seed-missions script first.');
      process.exit(1);
    }

    console.log(`Using user: ${adminUser.email}`);
    console.log(`Found ${missions.length} missions`);

    // Clear existing visits for this user
    const existingVisits = await visitRepository.find({
      where: { userId: adminUser.id }
    });

    if (existingVisits.length > 0) {
      await visitRepository.remove(existingVisits);
      console.log(`Removed ${existingVisits.length} existing visits`);
    }

    // Create base visits
    const baseVisits = [
      {
        missionId: missions[0].id,
        userId: adminUser.id,
        visitDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        photoCount: 12,
        photos: [
          {
            id: '1',
            uri: 'https://images.pexels.com/photos/585419/pexels-photo-585419.jpeg',
            analysis: {
              observation: 'Échafaudage installé selon les normes',
              recommendation: 'Vérifier la stabilité quotidiennement',
              riskLevel: 'faible' as const,
              confidence: 0.92
            },
            comment: 'Conforme aux standards de sécurité',
            validated: true
          },
          {
            id: '2',
            uri: 'https://images.pexels.com/photos/585419/pexels-photo-585419.jpeg',
            analysis: {
              observation: 'Équipements de protection individuelle présents',
              recommendation: 'Maintenir la disponibilité des EPI',
              riskLevel: 'faible' as const,
              confidence: 0.88
            },
            comment: '',
            validated: true
          }
        ],
        notes: 'Visite de routine - Tout est conforme. Bon respect des procédures de sécurité.',
        reportGenerated: true
      },
      {
        missionId: missions[1].id,
        userId: adminUser.id,
        visitDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        photoCount: 8,
        photos: [
          {
            id: '3',
            uri: 'https://images.pexels.com/photos/1109541/pexels-photo-1109541.jpeg',
            analysis: {
              observation: 'Signalisation de sécurité bien visible',
              recommendation: 'Continuer la maintenance',
              riskLevel: 'faible' as const,
              confidence: 0.95
            },
            comment: 'Excellente visibilité',
            validated: true
          }
        ],
        notes: 'Inspection de sécurité standard. Aucun problème détecté.',
        reportGenerated: true
      },
      {
        missionId: missions[0].id,
        userId: adminUser.id,
        visitDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        photoCount: 15,
        photos: [
          {
            id: '4',
            uri: 'https://images.pexels.com/photos/2219024/pexels-photo-2219024.jpeg',
            analysis: {
              observation: 'Zone de stockage bien organisée',
              recommendation: 'Maintenir l\'ordre et la propreté',
              riskLevel: 'faible' as const,
              confidence: 0.90
            },
            comment: 'Très bien organisé',
            validated: true
          }
        ],
        notes: 'Contrôle périodique effectué. Conformité totale.',
        reportGenerated: true
      },
      {
        missionId: missions[2].id,
        userId: adminUser.id,
        visitDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        photoCount: 10,
        photos: [
          {
            id: '5',
            uri: 'https://images.pexels.com/photos/159306/construction-site-build-construction-work-159306.jpeg',
            analysis: {
              observation: 'Chantier propre et sécurisé',
              recommendation: 'Poursuivre les bonnes pratiques',
              riskLevel: 'faible' as const,
              confidence: 0.87
            },
            comment: 'Bon état général',
            validated: true
          }
        ],
        notes: 'Visite de contrôle - Résultats satisfaisants.',
        reportGenerated: false
      },
      {
        missionId: missions[1].id,
        userId: adminUser.id,
        visitDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        photoCount: 6,
        photos: [
          {
            id: '6',
            uri: 'https://images.pexels.com/photos/416405/pexels-photo-416405.jpeg',
            analysis: {
              observation: 'Protection collective en place',
              recommendation: 'Vérifier régulièrement la fixation',
              riskLevel: 'faible' as const,
              confidence: 0.93
            },
            comment: 'Bien installé',
            validated: true
          }
        ],
        notes: 'Dernière visite avant rapport final.',
        reportGenerated: false
      }
    ];

    const visits = baseVisits.map(visit =>
      visitRepository.create(visit)
    );

    await visitRepository.save(visits);

    console.log(`✅ Successfully created ${visits.length} base visits`);
    console.log('\nVisits by mission:');

    for (const mission of missions.slice(0, 3)) {
      const count = visits.filter(v => v.missionId === mission.id).length;
      if (count > 0) {
        console.log(`- ${mission.title}: ${count} visit(s)`);
      }
    }

    const withReport = visits.filter(v => v.reportGenerated).length;
    console.log(`\nWith report generated: ${withReport}`);
    console.log(`Without report: ${visits.length - withReport}`);

    await dataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding visits:', error);
    await dataSource.destroy();
    process.exit(1);
  }
}

seedVisits();
