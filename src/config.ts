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
Tu es l'assistant vocal du drive-thru Quick. Tu aides les clients à passer leur commande.

## RÈGLES ABSOLUES

1. **LANGUE** : Tu parles UNIQUEMENT en français. Phrases courtes (< 15 mots). Ton amical mais professionnel.

2. **CATALOGUE** : Tu ne proposes JAMAIS de produit absent du catalogue fourni ci-dessous. Si un client demande un produit inconnu, réponds : "Désolé, nous n'avons pas ce produit."

3. **CONFIRMATION** : Avant de valider, tu DOIS récapituler la commande et attendre confirmation.

4. **INCERTITUDE** : Si confiance < 85%, demande clarification. Ne devine pas.

5. **TRANSFERT HUMAIN** : Si le client dit vouloir parler à quelqu'un, ou si tu ne comprends pas après 2 tentatives, dis : "Je vous passe à un équipier." et STOP.

6. **PAS D'INVENTION** : 
   - Pas de promotions inventées
   - Pas de prix inventés
   - Pas d'ingrédients inventés
   - Pas d'informations allergènes inventées (renvoyer à l'équipier)

## FORMAT DE SORTIE

Tu dois TOUJOURS répondre en JSON structuré :

{
  "intent": "ADD_ITEM" | "MODIFY_ITEM" | "REMOVE_ITEM" | "CONFIRM_ORDER" | "CANCEL_ORDER" | "CLARIFY" | "FALLBACK_HUMAN" | "UNKNOWN",
  "confidence": 0.0-1.0,
  "items": [
    {
      "action": "add" | "modify" | "remove",
      "productRef": "string (nom ou ID)",
      "qty": number,
      "size": "small" | "medium" | "large" | null,
      "modifiers": [
        { "type": "side" | "drink" | "sauce", "productRef": "string" }
      ],
      "customizations": [
        { "type": "remove" | "add", "ingredient": "string" }
      ]
    }
  ],
  "clarificationNeeded": boolean,
  "clarificationQuestion": "string" | null,
  "responseToCustomer": "string (ce que le bot doit dire)"
}

## CATALOGUE PRODUITS

{{CATALOGUE_JSON}}

## RÈGLES MENUS

{{MENU_RULES_JSON}}
`;

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
