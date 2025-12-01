import { useState, useEffect } from 'react';
import { activityLogsAPI, usersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Activity, Search, Calendar, User, Filter } from 'lucide-react';

interface Cgu {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: any;
  created_at: string;
}

interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
}

export default function LegalDocs({isCgu: boolean = false}) {

  if(isCgu) {
    return (
      <div className="p-6 space-y-10 text-base leading-relaxed">
        {/* CGU */}
        <section>
          <h1 className="text-3xl font-bold mb-4">Conditions Générales d’Utilisation (CGU) – ReportBTP</h1>
          <p><strong>Éditeur :</strong> Yooowin</p>
          <p><strong>Adresse :</strong> 5 rue du Banquier, 75013 Paris</p>
          <p><strong>Email :</strong> toufik@yooowin.com</p>
          <p><strong>Version :</strong> 1.0</p>

          <h2 className="text-xl font-semibold mt-6">1. Objet</h2>
          <p>Les présentes CGU définissent les conditions d’utilisation de l’application ReportBTP, destinée aux coordonnateurs SPS (CSPS) et professionnels du BTP pour la prise de photos, la collecte d’informations terrain et la génération de rapports réglementaires.</p>

          <h2 className="text-xl font-semibold mt-6">2. Éditeur de l’Application</h2>
          <p>ReportBTP est éditée par Yooowin, 5 rue du Banquier, 75013 Paris.</p>

          <h2 className="text-xl font-semibold mt-6">3. Description de l’Application</h2>
          <p>L’application permet la gestion de projets, la prise de photos, l’annotation, la génération de rapports et leur exportation.</p>

          <h2 className="text-xl font-semibold mt-6">4. Conditions d’accès</h2>
          <p>L’application fonctionne sur terminaux Android et iOS. Certaines fonctionnalités nécessitent un compte ou un abonnement.</p>

          <h2 className="text-xl font-semibold mt-6">5. Création de compte</h2>
          <p>L’utilisateur est responsable de l’exactitude des informations et de la confidentialité de ses identifiants.</p>

          <h2 className="text-xl font-semibold mt-6">6. Utilisation de l’Application</h2>
          <p>L’utilisateur s’engage à respecter la législation, le droit à l’image et la confidentialité des chantiers.</p>

          <h2 className="text-xl font-semibold mt-6">7. Propriété intellectuelle</h2>
          <p>Les contenus de l’application appartiennent à Yooowin. Les contenus produits par l’utilisateur restent sa propriété.</p>

          <h2 className="text-xl font-semibold mt-6">8. Données personnelles</h2>
          <p>Les données sont traitées conformément au RGPD. Voir Politique de Confidentialité.</p>

          <h2 className="text-xl font-semibold mt-6">9. Permissions requises</h2>
          <p>Caméra, stockage, internet, notifications, géolocalisation (optionnelle).</p>

          <h2 className="text-xl font-semibold mt-6">10. Disponibilité du service</h2>
          <p>L’éditeur peut suspendre temporairement l’accès en cas de maintenance.</p>

          <h2 className="text-xl font-semibold mt-6">11. Responsabilités</h2>
          <p>L’utilisateur reste responsable de l’usage de l’application et des données qu’il saisit.</p>

          <h2 className="text-xl font-semibold mt-6">12. Modifications des CGU</h2>
          <p>Les CGU peuvent être mises à jour. L’utilisateur en sera informé.</p>

          <h2 className="text-xl font-semibold mt-6">13. Résiliation</h2>
          <p>Le compte peut être supprimé par l’utilisateur ou en cas de non-respect des CGU.</p>

          <h2 className="text-xl font-semibold mt-6">14. Loi applicable</h2>
          <p>Les CGU sont régies par le droit français.</p>

          <h2 className="text-xl font-semibold mt-6">15. Contact</h2>
          <p>toufik@yooowin.com – 5 rue du Banquier, 75013 Paris</p>
        </section>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-10 text-base leading-relaxed">
      {/* Politique de Confidentialité */}
      <section>
        <h1 className="text-3xl font-bold mb-4">Politique de Confidentialité – ReportBTP</h1>
        <p><strong>Éditeur :</strong> Yooowin</p>
        <p><strong>Adresse :</strong> 5 rue du Banquier, 75013 Paris</p>
        <p><strong>Email :</strong> toufik@yooowin.com</p>

        <h2 className="text-xl font-semibold mt-6">1. Objet</h2>
        <p>Cette Politique décrit les pratiques de Yooowin concernant la collecte, l’utilisation et la protection des données personnelles des utilisateurs.</p>

        <h2 className="text-xl font-semibold mt-6">2. Données collectées</h2>
        <p>Données fournies (email, photos, notes), données techniques (logs, modèle appareil) et géolocalisation si activée.</p>

        <h2 className="text-xl font-semibold mt-6">3. Finalités</h2>
        <p>Fonctionnement de l’application, génération de rapports, sécurité, assistance, amélioration du service.</p>

        <h2 className="text-xl font-semibold mt-6">4. Base légale</h2>
        <p>Exécution du contrat, consentement, intérêt légitime.</p>

        <h2 className="text-xl font-semibold mt-6">5. Partage des données</h2>
        <p>Sous-traitants techniques, destinataires choisis par l’utilisateur, obligations légales. Aucune vente de données.</p>

        <h2 className="text-xl font-semibold mt-6">6. Stockage et durée</h2>
        <p>Conservation tant que le compte est actif. Suppression possible à tout moment.</p>

        <h2 className="text-xl font-semibold mt-6">7. Sécurité</h2>
        <p>Chiffrement, serveurs sécurisés, mots de passe hachés, contrôles d’accès.</p>

        <h2 className="text-xl font-semibold mt-6">8. Droits RGPD</h2>
        <p>Accès, rectification, effacement, opposition, portabilité. Contact : toufik@yooowin.com</p>

        <h2 className="text-xl font-semibold mt-6">9. Permissions</h2>
        <p>Caméra, fichiers, internet, notifications, géolocalisation (optionnelle)</p>

        <h2 className="text-xl font-semibold mt-6">10. Mineurs</h2>
        <p>Application non destinée aux mineurs.</p>

        <h2 className="text-xl font-semibold mt-6">11. Transferts hors UE</h2>
        <p>Encadrés par les clauses contractuelles types ou solutions conformes RGPD.</p>

        <h2 className="text-xl font-semibold mt-6">12. Modifications</h2>
        <p>La Politique peut être mise à jour. Les utilisateurs seront informés des changements majeurs.</p>

        <h2 className="text-xl font-semibold mt-6">13. Contact</h2>
        <p>toufik@yooowin.com – Yooowin, 5 rue du Banquier, 75013 Paris</p>
      </section>
    </div>
  );
}

