import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type UserRole = 'ROLE_ADMIN' | 'ROLE_USER';

export interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: UserRole;
  zone_geographique: string | null;
  specialite: string | null;
  isActive: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  nom: string;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chantier {
  id: string;
  client_id: string;
  nom: string;
  adresse: string;
  ville: string;
  code_postal: string | null;
  reference_interne: string | null;
  created_at: string;
  updated_at: string;
  clients?: Client;
}

export type MissionStatut = 'en_attente' | 'planifiee' | 'refusee' | 'en_cours' | 'terminee' | 'annulee';

export interface Mission {
  id: string;
  chantier_id: string;
  coordinator_id: string | null;
  date_debut: string;
  date_fin: string;
  statut: MissionStatut;
  consignes: string | null;
  remarques_admin: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  chantiers?: Chantier;
  coordinator?: Profile;
}

export type RapportStatut = 'draft' | 'submitted' | 'validated' | 'sent_to_client';

export interface Rapport {
  id: string;
  mission_id: string;
  coordinator_id: string;
  contenu: string;
  observations: string | null;
  statut: RapportStatut;
  validated_by: string | null;
  validated_at: string | null;
  sent_to_client_at: string | null;
  remarques_admin: string | null;
  created_at: string;
  updated_at: string;
  missions?: Mission;
  coordinator?: Profile;
}

export interface ActivityLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}
