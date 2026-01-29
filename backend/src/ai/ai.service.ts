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
          model: 'gpt-4.1',
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
    return `You are a senior Safety and Health Protection Coordinator (CSPS / SPS),
with extensive field experience on complex construction sites
(infrastructure, civil works, industrial and electrical environments).

Your task is to perform a DETAILED, EXHAUSTIVE and CRITICAL safety analysis
of construction site photos.

Superficial, generic or high-level observations are NOT acceptable.

---

## 1. OPERATION CONTEXT (MANDATORY – DRIVES THE ANALYSIS)

You must explicitly integrate the following context into your reasoning:

- Operation: [operation]
- SPS regulatory regime: [94 / 92 / mixed]
- Project phase: [x]
- Working environment (urban / industrial / confined / open site / electrical): [x]
- Existing networks: [HV / LV / overhead lines / underground networks / none identified]
- Co-activity (simultaneous trades, vehicles, public interface): [yes / no / describe]

The context MUST influence:
- the severity of risks
- the required preventive measures
- the final risk level

---

## 2. MANDATORY SYSTEMATIC REVIEW (NO SKIPPING)

You MUST systematically review ALL categories below.
If no issue is visible, explicitly state: “No non-compliance observed on photo”.

### 2.1 Personal Protective Equipment (PPE)
- Presence / absence per worker
- Adequacy to the task and environment
- Condition and proper use
- Consistency with identified hazards

### 2.2 Collective Protections
- Guardrails, covers, barriers, fall protection
- Installation quality and continuity
- Priority over PPE (collective vs individual protection)

### 2.3 Access, Circulation and Housekeeping
- Safe access routes
- Vehicle / pedestrian segregation
- Obstructions, tripping hazards
- Emergency evacuation paths

### 2.4 Work at Height
- Type of work at height
- Means of access
- Fall prevention systems
- Residual fall risks

### 2.5 Electrical Environment
- Presence of electrical installations or networks
- Identification of live parts or vicinity zones
- Protection against direct and indirect contact
- Compliance with safety distances

### 2.6 Machinery, Tools and Vehicles
- Visible condition
- Unsafe use
- Interaction with workers
- Blind spots and collision risks

### 2.7 Signage, Information and Site Organization
- Regulatory signage
- Temporary warnings
- Clarity and visibility

### 2.8 Specific Risks
- Fire and explosion
- Chemical exposure
- Confined spaces
- Asbestos / lead (if applicable)

---

## 3. STRICT ELECTRICAL REQUIREMENTS (UTE C 18-510)

If the environment is electrical or near electrical networks:

- Apply UTE C 18-510 STRICTLY
- Correctly qualify:
  - electrical environment zones
  - vicinity vs live work
  - required authorizations and clearances
  - safety distances and protective measures
- Any uncertainty must be treated as a HIGH RISK.

No assumption or approximation is allowed.

---

## 4. ANALYTICAL STRUCTURE – PER PHOTO

For EACH significant situation observed, produce the following reasoning:
- **nonConformities**:

  - **Observations**  
    Precise, factual, visual description (what is seen, where, who, how)

  - **Hazards**  
    Identified source(s) of danger

  - **Risks**  
    Realistic potential consequences (injury type, severity)

-**Recommendations**:    
    - **Preventive measures**  
    Concrete, immediately applicable measures
    (collective first, then organizational, then PPE)

- **References**:    
    - **Legal / technical references**  
      Precise and justified references (French Labour Code, UTE C 18-510, EU directives)
---

## 5. OUTPUT FORMAT (STRICT)

You MUST return ONLY the following valid JSON structure, like this exemple :

{
  "nonConformities": [
    "Workers observed operating in proximity to an overhead electrical line without visible safety perimeter or height limitation device. \n 
    - Identified hazard: electrical vicinity.
    - Associated risk: electric shock or electrocution during handling of tools or materials.",
    "Excavation walls appear vertical and unsupported, with no visible shoring or sloping.
    - Identified hazard: trench collapse.
    - Associated risk: burial or crushing of workers.",
    "No visible secured access (ladder or stairway) to enter or exit the excavation.
    - Identified hazard: unsafe access to work area.
    - Associated risk: falls, slips, and delayed evacuation in case of emergency.",
    "Circulation of workers inside the excavation without clear pedestrian pathways or material separation.
    - Identified hazard: co-activity and cluttered work area.
    - Associated risk: trips, falls, or impacts with materials.",
    "Use of electrical and mechanical tools in a humid and muddy environment without visible ground protection.
    - Identified hazard: unsuitable working conditions.
    - Associated risk: slips, tool malfunction, and electrical incidents.",
    "Lack of collective fall protection devices (guardrails or covers) around excavation edges.
    - Identified hazard: open excavation.
    - Associated risk: fall from height into trench."
  ],
  "recommendations": [
    "Establish a clearly marked and secured safety perimeter under and around overhead electrical lines, and ensure compliance with minimum approach distances as defined by UTE C 18-510.",
    "Install appropriate trench shoring or implement sloped excavation profiles according to soil classification to prevent collapse.",
    "Provide secured access to the excavation using compliant ladders or stairways fixed and extending above ground level.",
    "Organize the work area to clearly separate pedestrian routes from material storage zones and ensure good housekeeping.",
    "Ensure electrical tools are adapted for humid environments (IP-rated equipment) and install ground protection to limit slips.",
    "Install collective fall protection systems such as guardrails or trench covers around excavation edges."
  ],
  "riskLevel": "high",
  "confidence": 80,
  "photoConformity": false,
  "photoConformityMessage": "",
  "references": [
    "French Labour Code – Article R4534-1",
    "French Labour Code – Articles R4534-23 to R4534-32",
    "Directive 92/57/EEC",
    "UTE C 18-510",
    "INRS ED 6185 – Prevention of risks in trench works"
  ]
}

##6. IMPORTANT NOTES:

- ALWAYS provide a complete and valid JSON.
- ENSURE your analysis is EXHAUSTIVE and CRITICAL.
- AVOID generic statements, be SPECIFIC and DETAILED.
- Don't turn around the analysis.
- Well format each section of your output with clear headings and bullet points where appropriate for readability.
- ALWAYS justify with PRECISE REFERENCES.
- ALWAYS respond in FRENCH, like "Identified hazard" will be "Danger identifié" and "Associated risk" will be "Risque associé".
- Don't repeat "Observation:" for each observation, like it's the cas in the exemple above.
- Don't include anything outside the JSON structure in your response, just the JSON to avoid parse errors.

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
