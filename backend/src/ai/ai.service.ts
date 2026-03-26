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
    unreadableSections: string[];
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
    unreadableSections: string[];
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

  /**
   * Analyze text-only directives (no photo) using LLM to generate a structured CSPS report.
   */
  async analyzeDirectives(userDirectives: string, missionContext?: {
    title?: string;
    client?: string;
    address?: string;
    type?: string;
  }, previousReport?: string): Promise<{
    nonConformities: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: string[];
    unreadableSections: string[];
  }> {
    if (!this.openaiApiKey) {
      throw new BadRequestException('OpenAI API key not configured');
    }

    if (!userDirectives?.trim()) {
      throw new BadRequestException('Directives text is required');
    }

    try {
      const prompt = this.buildDirectivesPrompt();

      const contextInfo = missionContext
        ? `\n\nContexte de la mission :\n- Titre : ${missionContext.title || 'N/A'}\n- Client : ${missionContext.client || 'N/A'}\n- Adresse : ${missionContext.address || 'N/A'}\n- Type : ${missionContext.type || 'N/A'}`
        : '';

      const previousReportText = previousReport?.trim()
        ? `\n\n### RAPPORT PRÉCÉDENT (première génération, à utiliser comme référence pour enrichir et améliorer) :\n${previousReport}`
        : '';

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
              content: `Analysez les directives suivantes du coordonnateur CSPS et produisez un rapport structuré avec les observations, non-conformités potentielles, recommandations et références réglementaires applicables.${contextInfo}${previousReportText}\n\n### Directives du coordonnateur :\n${userDirectives}\n\nToujours fournir la réponse sous format JSON valide.`,
            },
          ],
          max_completion_tokens: 3400,
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
      console.error('Error analyzing directives:', error);
      throw new BadRequestException(`Failed to analyze directives: ${error.message}`);
    }
  }

  async analyzeBatchPhotos(imageUrls: string[], userDirectives?: string, previousReport?: string): Promise<{
    nonConformities: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: string[];
    unreadableSections: string[];
  }> {
    if (!this.openaiApiKey) {
      throw new BadRequestException('OpenAI API key not configured');
    }

    if (!imageUrls || imageUrls.length === 0) {
      throw new BadRequestException('At least one image URL is required');
    }

    try {
      // Download all images as base64
      const imageContents = await Promise.all(
        imageUrls.map(async (url) => {
          const imgBase64 = await this.uploadService.downloadFile(url, '', true);
          return {
            type: 'image_url' as const,
            image_url: {
              url: `data:image/jpeg;base64,${imgBase64.data}`,
            },
          };
        })
      );

      const prompt = this.buildCSPSPrompt();
      const directivesText = userDirectives?.trim()
        ? `\n\n### Directives du coordonnateur :\n${userDirectives}`
        : '';
      const previousReportText = previousReport?.trim()
        ? `\n\n### RAPPORT PRÉCÉDENT (première génération, à utiliser comme référence pour enrichir et améliorer) :\n${previousReport}`
        : '';

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
                  text: `Analysez ces ${imageUrls.length} photos de chantier ensemble selon les normes CSPS. 
                  Produisez UN SEUL rapport unifié qui synthétise les observations, non-conformités, recommandations et références de TOUTES les photos.
                  Identifiez les risques, les non-conformités et fournissez des recommandations ainsi que les références de votre analyse.
                  Toujours fournir la réponse sous format JSON valide.
                  Si une photo n'est pas conforme mettre le flag photoConformity à < false >.${directivesText}${previousReportText}`,
                },
                ...imageContents,
              ],
            },
          ],
          max_completion_tokens: 5000,
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
      console.error('Error analyzing batch photos:', error);
      throw new BadRequestException(`Failed to analyze batch photos: ${error.message}`);
    }
  }

  /**
   * Enhanced batch analysis: re-analyze photos with context from previous analysis
   * and focus on resolving previously identified unreadable sections.
   * This method combines original + detail photos for a comprehensive re-analysis.
   */
  async analyzeBatchEnhanced(
    imageUrls: string[],
    previousAnalysis?: any,
    unreadableSections?: string[],
    userDirectives?: string,
  ): Promise<{
    nonConformities: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: string[];
    unreadableSections: string[];
  }> {
    if (!this.openaiApiKey) {
      throw new BadRequestException('OpenAI API key not configured');
    }

    if (!imageUrls || imageUrls.length === 0) {
      throw new BadRequestException('At least one image URL is required');
    }

    try {
      const imageContents = await Promise.all(
        imageUrls.map(async (url) => {
          const imgBase64 = await this.uploadService.downloadFile(url, '', true);
          return {
            type: 'image_url' as const,
            image_url: {
              url: `data:image/jpeg;base64,${imgBase64.data}`,
            },
          };
        })
      );

      const prompt = this.buildCSPSPrompt();

      const previousAnalysisText = previousAnalysis
        ? `\n\n### ANALYSE PRÉCÉDENTE (à enrichir et affiner) :\n${JSON.stringify(previousAnalysis, null, 2)}`
        : '';

      const unreadableText = unreadableSections && unreadableSections.length > 0
        ? `\n\n### SECTIONS PRÉCÉDEMMENT IDENTIFIÉES COMME ILLISIBLES (à résoudre avec les nouvelles photos de détail) :\n${unreadableSections.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nIMPORTANT : Les nouvelles photos de détail ont été prises SPÉCIFIQUEMENT pour clarifier ces sections. Utilisez-les pour compléter et améliorer le rapport. Si une section illisible est maintenant clairement visible grâce aux nouvelles photos, RETIREZ-la de la liste unreadableSections et INTÉGREZ les informations extraites dans les observations/recommandations.`
        : '';

      const directivesText = userDirectives?.trim()
        ? `\n\n### Directives du coordonnateur :\n${userDirectives}`
        : '';

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
                  text: `ANALYSE ENRICHIE : Vous recevez ${imageUrls.length} photos d'un même groupe de chantier. Certaines sont des photos INITIALES, d'autres sont des photos de DÉTAIL prises pour clarifier des zones floues ou illisibles.

Votre tâche :
1. Analysez TOUTES les photos ensemble pour produire UN SEUL rapport unifié et complet.
2. Utilisez les photos de détail pour RÉSOUDRE les sections précédemment illisibles.
3. FUSIONNEZ les informations de toutes les photos en un rapport cohérent et de haute qualité.
4. Si des sections illisibles ont été clarifiées par les nouvelles photos, intégrez les nouvelles informations et retirez ces sections de unreadableSections.
5. Si certaines sections restent toujours illisibles malgré les nouvelles photos, gardez-les dans unreadableSections.
${previousAnalysisText}${unreadableText}${directivesText}

Toujours fournir la réponse sous format JSON valide.`,
                },
                ...imageContents,
              ],
            },
          ],
          max_completion_tokens: 6000,
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
      console.error('Error analyzing batch enhanced photos:', error);
      throw new BadRequestException(`Failed to analyze enhanced batch photos: ${error.message}`);
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
    unreadableSections: string[];
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
    previousReport: any
  ): Promise<{
    nonConformities: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: string[];
    unreadableSections: string[];
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
    return `Tu es un Exper Senior Coordonnateur SPS (Sécurité et Protection de la Santé) SENIOR avec plus de 20 ans d'expérience terrain.
Tu produis un RAPPORT D'EXPERT — concis, factuel, percutant. Pas un rapport d'observation passif.

## PHILOSOPHIE DU RAPPORT
- Tu es un EXPERT SENIOR, pas un observateur. Tu ne décris pas ce que tu vois — tu ANALYSES, tu SIGNALES les ANOMALIES, tu IDENTIFIES les RISQUES.
- NE JAMAIS mentionner qu'une section est "bien visible", "lisible", "conforme" ou "correctement remplie" sauf si c'est strictement nécessaire pour contraster avec une anomalie adjacente.
- NE PAS détailler le contenu d'un document section par section. Extraire UNIQUEMENT : les lacunes, les imprécisions dangereuses, les informations manquantes obligatoires, et les éléments qui pourraient induire en erreur ou mettre en danger.
- Un expert senior ne perd pas de temps à confirmer ce qui va bien. Il se concentre sur ce qui POSE PROBLÈME.

## RÈGLE DE CONFIANCE (ABSOLUE)
- UNIQUEMENT les constats dont tu es HAUTEMENT CONFIANT (confiance >= 85%) basé sur ce qui est CLAIREMENT visible.
- Si tu n'es pas CERTAIN, NE PAS mentionner. Mieux vaut un rapport court et fiable qu'un rapport long et incertain.
- Pour chaque constat, demande-toi : "Est-ce que je vois clairement ceci ?" — si la réponse n'est pas un OUI catégorique, omets-le.

## CONTENU PARTIELLEMENT VISIBLE
- Si une zone est coupée ou hors cadre : "Zone [X] hors cadre — non évaluée."
- JAMAIS fabriquer ou supposer ce qui est derrière une obstruction.

## ANALYSE DE DOCUMENTS (PLANS, PGC, PPSPS, DICT, VGP, ETC.)
- Ne JAMAIS dire "c'est une photo d'un document" ou "le document photographié". Tu lis directement le document.
- NE PAS résumer le contenu du document de manière exhaustive. L'expert senior va DROIT AUX PROBLÈMES :

  1. **Type et rôle** : Identifie le type de document en une phrase (ex: "PGC phase conception — coordination des mesures de prévention inter-entreprises").
  2. **ANOMALIES ET LACUNES** (l'essentiel du rapport) :
     - Informations OBLIGATOIRES absentes (avec référence réglementaire)
     - Imprécisions qui peuvent induire en erreur ou créer un danger
     - Prescriptions vagues qui ne permettent pas une application concrète
     - Incohérences entre sections
     - Informations qui pourraient désorganiser les opérations
  3. **NE PAS lister** ce qui est bien rempli, bien visible, ou conforme — sauf si c'est indispensable pour contextualiser une anomalie.

## SECTIONS ILLISIBLES — DISTINCTION CRITIQUE

**TROIS CAS à distinguer :**

**TYPE A — PHOTO FLOUE / MAL CADRÉE (→ reprendre la photo)** :
- La section est illisible PARCE QUE la photo est floue, bougée, trop éloignée, mal cadrée.
- Une meilleure photo résoudrait le problème.
- → Lister dans "unreadableSections" pour demander une reprise.

**TYPE B — DOCUMENT CACHÉ PAR UN OBJET (→ ANOMALIE, pas un flou)** :
- Une section est masquée par un scotch, agrafe, autre document posé dessus, main, objet.
- C'est une ANOMALIE à signaler dans les observations : "Section [X] masquée par [cause] — information inaccessible. Anomalie : le document doit être présenté intégralement lisible."
- → NE PAS mettre dans "unreadableSections".

**TYPE C — DOCUMENT REMPLI EN DÉSORDRE / RATURÉ / ILLISIBLE (→ ANOMALIE + extraire le lisible)** :
- La section est remplie de manière désordonnée, avec des ratures, une écriture illisible, des rayures.
- Reprendre la photo ne changera rien car le problème vient du document.
- → Extraire ce qui EST lisible et pertinent.
- → Signaler dans les observations : "Section [X] remplie de manière désordonnée / raturée — partiellement exploitable. Éléments lisibles : [citer]. Anomalie : remplissage non conforme aux bonnes pratiques documentaires."
- → NE PAS mettre dans "unreadableSections".

**Résumé — RÈGLE UNIVERSELLE :**
Pour TOUT élément (document, EPI, signalisation, balisage, affichage, équipement...) :
- Problème vient de la PHOTO (flou, distance, angle, cadrage)
  → "unreadableSections" : "[Élément] — non confirmé visuellement. Reprendre la photo."
- Élément MASQUÉ par un objet/personne (problème du terrain, pas de la photo)
  → ANOMALIE dans nonConformities.
- Élément CLAIREMENT ABSENT ou non-conforme
  → ANOMALIE dans nonConformities.
- Élément hors cadre
  → "unreadableSections" : "[Élément / Zone] hors cadre — non évaluable."
- Si tout est visible et évaluable : "unreadableSections": []

## PHOTO FLOUE DE DOCUMENT
- Effectue un OCR : extrais TOUT le texte lisible, même partiellement.
- Analyse le texte extrait en expert CSPS senior — ne refuse JAMAIS l'analyse.
- Ajuste la confiance selon la lisibilité (50-70 pour un doc partiellement lisible).

## PHOTO FLOUE PAS UN DOCUMENT
- → Lister dans "unreadableSections" pour demander une reprise.

## VOCABULAIRE TECHNIQUE OBLIGATOIRE
- "barriérage rigide type Heras/K2" (pas "barrière")
- "panneau AK5", "panneau BK" (pas "signalisation")
- "rubalise (non conforme)" si visible
- "double chaînette" si zone électrique
- Si élément non confirmé : "type non lisible / non confirmé"

## RÈGLES DE RÉDACTION
- Langue : FRANÇAIS uniquement.
- Ne pas mentionner le nom du MOA, la localisation spécifique, ni les durées.
- TON PROFESSIONNEL : rapport d'expert senior CSPS officiel. Terminologie réglementaire précise.
- CONCISION : maximum 4-5 observations, 3-4 recommandations, 3 références.

## FORMAT DE SORTIE (JSON STRICT)
Retourner UNIQUEMENT un objet JSON valide (pas de texte autour).

- Dans les chaînes, utiliser \\n (JSON-safe).
- Description brève du chantier : UNIQUEMENT dans nonConformities[0], puis \\n\\n.

RÈGLE TABLEAUX :
- recommendations : un tableau où CHAQUE élément = UNE mesure (pas de multi-mesure, pas de \\n).
- references : un tableau où CHAQUE élément = UN texte réglementaire.

{
  "nonConformities": [
    "[Description brève du chantier ou document (1-2 phrases)]\\\\n\\\\n[Anomalie 1]\\\\nDanger : ...\\\\nRisque : ...",
    "[Anomalie X]\\\\nDanger : ...\\\\nRisque : ..."
  ],
  "recommendations": [
    "action concrète, immédiatement applicable",
    "..."
  ],
  "riskLevel": "high",
  "confidence": 90,
  "photoConformity": false,
  "references": [
    "Code du travail - Articles R4321-4 et R4323-95.",
    "Norme NF C 18-510."
  ],
  "unreadableSections": [
    "Section [nom] — [raison liée à la qualité photo UNIQUEMENT]."
  ]
}

## TEXTES DE RÉFÉRENCE (UTILISER UNIQUEMENT CEUX-CI)
- EPI: Code du travail - Articles R4321-4 et R4323-95.
- Travail en Hauteur: Code du travail - Articles R4323-58 à R4323-71 et R4323-63.
- Terrassement / Fouilles: Code du travail - Article R4534-24 et R4534-22.
- Signalisation Routière: Arrêté du 24 novembre 1967 et IISR - 8ème partie.
- Risque Électrique: Norme NF C 18-510 et Code du travail - Articles R4544-1 à R4544-11.
- Engins / coactivité engins-piétons : Code du travail - Articles R4323-51 et R4323-52.
- Circulation véhicules sur chantier : Code du travail - Article R4534-10.
- Documents de chantier (PGC, PPSPS, registre journal) : Code du travail - Articles R4532-1 à R4532-98.
- Affichage obligatoire : Code du travail - Articles R4534-1 et suivants.

## INSTRUCTIONS FINALES
- Description brève : UNE SEULE FOIS dans nonConformities[0].
- PRIORITÉ (si personnel visible) : vérification EPI d'abord (casque), puis engins/coactivité, puis terrassement/signalisation.
- PARTIELLEMENT VISIBLE : "partiellement visible — conformité non confirmée".
- DOCUMENTS : aller droit aux anomalies et lacunes. Ne pas confirmer ce qui est bien.
- Sortie : UNIQUEMENT le JSON brut.
`;
  }

  private buildDirectivesPrompt(): string {
    return `You are an Expert Safety and Health Protection Coordinator (CSPS / SPS) with 20+ years of field experience.
Your task is to analyze TEXT-BASED DIRECTIVES from a CSPS coordinator (without any photo) and produce a structured, professional safety report.

CONTEXT: The coordinator has written observations, instructions, or directives about a construction site visit. You must analyze these directives and produce a structured report with:
- Observations based on the directives
- Actionable recommendations based on the directives
- Applicable regulatory references
- Risk level assessment

RULES:
- Language: All output text must be in FRENCH.
- PROFESSIONAL TONE: Write as a senior CSPS expert producing an official inspection report. Use precise regulatory terminology.
- Be concise: maximum 4-5 observations, 3-4 recommendations, 3 references.
- Only include information that is clearly stated or strongly implied by the directives.
- Do NOT invent or assume risks not mentioned in the directives.
- If the directives mention a document (PGC, PPSPS, DICT, VGP, etc.), analyze ONLY what is explicitly described. Note any mandatory elements that the coordinator did not mention as "non mentionné dans les directives — à vérifier."
- If the directives are vague or incomplete about certain aspects, DO NOT fill in the gaps with assumptions. Instead note: "Information insuffisante pour évaluer [aspect] — précision nécessaire."
- Set confidence based on how specific and clear the directives are.
- photoConformity should always be true (no photo to evaluate).
- Use the SAME format as photo-based reports: observations, recommendations, references.
- Each observation must be factual and traceable to the coordinator's directives.

OUTPUT FORMAT (STRICT JSON):
Return ONLY a valid JSON object:

{
  "nonConformities": [],
  "observations": [
    "[Description claire de ce qui a été constaté ou signalé par le coordonnateur (1-2 phrases)]\\\\n\\\\n[Anomalie 1]\\\\nDanger : ...\\\\nRisque : ...",
    "[Anomalie X]\\\\nDanger : ...\\\\nRisque : ..."
  ],
  "recommendations": [
    "action concrète, immédiatement applicable.",
    "..."
  ],
  "riskLevel": "faible|moyen|eleve",
  "confidence": 85,
  "photoConformity": true,
  "photoConformityMessage": "",
  "references": [
    "Code du travail - Articles ...",
    "Norme NF C 18-510."
  ]
}

REFERENCE TEXTS (USE ONLY THESE):
- EPI: Code du travail - Articles R4321-4 et R4323-95.
- Travail en Hauteur: Code du travail - Articles R4323-58 à R4323-71 et R4323-63.
- Terrassement / Fouilles: Code du travail - Article R4534-24 et R4534-22.
- Signalisation Routière: Arrêté du 24 novembre 1967 et IISR - 8ème partie.
- Risque Électrique: Norme NF C 18-510 et Code du travail - Articles R4544-1 à R4544-11.
- Engins / coactivité engins-piétons : Code du travail - Articles R4323-51 et R4323-52.
- Circulation véhicules sur chantier : Code du travail - Article R4534-10.
- Documents de chantier (PGC, PPSPS, registre journal) : Code du travail - Articles R4532-1 à R4532-98.

## INSTRUCTIONS FINALES
- Description brève : UNE SEULE FOIS dans nonConformities[0].
- PRIORITÉ (si personnel indiqué) : vérification EPI d'abord (casque), puis engins/coactivité, puis terrassement/signalisation.
- Sortie : UNIQUEMENT le JSON brut.

Output: ONLY the raw JSON object.
`;
  }

  private parseAIResponse(content: string): {
    nonConformities: string[];
    observations: string[];
    recommendations: string[];
    riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number;
    photoConformity: boolean;
    photoConformityMessage: string | any;
    references: any;
    unreadableSections: string[];
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
        observations: Array.isArray(parsed.observations) ? parsed.observations : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        riskLevel: ['faible', 'moyen', 'eleve'].includes(parsed.riskLevel)
          ? parsed.riskLevel
          : 'moyen',
        confidence: parsed.confidence,
        photoConformity: parsed.photoConformity || true,
        photoConformityMessage: parsed.photoConformityMessage || "",
        references: parsed.references || [],
        unreadableSections: Array.isArray(parsed.unreadableSections) ? parsed.unreadableSections : [],
        content: content
      };
    } catch (error) {
      console.error('Error parsing AI response:', error);
      throw new BadRequestException(`Failed to parse AI response
        ${content} `);
    }
  }
}
