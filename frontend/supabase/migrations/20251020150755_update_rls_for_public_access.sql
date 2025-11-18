/*
  # Mise à jour des politiques RLS pour accès public
  
  ## Description
  Modification des politiques de sécurité pour permettre un accès public
  à toutes les tables sans authentification. Cette configuration est adaptée
  pour un environnement de démonstration ou d'administration interne.
  
  ## Changements
  - Suppression des politiques restrictives basées sur l'authentification
  - Ajout de politiques permissives pour tous les utilisateurs authentifiés
  - Maintien de la structure RLS pour une sécurité future
  
  ## Tables affectées
  - profiles
  - clients
  - chantiers
  - missions
  - rapports
  - rapport_photos
  - activity_logs
*/

-- =====================================================
-- PROFILES
-- =====================================================

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Super admins can create profiles" ON profiles;
DROP POLICY IF EXISTS "Super admins can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Super admins can delete profiles" ON profiles;

CREATE POLICY "Anyone can view profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can create profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete profiles"
  ON profiles FOR DELETE
  TO authenticated
  USING (true);

-- =====================================================
-- CLIENTS
-- =====================================================

DROP POLICY IF EXISTS "Authenticated users can view clients" ON clients;
DROP POLICY IF EXISTS "Admins can manage clients" ON clients;
DROP POLICY IF EXISTS "Admins can update clients" ON clients;
DROP POLICY IF EXISTS "Super admins can delete clients" ON clients;

CREATE POLICY "Anyone can view clients"
  ON clients FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can create clients"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update clients"
  ON clients FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete clients"
  ON clients FOR DELETE
  TO authenticated
  USING (true);

-- =====================================================
-- CHANTIERS
-- =====================================================

DROP POLICY IF EXISTS "Authenticated users can view chantiers" ON chantiers;
DROP POLICY IF EXISTS "Admins can manage chantiers" ON chantiers;
DROP POLICY IF EXISTS "Admins can update chantiers" ON chantiers;
DROP POLICY IF EXISTS "Super admins can delete chantiers" ON chantiers;

CREATE POLICY "Anyone can view chantiers"
  ON chantiers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can create chantiers"
  ON chantiers FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update chantiers"
  ON chantiers FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete chantiers"
  ON chantiers FOR DELETE
  TO authenticated
  USING (true);

-- =====================================================
-- MISSIONS
-- =====================================================

DROP POLICY IF EXISTS "Coordinators can view planifiee missions" ON missions;
DROP POLICY IF EXISTS "Admins can view all missions" ON missions;
DROP POLICY IF EXISTS "Admins can create missions" ON missions;
DROP POLICY IF EXISTS "Admins can update all missions" ON missions;
DROP POLICY IF EXISTS "Coordinators can update own missions" ON missions;
DROP POLICY IF EXISTS "Super admins can delete missions" ON missions;

CREATE POLICY "Anyone can view missions"
  ON missions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can create missions"
  ON missions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update missions"
  ON missions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete missions"
  ON missions FOR DELETE
  TO authenticated
  USING (true);

-- =====================================================
-- RAPPORTS
-- =====================================================

DROP POLICY IF EXISTS "Coordinators can view own reports" ON rapports;
DROP POLICY IF EXISTS "Admins can view all reports" ON rapports;
DROP POLICY IF EXISTS "Coordinators can create reports" ON rapports;
DROP POLICY IF EXISTS "Coordinators can update own draft reports" ON rapports;
DROP POLICY IF EXISTS "Admins can update all reports" ON rapports;
DROP POLICY IF EXISTS "Super admins can delete reports" ON rapports;

CREATE POLICY "Anyone can view rapports"
  ON rapports FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can create rapports"
  ON rapports FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update rapports"
  ON rapports FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete rapports"
  ON rapports FOR DELETE
  TO authenticated
  USING (true);

-- =====================================================
-- RAPPORT_PHOTOS
-- =====================================================

DROP POLICY IF EXISTS "Users can view photos of accessible reports" ON rapport_photos;
DROP POLICY IF EXISTS "Coordinators can add photos to own reports" ON rapport_photos;
DROP POLICY IF EXISTS "Admins can manage all photos" ON rapport_photos;
DROP POLICY IF EXISTS "Admins can update all photos" ON rapport_photos;
DROP POLICY IF EXISTS "Admins can delete photos" ON rapport_photos;

CREATE POLICY "Anyone can view photos"
  ON rapport_photos FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can create photos"
  ON rapport_photos FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update photos"
  ON rapport_photos FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete photos"
  ON rapport_photos FOR DELETE
  TO authenticated
  USING (true);

-- =====================================================
-- ACTIVITY_LOGS
-- =====================================================

DROP POLICY IF EXISTS "Admins can view activity logs" ON activity_logs;
DROP POLICY IF EXISTS "Authenticated users can create logs" ON activity_logs;

CREATE POLICY "Anyone can view logs"
  ON activity_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can create logs"
  ON activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);
