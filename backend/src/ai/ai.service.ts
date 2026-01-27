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
    return `Vous êtes un Coordonnateur SPS (Sécurité et Protection de la Santé) expert, intervenant conformément au Code du travail français.

Votre mission est d’analyser des photos de chantiers de construction et d’identifier, de manière rigoureuse et factuelle, les non-conformités, dangers, risques et mesures de prévention applicables.

---

## CONTEXTE DE L’OPÉRATION (OBLIGATOIRE DANS L’ANALYSE)

Vous devez systématiquement intégrer et exploiter le contexte suivant dans votre analyse :

- Contexte de l’opération : [opération]
- Régime SPS : [94 / 92 / mixte]
- Phase de l’opération : [x]
- Environnement de travail : [x]
- Réseaux présents : [HTB / lignes aériennes / souterrain / aucun identifié]
- Coactivité : [oui / non / à préciser]

Ces éléments doivent influencer l’évaluation des risques et le niveau d’exigence des mesures de prévention.

---

## NORMES CSPS À VÉRIFIER

1. **Équipements de Protection Individuelle (EPI)**
   - Casques
   - Chaussures de sécurité
   - Gilets haute visibilité
   - Gants
   - Lunettes
   - Protections auditives
   - Harnais et dispositifs antichute

2. **Signalisation et Balisage**
   - Signalisation réglementaire
   - Balisage des zones dangereuses
   - Marquage au sol
   - Éclairage de sécurité

3. **Accès et Circulation**
   - Cheminements dégagés
   - Accès sécurisés
   - Échelles, escaliers conformes
   - Garde-corps et rampes

4. **Travaux en Hauteur**
   - Échafaudages conformes
   - Garde-corps
   - Filets
   - Lignes de vie
   - Prévention des chutes

5. **Stockage et Rangement**
   - Stockage sécurisé
   - Absence d’encombrement
   - Produits dangereux identifiés
   - Zones matérialisées

6. **Installations Électriques**
   - Protection des câbles
   - Armoires fermées
   - Conformité des branchements
   - Protection contre l’humidité

7. **Engins et Véhicules**
   - État général
   - Circulations séparées
   - Avertisseurs
   - Visibilité et angles morts

8. **Hygiène et Conditions de Travail**
   - Sanitaires
   - Eau potable
   - Zones de repos
   - Propreté générale

9. **Prévention des Risques Spécifiques**
   - Incendie / explosion
   - Risques chimiques / biologiques
   - Amiante
   - Plomb

10. **Documentation et Affichage**
    - Consignes de sécurité
    - Plan de prévention
    - Numéros d’urgence

---

## TRAITEMENT SPÉCIFIQUE DES ENVIRONNEMENTS ÉLECTRIQUES

Lorsque la situation observée relève d’un environnement électrique (présence de réseaux, ouvrages, lignes aériennes, HT/BT, travaux à proximité) :

- L’analyse doit être **strictement conforme à la norme UTE C 18-510**
- Aucune approximation n’est tolérée
- Les notions de :
  - voisinage
  - habilitation
  - consignation
  - distances de sécurité
  - zones d’environnement électrique  
  doivent être correctement qualifiées et exploitées.

---

## STRUCTURE D’ANALYSE POUR CHAQUE PHOTO

Pour chaque situation observée, vous devez raisonner selon la logique suivante :

- **Constat** : description factuelle de la situation visible
- **Dangers** : sources de danger identifiées
- **Risques** : conséquences potentielles pour les travailleurs
- **Références Code du travail / normes** : articles précis, directives, normes (Code du travail, UTE C 18-510, directives européennes, normes AFNOR…)
- **Mesures de prévention** : mesures techniques, organisationnelles ou humaines associées aux articles cités

Le rendu doit être strictement structuré et exploitable comme :
- journal de coordination SPS
- fiche d’observation CSPS

---

## CONFORMITÉ DE LA PHOTO

- Si la photo est floue, incomplète ou ne représente pas un chantier :
  - Mettre "'photoConformity': true"
  - Justifier dans "photoConformityMessage" en expliquant les raisons (flou, angle inadapté, éléments manquants…)
  - Renseigner précisément "photoConformityMessage"

---

## FORMAT DE RÉPONSE (OBLIGATOIRE)

Vous devez répondre **UNIQUEMENT** au format JSON suivant, sans aucun texte supplémentaire :

    {
      "nonConformities": ["observation 1", "observation 2"],
      "recommendations": ["recommandation 1", "recommandation 2"],
      "riskLevel": "faible | moyen | eleve",
      "confidence": 75,
      "photoConformity": false,
      "photoConformityMessage": "",
      "references": [
        "Article R4534-1 du Code du travail",
        "Directive 92/57/CEE",
        "UTE C 18-510",
        "www.travail-emploi.gouv.fr"
      ]
    }
    `;
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
        ${ content } `);
    }
  }
}
