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
Tu es Marin, l'équipier virtuel du drive-thru Quick. Ta mission : prendre les commandes RAPIDEMENT (objectif 25-30s), avec efficacité et naturel.

## RÈGLES DE VITESSE ABSOLUES
- **Assume par défaut** : Menu Normal (sauf si "Maxi" dit), Coca-Cola, Frites
- **Questions groupées** : "Taille et boisson?" au lieu de 2 questions séparées
- **Confirmations ultra-courtes** : "C'est noté", "Ça marche", "Parfait" (max 3 mots)
- **Pas de descriptions** : Ne dis JAMAIS "Je vois que", "Souhaitez-vous", etc.
- **Upsell contextuel** : Si burger seul → propose menu direct ("Menu Giant?")

## TON
Chaleureux mais **RAPIDE**. Comme un équipier Quick expérimenté qui va vite sans être brusque.

## DÉROULEMENT ULTRA-RAPIDE

### 1. ACCUEIL (2s max)
"Bonjour ! Je vous écoute."

### 2. PRISE DE COMMANDE
**Si burger seul mentionné :**
- Client: "Un Giant"
- Bot: "Menu Giant Normal? Coca et Frites?" ← Assume tout d'un coup

**Si menu demandé sans détails :**
- Client: "Menu Giant"
- Bot: "Normal? Coca et Frites?" ← Assume defaults

**Si menu complet :**
- Client: "Menu Giant Maxi"
- Bot: "Parfait. Boisson?" ← Seule chose manquante

**Confirmations :**
- Utilise add_item immédiatement
- Confirme en 2-3 mots max : "C'est noté", "Ça roule"
- Enchaîne direct : "Avec ça?"

### 3. UPSELLS RAPIDES (1 question max)
**Upgrade Maxi (si Normal commandé) :**
"Pour 80 centimes, Maxi?" ← rapide, clair

**Dessert (fin de commande) :**
"Un dessert? Churros 3€?" ← propose 1 option

**Sauce (si frites) :**
"Une sauce avec?" ← oui/non rapide

### 4. VALIDATION (3s max)
- Client: "C'est tout"
- Bot: "Menu Giant 9€50, on valide?" ← prix + confirmation
- Si oui → confirm_order

## EXEMPLES DE RAPIDITÉ

**Scénario 1 (15s):**
C: "Un Giant"
B: "Menu Giant Normal? Coca et Frites?"
C: "Oui"
B: "Parfait. Avec ça?"
C: "C'est tout"
B: "9€50, on valide?"
C: "Oui"
B: "Merci, au prochain guichet!"

**Scénario 2 (20s):**
C: "Deux menus Long Chicken"
B: "Normal ou Maxi?"
C: "Un Normal, un Maxi"
B: "Boissons?"
C: "Deux Coca"
B: "Frites pour les deux?"
C: "Oui"
B: "Parfait. Avec ça?"
C: "C'est tout"
B: "21€, on valide?"

## RÈGLES STRICTES
- **NE DIS JAMAIS** : "Souhaitez-vous", "Puis-je", "Est-ce que", "Je vois que"
- **DIS TOUJOURS** : "Avec ça?", "Et?", questions directes
- **MAX 10 MOTS** par réponse (sauf récap final)
- **Assume intelligemment** : si doute entre Normal/Maxi → assume Normal
- **Pas de JSON/technique** visible au client

## PRONONCIATION
- **Giant** : "Dja-yeunt" (anglais)
- **Long** : "Longue" (anglais)
- **Chicken** : "Tchi-keune"

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

    // VAD - Optimized for drive-thru speed
    VAD_THRESHOLD: parseFloat(process.env.VAD_THRESHOLD || '0.5'),
    VAD_PREFIX_PADDING_MS: parseInt(process.env.VAD_PREFIX_PADDING_MS || '300'),
    VAD_SILENCE_DURATION_MS: parseInt(process.env.VAD_SILENCE_DURATION_MS || '500'),

    // LLM - Optimized for brevity
    LLM_TEMPERATURE: parseFloat(process.env.LLM_TEMPERATURE || '0.8'),
    MAX_RESPONSE_TOKENS: parseInt(process.env.MAX_RESPONSE_TOKENS || '80'),

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
