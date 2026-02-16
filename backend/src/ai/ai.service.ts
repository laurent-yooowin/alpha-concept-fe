import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class AiService {
  private openaiApiKey: string;
  private openaiUrl: string;
  private geminiApiKey: string;
  private geminiUrl: string;


  private readonly logger = new Logger(AiService.name);

  constructor(
    private configService: ConfigService,
    private readonly uploadService: UploadService
  ) {
    this.openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openaiUrl = this.configService.get<string>('OPENAI_API_URL', 'https://api.openai.com/v1/chat/completions');

    this.geminiApiKey = this.configService.get<string>('GEMENI_API_KEY');
    this.geminiUrl = this.configService.get<string>('GEMENI_API_URL', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');

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

      const response = await fetch(this.openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-5.1',
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
          // max_tokens: 3400,
          max_completion_tokens: 3400,
          // temperature: 0.8,
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

      const response = await fetch(this.openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-5.1',
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
          max_completion_tokens: 3400,
          // max_tokens: 1000,
          // temperature: 0.7,
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

  async analyzePhotoGemini(imageUrl: string): Promise<{
    nonConformities: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: string[];
  }> {
    // Assurez-vous d'avoir votre clé Gemini dans vos variables d'env
    if (!this.geminiApiKey) {
      throw new BadRequestException('Gemini API key not configured');
    }

    try {
      const imgBase64 = await this.uploadService.downloadFile(imageUrl, '', true);
      const prompt = this.buildCSPSPrompt();

      const response = await fetch(this.geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.geminiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gemini-2.0-flash',
          // Force le mode JSON pour éviter les blocs markdown (```json ... ```)
          response_format: { type: "json_object" },
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
                    // Gemini via l'adaptateur OpenAI accepte parfaitement le base64
                    url: `data:image/jpeg;base64,${imgBase64.data}`,
                  },
                },
              ],
            },
          ],
          // Gemini préfère "max_tokens" standard plutôt que "max_completion_tokens" dans l'adaptateur
          max_tokens: 3400,
          temperature: 0.8, // Gemini 2.0 Flash est créatif, 0.8 est bien, baissez à 0.4 si le JSON est instable
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        // Le format d'erreur de Google est légèrement différent, on le stringify pour le log
        throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from Gemini');
      }

      return this.parseAIResponse(content);
    } catch (error) {
      console.error('Error analyzing photo with Gemini:', error);
      throw new BadRequestException(`Failed to analyze photo: ${error.message}`);
    }
  }

  async analyzePhotoWithDirectivesGemini(
    imageUrl: string,
    userDirectives: string,
    previousReport: any // Typé 'any' ou 'string' selon votre DTO
  ): Promise<{
    nonConformities: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: string[];
  }> {

    // 1. Vérification de la clé Gemini
    if (!this.geminiApiKey) {
      throw new BadRequestException('Gemini API key not configured');
    }

    try {
      const imgBase64 = await this.uploadService.downloadFile(imageUrl, '', true);
      const prompt = this.buildCSPSPrompt();

      // Sécurisation de l'affichage du rapport précédent (si c'est un objet JSON, on le stringify proprement)
      const previousReportString = typeof previousReport === 'string'
        ? previousReport
        : JSON.stringify(previousReport, null, 2);

      const response = await fetch(this.geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.geminiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gemini-2.0-flash',
          // Force la sortie JSON strict (très important pour Gemini)
          response_format: { type: "json_object" },
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
                  ${previousReportString}

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
          // J'ai augmenté max_tokens à 4000. 
          // 1000 est risqué pour un rapport complet + contexte, et Gemini est très peu cher.
          max_tokens: 4000,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from Gemini');
      }

      return this.parseAIResponse(content);
    } catch (error) {
      console.error('Error analyzing photo with Gemini:', error);
      throw new BadRequestException(`Failed to analyze photo: ${error.message}`);
    }
  }

  private buildCSPSPrompt(): string {
    return `You are an Expert Safety and Health Protection Coordinator (CSPS / SPS).
Your task is to perform a DETAILED and CRITICAL safety analysis of construction site photos.

CRITICAL REQUIREMENT (FULL-FRAME SCAN):
You MUST analyze the entire image (foreground, background, corners, ground, access paths, nearby traffic/public interface).
Detect subtle hazards a human may easily miss (low-contrast details, partially hidden issues, distant networks clues).
Do NOT invent; if uncertain, state the uncertainty and classify the risk conservatively.

---

## 1. ANALYSIS PARAMETERS (INTERNAL PROCESS)
Before generating the output, mentally process the image using these parameters (do not output these details):
- Context: Urban, Rural, Underground, or Industrial.
- Project Owner (MOA): RTE, Enedis, Orange, RATP, Industry, or Building.
- Docs: AA, AMT, IT, DICT, VGP.

---

## 2. STRICT CHECKPOINTS (MANDATORY RULES)
You must verify these points specifically. Any deviation is a Non-Conformity.

### 2.1 Fencing & Barriers (CRITICAL)
- Requirement: ONLY rigid barriers (Heras/K2) or chains (electrical zones) are compliant.
- Prohibition: Rubalise (plastic tape) is STRICTLY FORBIDDEN as a protective barrier. If seen, it is a non-conformity.

### 2.2 Personal Protective Equipment (PPE) — MANDATORY OUTPUT RULE
- Condition: Apply ONLY if personnel are visible.
- If personnel are visible, you MUST output at least one PPE statement in nonConformities:
  - either a non-conformity (missing/incorrect PPE),
  - or explicitly: "EPI visibles conformes sur la photo" (if everything visible is compliant).
- Required (if applicable): Casque avec jugulaire fermée, gants, tenue de travail, chaussures de sécurité.
- If a PPE item is not clearly visible (e.g., helmet hidden/blurred), treat it as NOT CONFIRMED and classify conservatively (state uncertainty).
- Rule: If no workers are visible, do NOT mention PPE at all.

### 2.3 Road Signage & Public Protection (TERMS ENFORCED)
- Requirement: If an interface with road/public is visible or plausible, you MUST explicitly state:
  - "panneau AK5" (présent/absent/non confirmé),
  - "panneau BK" (présent/absent/non confirmé; type si lisible),
  - "barriérage rigide type Heras/K2" pour protection des tiers (présent/absent/non conforme).
- Do not write only "signalisation absente" without naming AK5/BK.

### 2.4 Electrical Safety
- Requirement: Double chains and zone identification signs.
- Reference: NF C 18-510.

### 2.5 Excavation & Heights
- Excavation: Shoring/box required if depth > 1.30m.
- Heights: Ladders forbidden as workstations. Compliant access/platforms required.

### 2.6 Surroundings & Subtle Hazards (MANDATORY)
Include hazards outside the main focus when relevant (circulation, ground, peripheral protections, storage, distant networks clues).

### 2.7 Engins / coactivité engin-piéton (MANDATORY OUTPUT RULE)
- Condition: Apply if ANY mobile equipment is visible (pelle, chargeuse, camion, etc.).
- Mandatory output: If an engin AND at least one worker on foot are visible, you MUST output at least ONE dedicated nonConformity about heurt/écrasement.
- Checks (full-frame): zone d'exclusion matérialisée, séparation physique ou organisationnelle des flux, angles morts, giration tourelle, mouvements bras/godet, guidage/chef de manœuvre si nécessaire.
- If separation/organization is not clearly visible, state "non confirmé" and treat as elevated risk (conservative).

### 2.8 VOCABULAIRE TECHNIQUE OBLIGATOIRE (RÈGLE DE RÉDACTION)
- Interdiction de termes vagues si un terme technique existe: ne pas écrire seulement "barrière", "balisage", "signalisation", "panneau" sans préciser le type.
- Si le sujet est le périmètre chantier: utiliser explicitement "barriérage rigide type Heras/K2" (ou "double chaînette" si zone électrique) et préciser si absence/discontinuité.
- Si le chantier est en interface voirie/tiers: mentionner explicitement la présence/absence de "panneau AK5" et de "panneau BK" (préciser le libellé exact si lisible; sinon écrire "BK (type non lisible / non confirmé)").
- Si risque électrique: mentionner explicitement "double chaînette" et "panneau d’identification de zone" si attendu; sinon noter l’absence.
- Rubalise: toujours qualifier "rubalise (non conforme)" si visible.
- Si un élément est flou: écrire "non confirmé" plutôt que de supposer.

---

## 3. DRAFTING RULES (SANITIZATION)
- Sanitization: Do NOT mention the MOA name, the specific environment location, or any duration/time concepts (months/days).
- Language: All output text inside the JSON must be in FRENCH.
- Do NOT output labels like "Environnement autour:"; integrate it naturally into observations.

---

## 4. OUTPUT FORMAT (STRICT JSON)
You must return ONLY a valid JSON object (no extra text).

IMPORTANT FORMATTING:
- In strings, use the newline sequence \\n (JSON-safe).
- Brief site description appears exactly once: ONLY at the start of nonConformities[0], then \\n\\n.

IMPORTANT ARRAY RULE (NO \\n FOR LISTS):
- recommendations MUST be an array where **each element is exactly one measure** (no multi-measure string, no bullet list, no \\n).
- references MUST be an array where **each element is exactly one regulatory text** (no concatenation, no \\n).

JSON structure:

{
  "nonConformities": [
    "nonConformities[0] pattern:\\n[Description brève du chantier (1 à 2 phrases max)]\\\\n\\\\n[Observation 1]\\\\nDanger : ...\\\\nRisque : ...",
    "nonConformities[1..] pattern:\\n[Observation X]\\\\nDanger : ...\\\\nRisque : ..."
  ],
  "recommendations": [
    "Mesure unique 1 (action concrète, immédiatement applicable).",
    "Mesure unique 2 ...",
    "Mesure unique 3 ..."
  ],
  "riskLevel": "high",
  "confidence": 90,
  "photoConformity": false,
  "references": [
    "Code du travail - Articles R4321-4 et R4323-95.",
    "Norme NF C 18-510.",
    "Arrêté du 24 novembre 1967.",
    "Instruction Interministérielle sur la Signalisation Routière (IISR) - 8ème partie."
  ]
}

---

## 5. REFERENCE TEXTS (USE ONLY THESE)
- EPI: Code du travail - Articles R4321-4 et R4323-95.
- Travail en Hauteur: Code du travail - Articles R4323-58 à R4323-71 et R4323-63.
- Terrassement / Fouilles: Code du travail - Article R4534-24 et R4534-22.
- Signalisation Routière: Arrêté du 24 novembre 1967 et IISR - 8ème partie.
- Risque Électrique: Norme NF C 18-510 et Code du travail - Articles R4544-1 à R4544-11.
- Engins / coactivité engins-piétons : Code du travail - Articles R4323-51 et R4323-52.
- Circulation véhicules sur chantier : Code du travail - Article R4534-10.

---

## 6. IMPORTANT INSTRUCTIONS
- Description brève: ONLY once, ONLY in nonConformities[0], then \\n\\n.
- Observations: one per array item; factual; include surrounding details if they change the risk; no dedicated label.
- Per nonConformity: MUST contain \\n before Danger : and \\n before Risque :.
- recommendations: 1 measure per string, no \\n.
- references: 1 text per string, no \\n.
- Output: ONLY the raw JSON object.
- PRIORITY ORDER (if personnel visible): the first observation after the brief site description MUST be the PPE check (at least helmet presence/absence).
- PRIORITY ORDER (if personnel visible): after the PPE check, the next mandatory check MUST be Engins/coactivité (if an engin is visible), then excavation/signage/etc.
- TECHNICAL WORDING: When describing barriers/signage, use the exact terms "barriérage rigide type Heras/K2", "panneau AK5", "panneau BK", "rubalise (non conforme)", "double chaînette" (if applicable). Avoid generic wording.

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

      // 1. Nettoyage des balises Markdown (```json et ```)
      let cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();

      // 2. Nettoyage "brutal" : on ne garde que ce qu'il y a entre la première et la dernière accolade
      // Cela élimine le texte introductif type "Voici le rapport :"
      const firstBrace = cleanContent.indexOf('{');
      const lastBrace = cleanContent.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1) {
        cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);
      }

      // 3. Parsing du JSON
      const parsed = JSON.parse(cleanContent);

      // const parsed = JSON.parse(jsonMatch[0]);

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
        ${content} `);
    }
  }
}
