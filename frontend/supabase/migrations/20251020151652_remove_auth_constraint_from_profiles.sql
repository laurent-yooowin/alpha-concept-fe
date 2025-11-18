/*
  # Suppression de la contrainte d'authentification sur profiles
  
  ## Description
  Supprime la contrainte de clé étrangère liant profiles.id à auth.users.id
  pour permettre l'insertion directe d'utilisateurs sans authentification.
  
  ## Changements
  - Suppression de la contrainte profiles_id_fkey
  - Permet la création de profils indépendants de auth.users
  
  ## Impact
  - Les profils peuvent maintenant être créés librement
  - Plus de dépendance obligatoire avec le système d'authentification
*/

-- Supprimer la contrainte de clé étrangère
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
