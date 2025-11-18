import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { Report, ReportStatus } from '../reports/report.entity';
import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';

config();

async function seedReports() {
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

    const reportRepository = dataSource.getRepository(Report);
    const missionRepository = dataSource.getRepository(Mission);
    const visitRepository = dataSource.getRepository(Visit);

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

    // Get missions and visits
    const missions = await missionRepository.find({
      where: { userId: adminUser.id },
      take: 5
    });

    const visits = await visitRepository.find({
      where: { userId: adminUser.id },
      take: 3
    });

    if (missions.length === 0) {
      console.error('No missions found. Please run seed-missions script first.');
      process.exit(1);
    }

    console.log(`Using user: ${adminUser.email}`);
    console.log(`Found ${missions.length} missions and ${visits.length} visits`);

    // Clear existing reports for this user
    const existingReports = await reportRepository.find({
      where: { userId: adminUser.id }
    });

    if (existingReports.length > 0) {
      await reportRepository.remove(existingReports);
      console.log(`Removed ${existingReports.length} existing reports`);
    }

    // Create base reports
    const baseReports = [
      {
        missionId: missions[0].id,
        visitId: visits[0]?.id || null,
        userId: adminUser.id,
        title: 'Rapport de conformité - Résidence Les Jardins',
        content: `
# RAPPORT DE VISITE SPS

## Mission: ${missions[0].title}
Client: ${missions[0].client}
Date de visite: ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR')}

## Points contrôlés
- Échafaudages et protections collectives
- Équipements de protection individuelle
- Signalisation de sécurité
- Zones de stockage et circulation

## Observations
Tous les points de contrôle sont conformes aux normes en vigueur. Le chantier présente un bon niveau de sécurité.

## Recommandations
- Maintenir les bonnes pratiques actuelles
- Vérifier quotidiennement la stabilité des échafaudages
- Poursuivre la sensibilisation du personnel

## Conclusion
Visite satisfaisante. Aucune non-conformité majeure détectée.
        `,
        status: ReportStatus.SENT,
        conformityPercentage: 95.5,
        sentAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
        recipientEmail: 'jean.martin@bouygues.fr'
      },
      {
        missionId: missions[1].id,
        visitId: visits[1]?.id || null,
        userId: adminUser.id,
        title: 'Inspection sécurité - Bureaux Part-Dieu',
        content: `
# RAPPORT D'INSPECTION SPS

## Mission: ${missions[1].title}
Client: ${missions[1].client}
Date de visite: ${new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR')}

## Périmètre de l'inspection
- Contrôle des installations électriques temporaires
- Vérification des issues de secours
- Évaluation des risques de chute
- État des sanitaires et vestiaires

## Constats
L'ensemble des installations est conforme. Bon respect des procédures de sécurité par les équipes.

## Points d'amélioration
- Améliorer l'éclairage dans certaines zones
- Compléter la signalisation d'évacuation

## Validation
Rapport validé et approuvé pour transmission au client.
        `,
        status: ReportStatus.SENT_TO_CLIENT,
        conformityPercentage: 92.0,
        sentAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        recipientEmail: 'marie.dubois@eiffage.fr'
      },
      {
        missionId: missions[0].id,
        visitId: visits[2]?.id || null,
        userId: adminUser.id,
        title: 'Contrôle périodique - Résidence Les Jardins',
        content: `
# RAPPORT DE CONTRÔLE PÉRIODIQUE

## Mission: ${missions[0].title}
Client: ${missions[0].client}
Date de visite: ${new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR')}

## Contrôles effectués
- Vérification des équipements de levage
- Contrôle de l'état des protections collectives
- Inspection des zones de circulation
- Vérification de la propreté du chantier

## Résultats
Contrôle satisfaisant. Toutes les vérifications sont conformes.

## Actions entreprises
Aucune action corrective nécessaire.
        `,
        status: ReportStatus.SENT,
        conformityPercentage: 98.0,
        sentAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
        recipientEmail: 'jean.martin@bouygues.fr'
      },
      {
        missionId: missions[2].id,
        visitId: null,
        userId: adminUser.id,
        title: 'Rapport en cours - Centre Commercial',
        content: `
# RAPPORT DE VISITE SPS (BROUILLON)

## Mission: ${missions[2].title}
Client: ${missions[2].client}

## Notes préliminaires
Visite effectuée le ${new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR')}

Rapport en cours de rédaction...
        `,
        status: ReportStatus.DRAFT,
        conformityPercentage: 0,
        sentAt: null,
        recipientEmail: null
      },
      {
        missionId: missions[1].id,
        visitId: null,
        userId: adminUser.id,
        title: 'Rapport archivé - Bureaux Part-Dieu (Ancien)',
        content: `
# RAPPORT DE VISITE SPS (ARCHIVÉ)

## Mission: ${missions[1].title}
Client: ${missions[1].client}

Ce rapport a été archivé après validation finale du projet.
        `,
        status: ReportStatus.ARCHIVED,
        conformityPercentage: 94.0,
        sentAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        recipientEmail: 'marie.dubois@eiffage.fr'
      }
    ];

    const reports = baseReports.map(report =>
      reportRepository.create(report)
    );

    await reportRepository.save(reports);

    console.log(`✅ Successfully created ${reports.length} base reports`);
    console.log('\nReports by status:');
    console.log(`- Brouillon: ${reports.filter(r => r.status === ReportStatus.DRAFT).length}`);
    console.log(`- Envoyés: ${reports.filter(r => r.status === ReportStatus.SENT).length}`);
    console.log(`- Archivés: ${reports.filter(r => r.status === ReportStatus.ARCHIVED).length}`);

    console.log('\nReports by mission:');
    for (const mission of missions.slice(0, 3)) {
      const count = reports.filter(r => r.missionId === mission.id).length;
      if (count > 0) {
        console.log(`- ${mission.title}: ${count} report(s)`);
      }
    }

    await dataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding reports:', error);
    await dataSource.destroy();
    process.exit(1);
  }
}

seedReports();
