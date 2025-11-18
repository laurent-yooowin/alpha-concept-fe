/*
  # Autoriser l'accès anonyme à toutes les tables
  
  ## Description
  Modification des politiques RLS pour permettre l'accès complet
  avec le rôle anonyme (anon) sans nécessiter d'authentification.
  
  ## Changements
  - Ajout de politiques pour le rôle 'anon' sur toutes les tables
  - Permet la consultation et modification sans authentification
  
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

CREATE POLICY "Anon can view profiles"
  ON profiles FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can create profiles"
  ON profiles FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon can update profiles"
  ON profiles FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon can delete profiles"
  ON profiles FOR DELETE
  TO anon
  USING (true);

-- =====================================================
-- CLIENTS
-- =====================================================

CREATE POLICY "Anon can view clients"
  ON clients FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can create clients"
  ON clients FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon can update clients"
  ON clients FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon can delete clients"
  ON clients FOR DELETE
  TO anon
  USING (true);

-- =====================================================
-- CHANTIERS
-- =====================================================

CREATE POLICY "Anon can view chantiers"
  ON chantiers FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can create chantiers"
  ON chantiers FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon can update chantiers"
  ON chantiers FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon can delete chantiers"
  ON chantiers FOR DELETE
  TO anon
  USING (true);

-- =====================================================
-- MISSIONS
-- =====================================================

CREATE POLICY "Anon can view missions"
  ON missions FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can create missions"
  ON missions FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon can update missions"
  ON missions FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon can delete missions"
  ON missions FOR DELETE
  TO anon
  USING (true);

-- =====================================================
-- RAPPORTS
-- =====================================================

CREATE POLICY "Anon can view rapports"
  ON rapports FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can create rapports"
  ON rapports FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon can update rapports"
  ON rapports FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon can delete rapports"
  ON rapports FOR DELETE
  TO anon
  USING (true);

-- =====================================================
-- RAPPORT_PHOTOS
-- =====================================================

CREATE POLICY "Anon can view photos"
  ON rapport_photos FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can create photos"
  ON rapport_photos FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon can update photos"
  ON rapport_photos FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon can delete photos"
  ON rapport_photos FOR DELETE
  TO anon
  USING (true);

-- =====================================================
-- ACTIVITY_LOGS
-- =====================================================

CREATE POLICY "Anon can view logs"
  ON activity_logs FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can create logs"
  ON activity_logs FOR INSERT
  TO anon
  WITH CHECK (true);
