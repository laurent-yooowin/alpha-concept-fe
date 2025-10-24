import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiService {
  private openaiApiKey: string;

  constructor(private configService: ConfigService) {
    this.openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!this.openaiApiKey) {
      console.warn('OPENAI_API_KEY not configured. AI analysis will not be available.');
    }
  }

  async analyzePhoto(imageUrl: string): Promise<{
    observations: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
  }> {
    if (!this.openaiApiKey) {
      throw new BadRequestException('OpenAI API key not configured');
    }

    try {
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
                  text: 'Analysez cette photo de chantier selon les normes CSPS. Identifiez les risques, les non-conformités et fournissez des recommandations.',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl,
                  },
                },
              ],
            },
          ],
          max_tokens: 1000,
          temperature: 0.3,
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

**FORMAT DE RÉPONSE :**
Vous devez répondre UNIQUEMENT au format JSON suivant, sans texte supplémentaire :

{
  "observations": ["observation 1", "observation 2", "..."],
  "recommendations": ["recommandation 1", "recommandation 2", "..."],
  "riskLevel": "faible" | "moyen" | "eleve",
  "confidence": 0.85
}

**NIVEAUX DE RISQUE :**
- **faible** : Conformité globale, pas de risques graves identifiés
- **moyen** : Quelques non-conformités mineures, améliorations recommandées
- **eleve** : Non-conformités graves, risques pour la sécurité des travailleurs, actions correctives immédiates requises

**CONFIDENCE :**
Un nombre entre 0 et 1 indiquant votre niveau de certitude dans l'analyse (0.7-0.85 pour une photo claire, moins si floue ou partielle).

Soyez précis, factuel et professionnel dans vos observations et recommandations.`;
  }

  private parseAIResponse(content: string): {
    observations: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        observations: Array.isArray(parsed.observations) ? parsed.observations : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        riskLevel: ['faible', 'moyen', 'eleve'].includes(parsed.riskLevel)
          ? parsed.riskLevel
          : 'moyen',
        confidence: typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.75,
      };
    } catch (error) {
      console.error('Error parsing AI response:', error);
      throw new BadRequestException('Failed to parse AI response');
    }
  }
}
