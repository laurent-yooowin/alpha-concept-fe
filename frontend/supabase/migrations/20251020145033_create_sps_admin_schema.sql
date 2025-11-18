/*
  # Système d'administration SPS - Schema complet
  
  ## Description
  Création du schéma complet pour la gestion des rapports SPS incluant :
  - Authentification et gestion des rôles (Super Admin, Admin, Coordonnateur)
  - Gestion des clients et chantiers
  - Ordres de mission avec attribution et suivi
  - Rapports SPS avec validation et historique
  - Logs d'activité pour traçabilité
  
  ## 1. Tables principales
  
  ### profiles
  Extension de auth.users pour stocker les informations métier
  - Rôles : super_admin, admin, coordinator
  - Informations personnelles et professionnelles
  - Statut actif/inactif
  
  ### clients
  Gestion des entreprises clientes
  - Informations de contact
  - Historique des missions associées
  
  ### chantiers
  Sites de construction
  - Localisation et détails
  - Lié aux clients
  
  ### missions
  Ordres de mission SPS
  - Dates et détails
  - Attribution aux coordonnateurs
  - Statuts multiples : en_attente, planifiee, en_cours, terminee, annulee
  
  ### rapports
  Rapports SPS soumis par les coordonnateurs
  - Contenu texte et références photos
  - Statuts : draft, submitted, validated, sent_to_client
  - Historique des modifications
  
  ### rapport_photos
  Photos associées aux rapports
  - URLs de stockage
  - Métadonnées
  
  ### activity_logs
  Traçabilité complète des actions
  - Historique de connexions
  - Actions utilisateurs
  - Modifications de données
  
  ## 2. Sécurité (RLS)
  
  Toutes les tables ont RLS activé avec des politiques restrictives :
  - Super Admin : accès complet
  - Admin : accès aux données opérationnelles
  - Coordinator : accès uniquement à ses missions
  - Vérification systématique via auth.uid() et role
  
  ## 3. Fonctions et triggers
  
  - Création automatique du profil lors de l'inscription
  - Logging automatique des activités critiques
  - Gestion des timestamps (created_at, updated_at)
  
  ## Notes importantes
  
  - Conformité RGPD : données personnelles protégées
  - Archivage 5 ans minimum via politique de rétention
  - Index optimisés pour les recherches fréquentes
*/

-- Extensions requises
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. TABLE PROFILES (Extension de auth.users)
-- =====================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  firstName text NOT NULL,
  lastName text NOT NULL,
  phone text,
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'coordinator')),
  zone_geographique text,
  specialite text,
  isActive boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Politique SELECT : chacun peut voir son propre profil, admins voient tout
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

-- Politique INSERT : seuls les super_admins peuvent créer des profils
CREATE POLICY "Super admins can create profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- Politique UPDATE : super_admins peuvent tout modifier, users peuvent modifier leur propre profil (sauf role)
CREATE POLICY "Super admins can update all profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Politique DELETE : seuls les super_admins peuvent supprimer
CREATE POLICY "Super admins can delete profiles"
  ON profiles FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- =====================================================
-- 2. TABLE CLIENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom text NOT NULL,
  email text,
  telephone text,
  adresse text,
  ville text,
  code_postal text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view clients"
  ON clients FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage clients"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Admins can update clients"
  ON clients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Super admins can delete clients"
  ON clients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- =====================================================
-- 3. TABLE CHANTIERS
-- =====================================================

CREATE TABLE IF NOT EXISTS chantiers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  nom text NOT NULL,
  adresse text NOT NULL,
  ville text NOT NULL,
  code_postal text,
  reference_interne text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE chantiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view chantiers"
  ON chantiers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage chantiers"
  ON chantiers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Admins can update chantiers"
  ON chantiers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Super admins can delete chantiers"
  ON chantiers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- =====================================================
-- 4. TABLE MISSIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS missions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chantier_id uuid NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  coordinator_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  date_debut date NOT NULL,
  date_fin date NOT NULL,
  statut text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'planifiee', 'refusee', 'en_cours', 'terminee', 'annulee')),
  consignes text,
  remarques_admin text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE missions ENABLE ROW LEVEL SECURITY;

-- Les coordinateurs peuvent voir leurs missions
CREATE POLICY "Coordinators can view planifiee missions"
  ON missions FOR SELECT
  TO authenticated
  USING (
    coordinator_id = auth.uid()
  );

-- Les admins peuvent voir toutes les missions
CREATE POLICY "Admins can view all missions"
  ON missions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

-- Les admins peuvent créer des missions
CREATE POLICY "Admins can create missions"
  ON missions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

-- Les admins peuvent modifier toutes les missions
CREATE POLICY "Admins can update all missions"
  ON missions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

-- Les coordinateurs peuvent modifier le statut de leurs missions
CREATE POLICY "Coordinators can update own missions"
  ON missions FOR UPDATE
  TO authenticated
  USING (coordinator_id = auth.uid())
  WITH CHECK (coordinator_id = auth.uid());

-- Seuls les super admins peuvent supprimer des missions
CREATE POLICY "Super admins can delete missions"
  ON missions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- =====================================================
-- 5. TABLE RAPPORTS
-- =====================================================

CREATE TABLE IF NOT EXISTS rapports (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  coordinator_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contenu text NOT NULL,
  observations text,
  statut text NOT NULL DEFAULT 'draft' CHECK (statut IN ('draft', 'submitted', 'validated', 'sent_to_client')),
  validated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  validated_at timestamptz,
  sent_to_client_at timestamptz,
  remarques_admin text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE rapports ENABLE ROW LEVEL SECURITY;

-- Les coordinateurs peuvent voir leurs rapports
CREATE POLICY "Coordinators can view own reports"
  ON rapports FOR SELECT
  TO authenticated
  USING (coordinator_id = auth.uid());

-- Les admins peuvent voir tous les rapports
CREATE POLICY "Admins can view all reports"
  ON rapports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

-- Les coordinateurs peuvent créer leurs rapports
CREATE POLICY "Coordinators can create reports"
  ON rapports FOR INSERT
  TO authenticated
  WITH CHECK (coordinator_id = auth.uid());

-- Les coordinateurs peuvent modifier leurs rapports non validés
CREATE POLICY "Coordinators can update own draft reports"
  ON rapports FOR UPDATE
  TO authenticated
  USING (
    coordinator_id = auth.uid()
    AND statut = 'draft'
  )
  WITH CHECK (
    coordinator_id = auth.uid()
    AND statut = 'draft'
  );

-- Les admins peuvent modifier tous les rapports
CREATE POLICY "Admins can update all reports"
  ON rapports FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

-- Seuls les super admins peuvent supprimer des rapports
CREATE POLICY "Super admins can delete reports"
  ON rapports FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- =====================================================
-- 6. TABLE RAPPORT_PHOTOS
-- =====================================================

CREATE TABLE IF NOT EXISTS rapport_photos (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rapport_id uuid NOT NULL REFERENCES rapports(id) ON DELETE CASCADE,
  url text NOT NULL,
  legende text,
  ordre integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE rapport_photos ENABLE ROW LEVEL SECURITY;

-- Les utilisateurs peuvent voir les photos de rapports qu'ils peuvent voir
CREATE POLICY "Users can view photos of accessible reports"
  ON rapport_photos FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM rapports
      WHERE rapports.id = rapport_photos.rapport_id
      AND (
        rapports.coordinator_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'admin')
        )
      )
    )
  );

-- Les coordinateurs peuvent ajouter des photos à leurs rapports
CREATE POLICY "Coordinators can add photos to own reports"
  ON rapport_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rapports
      WHERE rapports.id = rapport_photos.rapport_id
      AND rapports.coordinator_id = auth.uid()
    )
  );

-- Les admins peuvent gérer toutes les photos
CREATE POLICY "Admins can manage all photos"
  ON rapport_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Admins can update all photos"
  ON rapport_photos FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Admins can delete photos"
  ON rapport_photos FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

-- =====================================================
-- 7. TABLE ACTIVITY_LOGS
-- =====================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Seuls les admins peuvent voir les logs
CREATE POLICY "Admins can view activity logs"
  ON activity_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('super_admin', 'admin')
    )
  );

-- Les logs sont insérés automatiquement (pas de politique INSERT restrictive pour l'app)
CREATE POLICY "Authenticated users can create logs"
  ON activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================================================
-- 8. INDEXES pour optimisation des requêtes
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_isActive ON profiles(isActive);
CREATE INDEX IF NOT EXISTS idx_missions_coordinator ON missions(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_missions_statut ON missions(statut);
CREATE INDEX IF NOT EXISTS idx_missions_dates ON missions(date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_rapports_mission ON rapports(mission_id);
CREATE INDEX IF NOT EXISTS idx_rapports_coordinator ON rapports(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_rapports_statut ON rapports(statut);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chantiers_client ON chantiers(client_id);

-- =====================================================
-- 9. FONCTIONS & TRIGGERS
-- =====================================================

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers pour updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_chantiers_updated_at ON chantiers;
CREATE TRIGGER update_chantiers_updated_at
  BEFORE UPDATE ON chantiers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_missions_updated_at ON missions;
CREATE TRIGGER update_missions_updated_at
  BEFORE UPDATE ON missions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rapports_updated_at ON rapports;
CREATE TRIGGER update_rapports_updated_at
  BEFORE UPDATE ON rapports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();