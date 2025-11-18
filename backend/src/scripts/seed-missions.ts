import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { Mission } from '../missions/mission.entity';
import { MissionType } from '../missions/mission.dto';

config();

const baseMissions = [
  // MISSIONS D'AUJOURD'HUI
  {
    title: 'RÉSIDENCE LES JARDINS',
    client: 'Bouygues Construction',
    status: 'en_cours',
    date: new Date().toISOString().split('T')[0],
    time: '14:00',
    address: 'Lyon 69003',
    description: 'Contrôle mensuel sécurité - Phase gros œuvre',
    type: MissionType.CSPS,
    contactFirstName: 'Jean',
    contactLastName: 'Martin',
    contactEmail: 'jean.martin@bouygues.fr',
    contactPhone: '06 12 34 56 78'
  },
  {
    title: 'BUREAUX PART-DIEU',
    client: 'Eiffage Construction',
    status: 'en_cours',
    date: new Date().toISOString().split('T')[0],
    time: '16:30',
    address: 'Lyon 69003',
    description: 'Finalisation rapport conformité',
    type: MissionType.CSPS,
    contactFirstName: 'Marie',
    contactLastName: 'Dubois',
    contactEmail: 'marie.dubois@eiffage.fr',
    contactPhone: '06 98 76 54 32'
  },
  {
    title: 'CENTRE COMMERCIAL',
    client: 'Vinci Construction',
    status: 'en_cours',
    date: new Date().toISOString().split('T')[0],
    time: '09:30',
    address: 'Villeurbanne 69100',
    description: 'Inspection sécurité - Extension galerie',
    type: MissionType.CSPS,
    contactFirstName: 'Pierre',
    contactLastName: 'Leroy',
    contactEmail: 'pierre.leroy@vinci.fr',
    contactPhone: '06 45 67 89 12'
  },

  // MISSIONS EN RETARD
  {
    title: 'USINE PHARMACEUTIQUE',
    client: 'Eiffage Construction',
    status: 'en_attente',
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '09:00',
    address: 'Lyon 69008',
    description: 'Visite de conformité - Salle blanche',
    type: MissionType.AEU,
    contactFirstName: 'Sophie',
    contactLastName: 'Bernard',
    contactEmail: 'sophie.bernard@eiffage.fr',
    contactPhone: '06 23 45 67 89'
  },
  {
    title: 'COMPLEXE SPORTIF',
    client: 'GTM Bâtiment',
    status: 'en_attente',
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '14:30',
    address: 'Villeurbanne 69100',
    description: 'Contrôle sécurité - Piscine et gymnases',
    type: MissionType.Divers,
    contactFirstName: 'Thomas',
    contactLastName: 'Moreau',
    contactEmail: 'thomas.moreau@gtm.fr',
    contactPhone: '06 34 56 78 90'
  },

  // MISSIONS PLANIFIÉES
  {
    title: 'LYCÉE ÉCOLOGIQUE',
    client: 'GTM Bâtiment',
    status: 'planifiee',
    date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '08:00',
    address: 'Villeurbanne 69100',
    description: 'Suivi hebdomadaire - Bâtiment HQE',
    type: MissionType.CSPS,
    contactFirstName: 'Claire',
    contactLastName: 'Petit',
    contactEmail: 'claire.petit@gtm.fr',
    contactPhone: '06 56 78 90 12'
  },
  {
    title: 'ÉCOLE PRIMAIRE',
    client: 'Vinci Construction',
    status: 'planifiee',
    date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '11:00',
    address: 'Lyon 69004',
    description: 'Inspection sécurité - Rénovation énergétique',
    type: MissionType.CSPS,
    contactFirstName: 'Antoine',
    contactLastName: 'Roux',
    contactEmail: 'antoine.roux@vinci.fr',
    contactPhone: '06 67 89 01 23'
  },
  {
    title: 'RÉSIDENCE ÉTUDIANTE',
    client: 'Eiffage Construction',
    status: 'planifiee',
    date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '13:00',
    address: 'Lyon 69001',
    description: 'Visite de conformité - 300 logements',
    type: MissionType.CSPS,
    contactFirstName: 'Isabelle',
    contactLastName: 'Garcia',
    contactEmail: 'isabelle.garcia@eiffage.fr',
    contactPhone: '06 78 90 12 34'
  },
  {
    title: 'STATION MÉTRO B',
    client: 'SYTRAL',
    status: 'planifiee',
    date: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '07:00',
    address: 'Lyon 69005',
    description: 'Contrôle sécurité - Nouvelle station',
    type: MissionType.AEU,
    contactFirstName: 'François',
    contactLastName: 'Simon',
    contactEmail: 'francois.simon@sytral.fr',
    contactPhone: '06 89 01 23 45'
  },
  {
    title: 'HÔPITAL MODERNE',
    client: 'Bouygues Construction',
    status: 'planifiee',
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '10:30',
    address: 'Lyon 69007',
    description: 'Contrôle installations médicales',
    type: MissionType.CSPS,
    contactFirstName: 'Nathalie',
    contactLastName: 'Laurent',
    contactEmail: 'nathalie.laurent@bouygues.fr',
    contactPhone: '06 90 12 34 56'
  },
];

async function seedMissions() {
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

    const missionRepository = dataSource.getRepository(Mission);

    // Get admin user (assuming first user is admin from create-admins script)
    const userRepository = dataSource.getRepository('User');
    const adminUser = await userRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' }
    });

    if (!adminUser) {
      console.error('No user found. Please run create-admins script first.');
      process.exit(1);
    }

    console.log(`Using user: ${adminUser.email}`);

    // Clear existing missions for this user
    const existingMissions = await missionRepository.find({
      where: { userId: adminUser.id }
    });

    if (existingMissions.length > 0) {
      await missionRepository.remove(existingMissions);
      console.log(`Removed ${existingMissions.length} existing missions`);
    }

    // Create base missions
    const missions = baseMissions.map(mission =>
      missionRepository.create({
        ...mission,
        userId: adminUser.id
      })
    );

    await missionRepository.save(missions);

    console.log(`✅ Successfully created ${missions.length} base missions`);
    console.log('\nMissions by status:');
    console.log(`- En cours: ${missions.filter(m => m.status === 'en_cours').length}`);
    console.log(`- En attente: ${missions.filter(m => m.status === 'en_attente').length}`);
    console.log(`- Planifiées: ${missions.filter(m => m.status === 'planifiee').length}`);

    await dataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding missions:', error);
    await dataSource.destroy();
    process.exit(1);
  }
}

seedMissions();
