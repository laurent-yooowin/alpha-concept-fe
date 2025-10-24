# CAHIER DES CHARGES
## APPLICATION CSPS COORDONNATEUR

---

**Version :** 1.0  
**Date :** Janvier 2025  
**Auteur :** Alpha Concept SPS  
**Statut :** Version finale  

---

## TABLE DES MATIÈRES

1. [PRÉSENTATION GÉNÉRALE](#1-présentation-générale)
2. [SPÉCIFICATIONS FONCTIONNELLES](#2-spécifications-fonctionnelles)
3. [SPÉCIFICATIONS TECHNIQUES](#3-spécifications-techniques)
4. [FONCTIONNALITÉS AVANCÉES](#4-fonctionnalités-avancées)
5. [MÉTRIQUES ET INDICATEURS](#5-métriques-et-indicateurs)
6. [CAPTURES D'ÉCRAN](#6-captures-décran)

---

## 1. PRÉSENTATION GÉNÉRALE

### 1.1 Objectif du projet

L'application CSPS Coordonnateur est une solution mobile dédiée aux coordonnateurs SPS (Sécurité et Protection de la Santé) pour la gestion, le suivi et le contrôle des chantiers de construction. Elle intègre des fonctionnalités d'intelligence artificielle pour l'analyse automatique des risques de sécurité.

### 1.2 Utilisateurs cibles

- **Coordonnateurs SPS Niveau 2** certifiés
- **Professionnels du BTP** spécialisés en sécurité
- **Responsables de chantier** avec compétences SPS

### 1.3 Contexte d'utilisation

- **Chantiers de construction** (tous types)
- **Bureaux d'études** et sièges sociaux
- **Déplacements professionnels** entre sites
- **Mode connecté et hors ligne** selon disponibilité réseau

### 1.4 Valeur ajoutée

- **Digitalisation complète** du processus SPS
- **Analyse IA** pour la détection automatique des risques
- **Gain de temps** significatif dans la rédaction de rapports
- **Standardisation** des contrôles et évaluations
- **Traçabilité complète** des interventions

---

## 2. SPÉCIFICATIONS FONCTIONNELLES

### 2.1 Module d'Authentification et Sécurité

#### 2.1.1 Connexion utilisateur
- **Authentification sécurisée** par email professionnel et mot de passe
- **Chiffrement des données** sensibles en transit et au repos
- **Session persistante** avec déconnexion manuelle obligatoire
- **Écran de connexion** avec design professionnel et sécurisé

*[INSÉRER CAPTURE : Écran de connexion]*

#### 2.1.2 Gestion des mots de passe
- **Validation robuste** : minimum 6 caractères
- **Modification sécurisée** depuis le profil utilisateur
- **Masquage/affichage** du mot de passe lors de la saisie

### 2.2 Module de Gestion des Missions

#### 2.2.1 Tableau de bord principal
- **Vue d'ensemble** des missions du jour
- **Statistiques en temps réel** : visites, rapports, alertes, conformité
- **Profil coordonnateur** avec certifications et expérience
- **Notifications** avec badge de comptage

*[INSÉRER CAPTURE : Tableau de bord principal]*

#### 2.2.2 Planification des missions
- **Formulaire de création** complet et intuitif
- **Champs obligatoires** : titre, client, adresse, date, heure, email contact
- **Types de missions prédéfinis** :
  - Visite de contrôle
  - Inspection sécurité
  - Contrôle périodique
  - Visite mensuelle
  - Contrôle final
  - Audit conformité
  - Inspection préalable

*[INSÉRER CAPTURE : Formulaire de création de mission]*

#### 2.2.3 Saisie vocale intelligente
- **Speech-to-Text** pour les descriptions de mission
- **Reconnaissance vocale** en français
- **Interface intuitive** avec indicateur d'enregistrement
- **Compatibilité navigateur** (Chrome, Safari)

#### 2.2.4 Gestion des contacts clients
- **Informations complètes** : prénom, nom, email, téléphone
- **Validation automatique** des formats (email, téléphone)
- **Section dédiée** dans le formulaire de mission

#### 2.2.5 Liste et suivi des missions
- **Affichage par statut** : planifiées, en cours, terminées
- **Filtres avancés** par date, client, type
- **Recherche textuelle** multi-critères
- **Cartes visuelles** avec informations essentielles
- **Codes couleur** selon priorité et statut

*[INSÉRER CAPTURE : Liste des missions]*

### 2.3 Module de Visite et Contrôle

#### 2.3.1 Workflow de visite structuré
1. **Sélection obligatoire** d'une mission depuis la liste
2. **Prise de photos** documentaires (3 à 10 par visite)
3. **Analyse IA automatique** de chaque photo
4. **Validation/modification** des analyses par le coordonnateur
5. **Génération de rapport** automatique
6. **Validation finale** et envoi du rapport

*[INSÉRER CAPTURE : Sélection de mission pour visite]*

#### 2.3.2 Interface caméra professionnelle
- **Caméra intégrée** avec contrôles complets
- **Basculement avant/arrière** pour différents angles
- **Compteur de photos** en temps réel
- **Limites configurées** (minimum 3, maximum 10)
- **Prévisualisation** immédiate des photos prises

*[INSÉRER CAPTURE : Interface caméra]*

#### 2.3.3 Analyse IA des risques de sécurité
- **Détection automatique** des non-conformités
- **Génération d'observations** détaillées et contextuelles
- **Recommandations** personnalisées selon le type de risque
- **Évaluation du niveau de risque** :
  - 🟢 **Faible** : Conformité acceptable
  - 🟡 **Moyen** : Attention requise
  - 🔴 **Élevé** : Action immédiate nécessaire
- **Pourcentage de confiance** de l'analyse IA

*[INSÉRER CAPTURE : Analyse IA d'une photo]*

#### 2.3.4 Validation et commentaires coordonnateur
- **Fiche détaillée** pour chaque photo analysée
- **Validation en un clic** des analyses IA
- **Ajout/modification** de commentaires personnels
- **Interface d'édition** intuitive et rapide
- **Suppression** de photos si nécessaire
- **Sauvegarde automatique** des modifications

*[INSÉRER CAPTURE : Validation des analyses IA]*

### 2.4 Module de Gestion des Rapports

#### 2.4.1 Génération automatique de rapports
- **Rapport basé sur l'IA** intégrant toutes les analyses
- **Calcul automatique** du pourcentage de conformité
- **Inclusion systématique** des commentaires coordonnateur
- **Métadonnées complètes** : date, mission, client, coordonnateur
- **Format professionnel** prêt pour envoi client

*[INSÉRER CAPTURE : Rapport généré automatiquement]*

#### 2.4.2 Édition et personnalisation
- **Mode édition** du rapport complet
- **Modification libre** du contenu par le coordonnateur
- **Ajout de sections** personnalisées si nécessaire
- **Prévisualisation** en temps réel
- **Sauvegarde automatique** des brouillons

#### 2.4.3 Validation et envoi
- **Étape de validation obligatoire** avant envoi
- **Vérification finale** du contenu
- **Envoi sécurisé** au client
- **Confirmation d'envoi** avec horodatage
- **Archivage automatique** après envoi

#### 2.4.4 Classification et archivage
- **Filtrage par statut** :
  - 📤 **Envoyés** : Rapports transmis aux clients
  - 📝 **Brouillons** : Rapports en cours de rédaction
  - 📁 **Archivés** : Rapports finalisés et archivés
- **Recherche avancée** dans tous les rapports
- **Compteurs dynamiques** par catégorie
- **Interface visuelle** avec images de fond et gradients

*[INSÉRER CAPTURE : Liste des rapports avec filtres]*

### 2.5 Module Profil Utilisateur

#### 2.5.1 Informations personnelles
- **Profil coordonnateur** complet avec photo/initiales
- **Modification en ligne** des coordonnées :
  - Nom complet
  - Téléphone professionnel
  - Localisation
- **Validation automatique** des formats de données
- **Interface d'édition** moderne avec modals

*[INSÉRER CAPTURE : Profil utilisateur]*

#### 2.5.2 Gestion du compte
- **Modification du mot de passe** avec validation sécurisée
- **Informations de certification** SPS non modifiables
- **Données d'entreprise** (Alpha Concept SPS)
- **Ancienneté** et expérience affichées

#### 2.5.3 Paramètres simplifiés
- **Interface épurée** centrée sur l'essentiel
- **Déconnexion sécurisée** avec confirmation
- **Informations de version** de l'application
- **Copyright** et mentions légales

*[INSÉRER CAPTURE : Paramètres et déconnexion]*

---

## 3. SPÉCIFICATIONS TECHNIQUES

### 3.1 Architecture Technique

#### 3.1.1 Framework principal
- **React Native** avec Expo SDK 52.0.30
- **Expo Router 4.0.17** pour la navigation
- **TypeScript** pour la sécurité des types et la maintenabilité
- **Architecture modulaire** avec séparation des responsabilités

#### 3.1.2 Structure de navigation
- **Navigation par onglets** (Tabs) comme structure principale :
  - 🏠 Accueil
  - 📋 Missions  
  - 📷 Visite
  - 📄 Rapports
  - 👤 Profil
- **Stack Navigation** pour les flux hiérarchiques
- **Modal Navigation** pour les overlays et formulaires

### 3.2 Composants et Bibliothèques

#### 3.2.1 Interface utilisateur
- **Lucide React Native** pour les icônes (475+ icônes)
- **Expo Linear Gradient** pour les dégradés visuels
- **React Native Reanimated** pour les animations fluides
- **React Native Gesture Handler** pour les interactions tactiles

#### 3.2.2 Fonctionnalités natives
- **Expo Camera** pour la prise de photos intégrée
- **AsyncStorage** pour le stockage local persistant
- **Speech Recognition API** pour la saisie vocale (web)
- **Expo Status Bar** pour la gestion de la barre de statut

#### 3.2.3 Typographie et design
- **Google Fonts Inter** avec 4 graisses :
  - Inter-Regular (400)
  - Inter-Medium (500)
  - Inter-SemiBold (600)
  - Inter-Bold (700)
- **Système d'espacement 8px** standardisé
- **Grid system** responsive pour tous les écrans

### 3.3 Gestion des Données

#### 3.3.1 Stockage local
```typescript
// Structure AsyncStorage
{
  "userMissions": Mission[],
  "userReports": Report[],
  "userProfile": UserProfile,
  "appSettings": AppSettings
}
```

#### 3.3.2 Modèles de données
```typescript
interface Mission {
  id: number;
  title: string;
  client: string;
  location: string;
  description: string;
  nextVisit: string;
  type: MissionType;
  status: 'planifiees' | 'en_cours' | 'terminees';
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  gradient: [string, string];
}

interface Report {
  id: number;
  title: string;
  mission: string;
  client: string;
  date: string;
  status: 'envoyes' | 'brouillons' | 'archives';
  content: string;
  photos: PhotoAnalysis[];
  conformity: number;
  aiGenerated: boolean;
  pages: number;
  anomalies: number;
}

interface PhotoAnalysis {
  id: string;
  uri: string;
  aiAnalysis: {
    observations: string;
    recommendations: string;
    riskLevel: 'faible' | 'moyen' | 'élevé';
    confidence: number;
  };
  userComments: string;
  validated: boolean;
  timestamp: string;
}
```

### 3.4 Design System

#### 3.4.1 Palette de couleurs
```css
/* Couleurs primaires */
--primary-blue: #3B82F6;
--primary-blue-dark: #1D4ED8;

/* Couleurs de statut */
--success-green: #10B981;
--success-green-dark: #059669;
--warning-orange: #F59E0B;
--warning-orange-dark: #D97706;
--error-red: #EF4444;
--error-red-dark: #DC2626;

/* Couleurs neutres */
--background-dark: #0F172A;
--surface-dark: #1E293B;
--surface-medium: #374151;
--text-primary: #FFFFFF;
--text-secondary: #94A3B8;
--text-tertiary: #64748B;
```

#### 3.4.2 Composants visuels
- **Cartes avec gradients** et images de fond Pexels
- **Badges de statut** avec icônes contextuelles
- **Modals plein écran** pour les workflows complexes
- **Animations fluides** et micro-interactions
- **Système de grille** responsive

### 3.5 Compatibilité et Performance

#### 3.5.1 Plateformes supportées
- **Web** (navigateurs modernes : Chrome, Safari, Firefox, Edge)
- **iOS** (via Expo Go ou build standalone)
- **Android** (via Expo Go ou build standalone)

#### 3.5.2 Contraintes techniques
- **WebContainer** pour l'environnement de développement
- **Expo managed workflow** (pas de code natif)
- **APIs web** pour les fonctionnalités avancées
- **Responsive design** pour tous les formats d'écran

#### 3.5.3 Performance
- **Lazy loading** des images et composants
- **Optimisation des re-renders** avec React.memo
- **Gestion mémoire** optimisée pour les photos
- **Cache intelligent** des données fréquemment utilisées

---

## 4. FONCTIONNALITÉS AVANCÉES

### 4.1 Intelligence Artificielle

#### 4.1.1 Analyse automatique des photos
- **Détection des EPI** (Équipements de Protection Individuelle)
- **Identification des risques** de chute, électriques, chimiques
- **Analyse de l'organisation** du chantier
- **Vérification des protections collectives**
- **Évaluation de la propreté** et du rangement

#### 4.1.2 Génération de recommandations
- **Recommandations contextuelles** selon le type de risque
- **Priorisation** des actions correctives
- **Références réglementaires** automatiques
- **Suggestions d'amélioration** continue

#### 4.1.3 Calcul de conformité
- **Algorithme de scoring** basé sur les niveaux de risque
- **Pondération** selon la criticité des non-conformités
- **Évolution** dans le temps et comparaisons
- **Seuils d'alerte** configurables

### 4.2 Expérience Utilisateur Avancée

#### 4.2.1 Interface adaptative
- **Design responsive** pour tous les écrans
- **Mode sombre** optimisé pour l'utilisation terrain
- **Contraste élevé** pour la lisibilité en extérieur
- **Tailles de police** adaptables

#### 4.2.2 Workflow guidé
- **Onboarding** pour les nouveaux utilisateurs
- **Tooltips contextuels** pour les fonctionnalités avancées
- **Validation en temps réel** des saisies
- **Messages d'erreur** explicites et constructifs

#### 4.2.3 Raccourcis et efficacité
- **Actions rapides** depuis les listes
- **Duplication** de missions similaires
- **Templates** de rapports personnalisables
- **Historique** des actions récentes

### 4.3 Sécurité et Conformité

#### 4.3.1 Protection des données
- **Chiffrement AES-256** pour les données sensibles
- **Authentification forte** avec tokens sécurisés
- **Audit trail** de toutes les actions utilisateur
- **Sauvegarde automatique** avec versioning

#### 4.3.2 Conformité réglementaire
- **Respect du RGPD** pour les données personnelles
- **Conformité** aux standards SPS français
- **Traçabilité** complète des interventions
- **Archivage** réglementaire des rapports

---

## 5. MÉTRIQUES ET INDICATEURS

### 5.1 Indicateurs de Performance Opérationnelle

#### 5.1.1 Tableau de bord coordonnateur
- **Nombre de visites** réalisées (mensuel/annuel)
- **Nombre de rapports** générés et envoyés
- **Alertes actives** nécessitant un suivi
- **Taux de conformité moyen** des chantiers suivis

#### 5.1.2 Métriques de qualité
- **Temps moyen** de réalisation d'une visite
- **Nombre de photos** par visite (moyenne)
- **Taux de validation** des analyses IA
- **Délai moyen** entre visite et envoi du rapport

### 5.2 Indicateurs Techniques

#### 5.2.1 Performance application
- **Temps de chargement** des écrans
- **Taux de succès** des analyses IA
- **Utilisation mémoire** et stockage
- **Stabilité** et taux de crash

#### 5.2.2 Qualité des données
- **Validation automatique** des saisies (100%)
- **Cohérence** entre missions et rapports
- **Intégrité** des analyses IA
- **Complétude** des informations obligatoires

---

## 6. CAPTURES D'ÉCRAN

### 6.1 Écrans principaux
*[INSÉRER CAPTURES POUR CHAQUE SECTION]*

1. **Écran de connexion** - Interface sécurisée
2. **Tableau de bord** - Vue d'ensemble des activités
3. **Création de mission** - Formulaire complet
4. **Liste des missions** - Gestion et filtres
5. **Sélection de mission pour visite** - Workflow guidé
6. **Interface caméra** - Prise de photos
7. **Analyse IA** - Résultats et validation
8. **Génération de rapport** - Contenu automatique
9. **Liste des rapports** - Classification et recherche
10. **Profil utilisateur** - Informations personnelles

### 6.2 Workflows complets
*[INSÉRER SÉQUENCES D'ÉCRANS]*

1. **Workflow création de mission** (5 étapes)
2. **Workflow visite complète** (7 étapes)
3. **Workflow génération de rapport** (4 étapes)

---

## CONCLUSION

L'application CSPS Coordonnateur représente une solution complète et innovante pour la digitalisation des processus de sécurité sur les chantiers. Elle combine efficacité opérationnelle, intelligence artificielle et expérience utilisateur moderne pour offrir aux coordonnateurs SPS un outil professionnel de référence.

**Points forts :**
- ✅ Interface intuitive et moderne
- ✅ IA intégrée pour l'analyse des risques
- ✅ Workflow complet de A à Z
- ✅ Compatibilité multi-plateforme
- ✅ Sécurité et conformité réglementaire

---

**Document généré le :** [DATE]  
**Version de l'application :** 1.0.0  
**© 2025 Alpha Concept SPS - Tous droits réservés**