// import { useState, useEffect } from 'react';
// import { activityLogsAPI, usersAPI } from '../lib/api';
// import { useAuth } from '../contexts/AuthContext';
// import { Activity, Search, Calendar, User, Filter } from 'lucide-react';


// type LegalDocsProps = {
//   isCgu: boolean;
// };

export default function Privacy() {
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

