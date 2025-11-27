// ============================================
// config.ts - Environment Configuration
// ============================================

import dotenv from 'dotenv';
dotenv.config();

interface Config {
  // Server
  PORT: number;
  NODE_ENV: string;

  // Mode
  MODE: 'shadow' | 'live';

  // OpenAI
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_VOICE: string;
  OPENAI_INSTRUCTIONS: string;

  // VAD Settings
  VAD_THRESHOLD: number;
  VAD_PREFIX_PADDING_MS: number;
  VAD_SILENCE_DURATION_MS: number;

  // LLM Settings
  LLM_TEMPERATURE: number;
  MAX_RESPONSE_TOKENS: number;

  // Thresholds
  ASR_CONFIDENCE_THRESHOLD: number;
  INTENT_CONFIDENCE_THRESHOLD: number;

  // Fallback
  MAX_CONSECUTIVE_LOW_CONFIDENCE: number;
  MAX_REPETITIONS: number;
  MAX_SESSION_DURATION_MS: number;

  // Latency
  MAX_E2E_LATENCY_MS: number;
  LATENCY_WARNING_MS: number;
  LATENCY_CRITICAL_MS: number;

  // POS
  POS_API_URL: string;
  POS_API_KEY: string;
  POS_TIMEOUT_MS: number;

  // Monitoring
  METRICS_ENABLED: boolean;
  LOG_LEVEL: string;
}

const DEFAULT_INSTRUCTIONS = `
Tu es Marin, l'équipier virtuel du drive-thru Quick. Ta mission est de prendre les commandes des clients de manière efficace, chaleureuse et naturelle.

## TON ET PERSONNALITÉ
- Tu es **chaleureux, dynamique et souriant** (ça s'entend dans ta voix).
- Tu parles de manière **naturelle et fluide**, comme un vrai humain.
- Tu évites les phrases robotiques. Dis "Avec ceci ?" plutôt que "Souhaitez-vous autre chose ?".
- Tu es **proactif** : propose des menus si le client commande un burger seul.

## DÉROULEMENT DE LA COMMANDE
1. **Accueil** : "Bonjour ! Bienvenue chez Quick. Je vous écoute."
2. **Prise de commande** :
   - Écoute le client.
   - Utilise les outils (add_item, remove_item) pour mettre à jour le panier.
   - Confirme brièvement chaque ajout ("C'est noté", "Ça marche", "Très bon choix").
   - Demande la suite ("Et avec ça ?", "On continue ?").
3. **Validation** :
   - Quand le client a fini ("C'est tout"), utilise l'outil 'get_current_order' pour vérifier.
   - Fais un récapitulatif rapide.
   - Demande validation ("C'est tout bon pour vous ?").
4. **Fin** :
   - Si validé, utilise 'confirm_order'.
   - Dis au revoir ("Merci, avancez au prochain guichet pour le règlement.").

## RÈGLES IMPORTANTES
- Ne parle JAMAIS de JSON ou de technique.
- Si un produit n'existe pas, dis-le simplement ("Désolé, je ne trouve pas ce produit.").
- Si tu ne comprends pas, demande de répéter gentiment.
- Fais des phrases courtes. C'est un drive-thru, ça doit aller vite.
- **ACCUEIL** : Ne décris jamais la situation ("Je vois que vous êtes..."). Dis juste "Bonjour" et demande la commande.

## PRONONCIATION
- **Giant** : Prononce-le TOUJOURS à l'anglaise (/dʒaɪ.ənt/), comme "Dja-yeunt".
- **Long** : Prononce-le TOUJOURS à l'anglaise (/lɒŋ/), comme "Longue" mais avec l'accent.
- **Chicken** : Prononce-le "Tchi-keune".

## CATALOGUE
{{CATALOGUE_JSON}}

## RÈGLES MENUS
{{MENU_RULES_JSON}}
`;

export const TOOLS = [
  {
    type: 'function',
    name: 'add_item',
    description: 'Ajoute un produit ou un menu à la commande',
    parameters: {
      type: 'object',
      properties: {
        productName: { type: 'string', description: 'Nom du produit ou menu (ex: "Giant", "Menu Giant")' },
        quantity: { type: 'number', description: 'Quantité' },
        size: { type: 'string', enum: ['small', 'medium', 'large'], description: 'Taille pour les menus/boissons' },
        modifiers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['side', 'drink', 'sauce'] },
              productName: { type: 'string' }
            }
          }
        }
      },
      required: ['productName', 'quantity']
    }
  },
  {
    type: 'function',
    name: 'remove_item',
    description: 'Retire un produit de la commande',
    parameters: {
      type: 'object',
      properties: {
        productName: { type: 'string', description: 'Nom du produit à retirer' }
      },
      required: ['productName']
    }
  },
  {
    type: 'function',
    name: 'confirm_order',
    description: 'Valide la commande finale et l\'envoie en cuisine',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

function loadConfig(): Config {
  return {
    // Server
    PORT: parseInt(process.env.PORT || '3000'),
    NODE_ENV: process.env.NODE_ENV || 'development',

    // Mode
    MODE: (process.env.MODE as 'shadow' | 'live') || 'shadow',

    // OpenAI
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-realtime-2025-08-28',
    OPENAI_VOICE: process.env.OPENAI_VOICE || 'marin',
    OPENAI_INSTRUCTIONS: process.env.OPENAI_INSTRUCTIONS || DEFAULT_INSTRUCTIONS,

    // VAD - Optimized for drive-thru noise
    VAD_THRESHOLD: parseFloat(process.env.VAD_THRESHOLD || '0.6'),
    VAD_PREFIX_PADDING_MS: parseInt(process.env.VAD_PREFIX_PADDING_MS || '400'),
    VAD_SILENCE_DURATION_MS: parseInt(process.env.VAD_SILENCE_DURATION_MS || '700'),

    // LLM
    LLM_TEMPERATURE: parseFloat(process.env.LLM_TEMPERATURE || '0.6'),
    MAX_RESPONSE_TOKENS: parseInt(process.env.MAX_RESPONSE_TOKENS || '150'),

    // Thresholds
    ASR_CONFIDENCE_THRESHOLD: parseFloat(process.env.ASR_CONFIDENCE_THRESHOLD || '0.88'),
    INTENT_CONFIDENCE_THRESHOLD: parseFloat(process.env.INTENT_CONFIDENCE_THRESHOLD || '0.85'),

    // Fallback
    MAX_CONSECUTIVE_LOW_CONFIDENCE: parseInt(process.env.MAX_CONSECUTIVE_LOW_CONFIDENCE || '2'),
    MAX_REPETITIONS: parseInt(process.env.MAX_REPETITIONS || '3'),
    MAX_SESSION_DURATION_MS: parseInt(process.env.MAX_SESSION_DURATION_MS || '240000'), // 4 min

    // Latency
    MAX_E2E_LATENCY_MS: parseInt(process.env.MAX_E2E_LATENCY_MS || '850'),
    LATENCY_WARNING_MS: parseInt(process.env.LATENCY_WARNING_MS || '1000'),
    LATENCY_CRITICAL_MS: parseInt(process.env.LATENCY_CRITICAL_MS || '1500'),

    // POS
    POS_API_URL: process.env.POS_API_URL || 'http://localhost:8080/api',
    POS_API_KEY: process.env.POS_API_KEY || '',
    POS_TIMEOUT_MS: parseInt(process.env.POS_TIMEOUT_MS || '5000'),

    // Monitoring
    METRICS_ENABLED: process.env.METRICS_ENABLED === 'true',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
  };
}

export const config = loadConfig();
