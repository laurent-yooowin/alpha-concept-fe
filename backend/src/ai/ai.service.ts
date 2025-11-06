import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class AiService {
  private openaiApiKey: string;

  private readonly logger = new Logger(AiService.name);

  constructor(
    private configService: ConfigService,
    private readonly uploadService: UploadService
  ) {
    this.openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!this.openaiApiKey) {
      console.warn('OPENAI_API_KEY not configured. AI analysis will not be available.');
    }

  }

  async analyzePhoto(imageUrl: string): Promise<{
    nonConformities: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: string[];
  }> {
    if (!this.openaiApiKey) {
      throw new BadRequestException('OpenAI API key not configured');
    }

    try {
      const imgBase64 = await this.uploadService.downloadFile(imageUrl, '', true);
      const prompt = this.buildCSPSPrompt();

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: prompt,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: "Analysez cette photo de chantier selon les normes CSPS. Identifiez les risques, les non-conformités et fournissez des recommandations ainsi que les références de ton analyse. Toujours fournir la réponse sous format JSON valide. Si la photo n'est pas conforme mettre le flag photoConformity à < false > ",
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${imgBase64.data}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 1000,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return this.parseAIResponse(content);
    } catch (error) {
      console.error('Error analyzing photo:', error);
      throw new BadRequestException(`Failed to analyze photo: ${error.message}`);
    }
  }

  async analyzePhotoWithDirectives(imageUrl: string, userDirectives: string, previousReport): Promise<{
    nonConformities: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: string[];
  }> {
    if (!this.openaiApiKey) {
      throw new BadRequestException('OpenAI API key not configured');
    }

    try {
      const imgBase64 = await this.uploadService.downloadFile(imageUrl, '', true);
      const prompt = this.buildCSPSPrompt();

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: prompt,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: ` Analysez cette photo de chantier selon les normes CSPS. 
                  Voici les informations nécessaires pour régénérer le nouveau rapport CSPS :

                  ### Ancien rapport :
                  ${previousReport}

                  ### Directives du coordonnateur :
                  ${userDirectives}

                  Merci de produire le **nouveau rapport CSPS** complet au format JSON spécifié.
                  Identifiez les risques, les non-conformités et fournissez des recommandations ainsi que les références de ton analyse. 
                  Toujours fournir la réponse sous format JSON valide. 
                  Si la photo n'est pas conforme mettre le flag photoConformity à < false > `,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${imgBase64.data}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 1000,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return this.parseAIResponse(content);
    } catch (error) {
      console.error('Error analyzing photo:', error);
      throw new BadRequestException(`Failed to analyze photo: ${error.message}`);
    }
  }

  private buildCSPSPrompt(): string {
    return `Vous êtes un Coordonnateur SPS (Sécurité et Protection de la Santé) expert.

Votre rôle est d'analyser des photos de chantiers de construction et d'identifier :

**NORMES CSPS À VÉRIFIER :**

1. **Équipements de Protection Individuelle (EPI) :**
   - Casques de protection
   - Chaussures de sécurité
   - Gilets haute visibilité
   - Gants de protection
   - Lunettes de protection
   - Protections auditives
   - Harnais de sécurité (travaux en hauteur)

2. **Signalisation et Balisage :**
   - Panneaux de signalisation conformes
   - Balisage des zones dangereuses
   - Marquage au sol
   - Éclairage de sécurité

3. **Accès et Circulation :**
   - Voies de circulation dégagées
   - Accès sécurisés
   - Échelles et escaliers conformes
   - Rampes et garde-corps

4. **Travaux en Hauteur :**
   - Échafaudages conformes et stables
   - Garde-corps présents et fixés
   - Filets de sécurité
   - Protection contre les chutes
   - Lignes de vie

5. **Stockage et Rangement :**
   - Matériaux correctement stockés
   - Absence d'encombrement
   - Produits dangereux identifiés et isolés
   - Zones de stockage délimitées

6. **Installations Électriques :**
   - Câbles protégés
   - Armoires électriques fermées
   - Conformité des branchements
   - Protection contre l'humidité

7. **Engins et Véhicules :**
   - Engins de chantier en bon état
   - Respect des zones de circulation
   - Présence d'avertisseurs sonores
   - Visibilité du conducteur

8. **Hygiène et Conditions de Travail :**
   - Sanitaires disponibles
   - Points d'eau potable
   - Zones de repos
   - Propreté du chantier

9. **Prévention des Risques Spécifiques :**
   - Risque d'incendie
   - Risque d'explosion
   - Risques chimiques
   - Risques biologiques
   - Amiante
   - Plomb

10. **Documentation et Affichage :**
    - Consignes de sécurité affichées
    - Plan de prévention visible
    - Numéros d'urgence affichés

11. **Références du rapport :**
    - Vous DEVEZ inclure dans le champ "references" du JSON de ta réponse une liste d'articles, directives officielles, et liens utiles, références ... (URLs, emails, téléphones) liés aux observations et recommandations formulées.
    - Chaque référence doit être pertinente (ex. décret, directive européenne, norme AFNOR, etc.).

12. **Conformité de la photo :**
    - Si la photo n'est pas lisible ou non conforme mêttre le flague photoConformity à true et ajouter le commentaire dans photoConformityMessage 
    
**FORMAT DE RÉPONSE :**
Vous devez répondre UNIQUEMENT au format JSON suivant, sans texte supplémentaire :

{
  "nonConformities": ["observation 1", "observation 2", "..."],
  "recommendations": ["recommandation 1", "recommandation 2", "..."],
  "riskLevel": "faible" | "moyen" | "eleve",
  "confidence": 0.85,
  "photoConformity": false,
  "photoConformityMessage": "Il semble que l'image montre un environnement de bureau plutôt qu'un chantier de construction",
  "references": [
    "Article R4534-1 du Code du Travail",
    "Directive 92/57/CEE",
    "www.travail-emploi.gouv.fr/securite-chantier"
  ]
}

**nonConformities :**
- Regrouper touts les risques et non conformités et autres observations identifiés durant l'analyse de la photo. 

**NIVEAUX DE RISQUE :**
- **faible** : Conformité globale, pas de risques graves identifiés
- **moyen** : Quelques non-conformités mineures, améliorations recommandées
- **eleve** : Non-conformités graves, risques pour la sécurité des travailleurs, actions correctives immédiates requises

**CONFIDENCE :**
- Un nombre entier entre 0 et 100 indiquant votre niveau de certitude dans l'analyse (70-85 pour une photo claire, moins si floue ou partielle).
- Le nombre Doit être un entier entre 0 et 100, exemple 65.

**Note :**
- 
- Si aucune référence n'est applicable, le champ "references" doit être une liste vide : \`"references": []\`.
- Les champs doivent TOUS être présents.
- Toujours la réponse doit être sous format JSON valide.

Soyez précis, factuel et professionnel dans vos observations et recommandations et donner des détails pertinants.`;
  }

  private parseAIResponse(content: string): {
    nonConformities: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: any;
    content: any;
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      this.logger.log('parseAIResponse >>> :', content);

      const parsed = JSON.parse(jsonMatch[0]);

      this.logger.log('parseAIResponse parsed >>> :', parsed);

      return {
        nonConformities: Array.isArray(parsed.nonConformities) ? parsed.nonConformities : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        riskLevel: ['faible', 'moyen', 'eleve'].includes(parsed.riskLevel)
          ? parsed.riskLevel
          : 'moyen',
        // confidence: typeof parsed.confidence === 'number'
        //   ? Math.max(0, Math.min(1, parsed.confidence))
        //   : 0.75,
        confidence: parsed.confidence,
        photoConformity: parsed.photoConformity || true,
        photoConformityMessage: parsed.photoConformityMessage || "",
        references: parsed.references || [],
        content: content
      };
    } catch (error) {
      console.error('Error parsing AI response:', error);
      throw new BadRequestException(`Failed to parse AI response
        ${content}`);
    }
  }
}
