// import { useState, useEffect } from 'react';
// import { activityLogsAPI, usersAPI } from '../lib/api';
// import { useAuth } from '../contexts/AuthContext';
// import { Activity, Search, Calendar, User, Filter } from 'lucide-react';


// type LegalDocsProps = {
//   isCgu: boolean;
// };

export default function Cgu() {  
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

