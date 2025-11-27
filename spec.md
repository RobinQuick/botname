# SPECIFICATION VOICEBOT DRIVE-THRU QSR — V2 COMPLETE

> Version enrichie avec toutes les sections manquantes pour un déploiement production-grade.

---

## 0. CONTEXTE BUSINESS & ENVIRONNEMENT

### 0.1 Business

- **Marque** : Quick-style QSR (burgers, menus, accompagnements, boissons, desserts)
- **Environnement** : Voie drive-thru, bruyant (moteurs, vent, passagers, enfants, motos, camions)
- **Utilisateurs** : Clients en voiture + équipiers en cuisine/caisse

### 0.2 Contraintes non négociables

| Contrainte | Règle |
|------------|-------|
| Validité POS | Les commandes doivent être 100% valides (pas d'incohérence de combo) |
| Confirmation | Le client doit voir ET/OU entendre une confirmation claire avant finalisation |
| Pas d'hallucination | Le système ne propose JAMAIS de produits non existants ou combos invalides |
| Fallback immédiat | En cas de doute, transfert humain immédiat — ne pas insister |
| Latence | Réponse vocale < 800ms après fin de parole client |

### 0.3 POS Integration

- POS type Mérim, accès via HTTP API
- Couche d'abstraction interne : `POS_API`
  - `POS_API.getProducts()` → catalogue produits + prix + règles combos
  - `POS_API.createOrder(orderPayload)` → crée commande, retourne `orderId` + status
  - `POS_API.checkAvailability(productIds[])` → vérification temps réel 86'd
  - `POS_API.cancelOrder(orderId)` → annulation si erreur post-validation

---

## 1. ARCHITECTURE GLOBALE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DRIVE-THRU LANE                                │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   MIC    │───▶│   VAD    │───▶│ NOISE CANCEL │───▶│ AUDIO STREAMER   │  │
│  │ + SPEAKER│◀───│          │    │              │    │ (WebSocket)      │  │
│  └──────────┘    └──────────┘    └──────────────┘    └────────┬─────────┘  │
│                                                                │            │
│  ┌──────────────────────┐                                      │            │
│  │  ORDER DISPLAY SCREEN │◀────────────────────────────────────┼──────┐     │
│  │  (confirmation visuelle)│                                   │      │     │
│  └──────────────────────┘                                      │      │     │
└────────────────────────────────────────────────────────────────┼──────┼─────┘
                                                                 │      │
                    ┌────────────────────────────────────────────┼──────┼─────┐
                    │                   BACKEND                  │      │     │
                    │  ┌─────────────────────────────────────────▼──┐   │     │
                    │  │           WEBSOCKET SERVER                 │   │     │
                    │  │  - Receives audio chunks                   │   │     │
                    │  │  - Routes to ASR                           │   │     │
                    │  │  - Sends BOT_SPEAK / ORDER_UPDATE / FALLBACK│  │     │
                    │  └─────────────────┬──────────────────────────┘   │     │
                    │                    │                              │     │
                    │  ┌─────────────────▼──────────────────────────┐   │     │
                    │  │              ASR ENGINE                    │   │     │
                    │  │  Primary: OpenAI Realtime API              │   │     │
                    │  │  Fallback: Whisper local / Deepgram        │   │     │
                    │  │  Outputs: transcript + confidence + timing │   │     │
                    │  └─────────────────┬──────────────────────────┘   │     │
                    │                    │                              │     │
                    │  ┌─────────────────▼──────────────────────────┐   │     │
                    │  │         DIALOG STATE MACHINE               │   │     │
                    │  │  States: GREETING → TAKING_ORDER →         │   │     │
                    │  │          CLARIFYING → CONFIRMING →         │   │     │
                    │  │          VALIDATED → SENT_TO_POS           │   │     │
                    │  └─────────────────┬──────────────────────────┘   │     │
                    │                    │                              │     │
                    │  ┌─────────────────▼──────────────────────────┐   │     │
                    │  │           NLU + LLM AGENT                  │   │     │
                    │  │  - Intent extraction                       │   │     │
                    │  │  - Slot filling                            │   │     │
                    │  │  - Response generation                     │   │     │
                    │  │  - CONSTRAINED by catalogue                │   │     │
                    │  └─────────────────┬──────────────────────────┘   │     │
                    │                    │                              │     │
                    │  ┌─────────────────▼──────────────────────────┐   │     │
                    │  │           ORDER ENGINE                     │───┼─────┘
                    │  │  - Pure functions                          │   │
                    │  │  - Catalogue validation                    │   │
                    │  │  - Combo rules enforcement                 │   │
                    │  │  - Price calculation                       │   │
                    │  └─────────────────┬──────────────────────────┘
                    │                    │
                    │  ┌─────────────────▼──────────────────────────┐
                    │  │           POS ADAPTER                      │
                    │  │  - Translate Order → POS payload           │
                    │  │  - Handle POS errors                       │
                    │  │  - Retry logic                             │
                    │  └─────────────────┬──────────────────────────┘
                    │                    │
                    │  ┌─────────────────▼──────────────────────────┐
                    │  │       CREW INTERFACE (WebApp)              │
                    │  │  - Live transcript view                    │
                    │  │  - Partial order display                   │
                    │  │  - "Take over" button                      │
                    │  │  - Conversation history                    │
                    │  └────────────────────────────────────────────┘
                    │                                                         
                    │  ┌────────────────────────────────────────────┐
                    │  │       MONITORING & LOGGING                 │
                    │  │  - All interactions logged                 │
                    │  │  - Metrics dashboard                       │
                    │  │  - Shadow mode comparison                  │
                    │  └────────────────────────────────────────────┘
                    └─────────────────────────────────────────────────────────┘
```

---

## 2. COMPOSANTS DÉTAILLÉS

### 2.1 Audio Frontend & VAD

#### Voice Activity Detection (VAD)

```typescript
interface VADConfig {
  // Seuils de détection
  energyThreshold: number;        // dB minimum pour considérer comme parole
  silenceDuration: number;        // ms de silence avant fin d'utterance (default: 700ms)
  minSpeechDuration: number;      // ms minimum pour valider une utterance (default: 300ms)
  
  // Anti-echo (le speaker du bot ne doit pas trigger le VAD)
  echoSuppressionEnabled: boolean;
  echoSuppressionDelayMs: number; // temps après TTS où on ignore l'input
  
  // Multi-speaker detection
  speakerChangeDetection: boolean;
}

interface VADEvents {
  onSpeechStart: () => void;
  onSpeechEnd: (audioBuffer: Float32Array, durationMs: number) => void;
  onSpeakerChange: () => void;  // Détection changement de voix (passager vs conducteur)
}
```

#### Noise Reduction spécifique drive-thru

```typescript
interface NoiseProfile {
  // Profils de bruit pré-entraînés
  carEngineIdle: NoiseSignature;
  carEngineRevving: NoiseSignature;
  dieselTruck: NoiseSignature;
  motorcycle: NoiseSignature;
  wind: NoiseSignature;
  rain: NoiseSignature;
  otherVoices: NoiseSignature;  // passagers, enfants
}

interface NoiseReductionConfig {
  enabled: boolean;
  aggressiveness: 1 | 2 | 3;     // 1 = léger, 3 = agressif (risque de dégrader la voix)
  adaptiveMode: boolean;         // s'adapte au bruit ambiant en temps réel
  profiles: NoiseProfile[];
}
```

### 2.2 ASR Engine — OpenAI Realtime API

#### Pourquoi OpenAI Realtime API ?

L'API Realtime d'OpenAI est un modèle speech-to-speech natif. Contrairement aux pipelines traditionnels qui chaînent ASR → LLM → TTS, l'API Realtime traite et génère l'audio directement via un seul modèle. Cela réduit la latence, préserve les nuances de la parole, et produit des réponses plus naturelles et expressives.

**Avantages clés pour le drive-thru :**
- Latence time-to-first-byte ~500ms (US), ~600ms (Europe)
- Gestion native des interruptions
- Semantic VAD qui comprend quand l'utilisateur a fini de parler basé sur le sens, pas juste le silence
- Function calling intégré pour piloter l'Order Engine

#### Modèle recommandé

```typescript
// Modèle production-ready (Août 2025+)
const OPENAI_MODEL = "gpt-realtime-2025-08-28";

// Alternative pour réduire les coûts (légère baisse de qualité)
const OPENAI_MODEL_BUDGET = "gpt-realtime-mini-2025-08-28";
```

Le modèle `gpt-realtime` est le plus avancé et production-ready. Il montre des améliorations dans :
- Le suivi d'instructions complexes
- L'appel d'outils (function calling) avec précision
- La production d'une parole plus naturelle et expressive
- La compréhension des indices non-verbaux (rires, hésitations)
- Le switch de langue mid-sentence

#### Configuration Session Complète

```typescript
// ============================================
// OPENAI REALTIME API - SESSION CONFIG
// Optimisé pour environnement drive-thru bruyant
// ============================================

interface OpenAIRealtimeSessionConfig {
  model: string;
  voice: string;
  instructions: string;
  turn_detection: TurnDetectionConfig;
  input_audio_transcription: TranscriptionConfig;
  input_audio_format: AudioFormat;
  output_audio_format: AudioFormat;
  temperature: number;
  tools: Tool[];
  tool_choice: "auto" | "none" | "required";
  max_response_output_tokens: number | "inf";
}

interface TurnDetectionConfig {
  type: "server_vad" | "semantic_vad";
  threshold: number;           // 0.0 - 1.0, sensibilité VAD
  prefix_padding_ms: number;   // Audio conservé avant détection de parole
  silence_duration_ms: number; // Silence avant fin de turn
  create_response: boolean;    // Auto-génère une réponse à la fin du turn
}

interface TranscriptionConfig {
  model: "whisper-1";
}

type AudioFormat = "pcm16" | "g711_ulaw" | "g711_alaw";

// ============================================
// CONFIGURATION DRIVE-THRU OPTIMISÉE
// ============================================

const OPENAI_SESSION_CONFIG: OpenAIRealtimeSessionConfig = {
  
  // Modèle
  model: "gpt-realtime-2025-08-28",
  
  // Voix - "marin" ou "cedar" sont les plus naturelles (2025)
  // Tester les deux sur les haut-parleurs drive-thru pour choisir
  voice: "marin",
  
  // ============================================
  // VAD - OPTIMISÉ POUR DRIVE-THRU BRUYANT
  // ============================================
  // 
  // semantic_vad > server_vad pour le drive-thru car :
  // - Comprend quand l'utilisateur a FINI de parler basé sur le SENS
  // - Pas juste basé sur le silence (problématique avec bruit moteur)
  // - Gère mieux les hésitations "euh... et aussi..."
  //
  turn_detection: {
    type: "semantic_vad",
    
    // Threshold plus élevé (0.6 vs 0.5 default) pour filtrer bruit ambiant
    // - Moteurs de voiture
    // - Vent
    // - Autres voitures dans la file
    threshold: 0.6,
    
    // Padding avant la parole détectée
    // 400ms pour capturer le début même si le client commence doucement
    prefix_padding_ms: 400,
    
    // Durée de silence avant de considérer le turn terminé
    // 700ms est un bon compromis :
    // - Assez long pour ne pas couper les hésitations naturelles
    // - Assez court pour garder la conversation fluide
    // - Laisse ~100-150ms de marge pour atteindre 850ms E2E
    silence_duration_ms: 700,
    
    // Auto-génère la réponse quand le turn est détecté comme terminé
    create_response: true
  },
  
  // Transcription pour logs, debug, et affichage équipier
  input_audio_transcription: {
    model: "whisper-1"
  },
  
  // Format audio
  // pcm16 = meilleure qualité, recommandé si bande passante OK
  // g711_ulaw = compatible téléphonie, plus compressé
  input_audio_format: "pcm16",
  output_audio_format: "pcm16",
  
  // Température basse pour consistance et prévisibilité
  // 0.6 = assez de variation pour paraître naturel
  // mais assez bas pour éviter les réponses erratiques
  temperature: 0.6,
  
  // Limite de tokens de sortie
  // En drive-thru, les réponses doivent être COURTES
  // 150 tokens ≈ 20-30 secondes de parole max
  max_response_output_tokens: 150,
  
  // Tools pour piloter l'Order Engine
  tools: [
    {
      type: "function",
      name: "add_item_to_order",
      description: "Ajoute un produit à la commande en cours. Utiliser quand le client demande un produit.",
      parameters: {
        type: "object",
        properties: {
          product_id: { 
            type: "string",
            description: "ID du produit dans le catalogue"
          },
          product_name: {
            type: "string", 
            description: "Nom du produit tel que compris"
          },
          quantity: { 
            type: "integer",
            description: "Quantité demandée (1-10)",
            minimum: 1,
            maximum: 10
          },
          size: {
            type: "string",
            enum: ["small", "medium", "large"],
            description: "Taille si applicable"
          },
          modifiers: { 
            type: "array",
            description: "Accompagnements et boissons pour les menus",
            items: { 
              type: "object",
              properties: {
                type: { type: "string", enum: ["side", "drink", "sauce", "dessert"] },
                product_id: { type: "string" },
                product_name: { type: "string" }
              },
              required: ["type"]
            }
          }
        },
        required: ["product_name", "quantity"]
      }
    },
    {
      type: "function",
      name: "modify_item_in_order",
      description: "Modifie un item existant dans la commande (changer accompagnement, boisson, etc.)",
      parameters: {
        type: "object",
        properties: {
          item_index: {
            type: "integer",
            description: "Index de l'item à modifier (0-based)"
          },
          modification_type: {
            type: "string",
            enum: ["change_side", "change_drink", "change_size", "add_sauce", "remove_ingredient"]
          },
          new_value: {
            type: "string",
            description: "Nouvelle valeur pour la modification"
          }
        },
        required: ["item_index", "modification_type", "new_value"]
      }
    },
    {
      type: "function",
      name: "remove_item_from_order",
      description: "Supprime un item de la commande",
      parameters: {
        type: "object",
        properties: {
          item_index: {
            type: "integer",
            description: "Index de l'item à supprimer"
          },
          product_name: {
            type: "string",
            description: "Nom du produit à supprimer (si index inconnu)"
          }
        }
      }
    },
    {
      type: "function",
      name: "get_current_order",
      description: "Récupère l'état actuel de la commande pour récapitulatif",
      parameters: {
        type: "object",
        properties: {}
      }
    },
    {
      type: "function",
      name: "confirm_order",
      description: "Confirme la commande et l'envoie au POS. Utiliser UNIQUEMENT après confirmation explicite du client.",
      parameters: {
        type: "object",
        properties: {
          confirmed_by_customer: {
            type: "boolean",
            description: "Le client a-t-il explicitement confirmé ?"
          }
        },
        required: ["confirmed_by_customer"]
      }
    },
    {
      type: "function",
      name: "cancel_order",
      description: "Annule complètement la commande en cours",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Raison de l'annulation"
          }
        }
      }
    },
    {
      type: "function",
      name: "transfer_to_human",
      description: "Transfère immédiatement la conversation à un équipier. Utiliser si: le client le demande, incompréhension répétée, ou situation complexe.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            enum: [
              "customer_request",
              "repeated_misunderstanding",
              "complex_request",
              "allergen_query",
              "complaint",
              "payment_issue",
              "technical_error"
            ]
          },
          context: {
            type: "string",
            description: "Contexte à transmettre à l'équipier"
          }
        },
        required: ["reason"]
      }
    },
    {
      type: "function",
      name: "check_product_availability",
      description: "Vérifie si un produit est disponible (pas 86'd)",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string" },
          product_name: { type: "string" }
        }
      }
    }
  ],
  
  // Le modèle choisit automatiquement quand utiliser les tools
  tool_choice: "auto",
  
  // ============================================
  // SYSTEM INSTRUCTIONS
  // ============================================
  instructions: `
Tu es l'assistant vocal du drive-thru Quick. Tu aides les clients à passer leur commande.

## RÈGLES DE COMMUNICATION

1. **LANGUE** : Français uniquement. Phrases courtes (< 15 mots). Ton amical et professionnel.

2. **VITESSE** : Parle de manière claire et légèrement rapide. Pas de pauses inutiles.

3. **STYLE** : 
   - Utilise "Je vous écoute" plutôt que "Comment puis-je vous aider"
   - Dis "C'est noté" après chaque ajout
   - Dis "Autre chose ?" pour continuer
   - Dis "Je récapitule..." avant la confirmation finale

## RÈGLES MÉTIER ABSOLUES

1. **CATALOGUE** : Tu ne proposes JAMAIS de produit absent du catalogue. Si un client demande un produit inconnu : "Désolé, nous n'avons pas ce produit."

2. **PRIX** : Ne jamais inventer de prix. Utilise get_current_order pour le total.

3. **PROMOTIONS** : Ne jamais inventer de promotion ou réduction.

4. **ALLERGÈNES** : Si question sur allergènes → transfer_to_human immédiat avec reason="allergen_query".

5. **CONFIRMATION** : TOUJOURS récapituler et attendre "oui" explicite avant confirm_order.

## GESTION DES ERREURS

- Si tu ne comprends pas après 2 tentatives → transfer_to_human
- Si le client dit "je veux parler à quelqu'un" → transfer_to_human immédiat
- Si le client semble frustré → transfer_to_human

## FLOW STANDARD

1. Accueil : "Bienvenue chez Quick, je vous écoute !"
2. Prise de commande : add_item_to_order pour chaque produit
3. Après chaque ajout : "C'est noté. Autre chose ?"
4. Quand client dit "c'est tout" : get_current_order puis récapituler
5. Attendre confirmation explicite
6. confirm_order uniquement si "oui" / "c'est bon" / "parfait"

## CATALOGUE PRODUITS

{{CATALOGUE_JSON}}

## RÈGLES MENUS

{{MENU_RULES_JSON}}
`
};

// ============================================
// CONFIGURATION ALTERNATIVE : VAD DÉSACTIVÉ
// Pour contrôle manuel des turns (push-to-talk)
// ============================================

const OPENAI_SESSION_CONFIG_MANUAL_VAD: Partial<OpenAIRealtimeSessionConfig> = {
  turn_detection: {
    type: "server_vad",
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 200,
    create_response: false  // Ne pas auto-répondre, attendre signal explicite
  }
};

// ============================================
// CONFIGURATION ENVIRONNEMENT TRÈS BRUYANT
// (autoroute, zone industrielle)
// ============================================

const OPENAI_SESSION_CONFIG_HIGH_NOISE: Partial<OpenAIRealtimeSessionConfig> = {
  turn_detection: {
    type: "semantic_vad",
    threshold: 0.75,           // Plus strict
    prefix_padding_ms: 500,    // Plus de buffer
    silence_duration_ms: 900,  // Plus de tolérance
    create_response: true
  }
};
```

#### Voix disponibles et recommandations

```typescript
// Voix recommandées pour drive-thru français (2025)
// Testées pour clarté sur haut-parleurs extérieurs

type OpenAIVoice = 
  | "marin"    // ⭐ RECOMMANDÉ - Voix féminine, claire, naturelle
  | "cedar"    // ⭐ RECOMMANDÉ - Voix masculine, professionnelle
  | "alloy"    // Neutre, bon fallback
  | "echo"     // Masculine, chaleureuse
  | "shimmer"  // Féminine, expressive
  | "sage"     // Neutre, calme
  | "verse"    // Masculine, dynamique
  | "breeze";  // Féminine, douce

// ATTENTION: Ces voix NE SONT PAS supportées par les modèles realtime :
// ash, ballad, coral, fable, onyx, nova

const VOICE_RECOMMENDATIONS = {
  // Pour haut-parleurs drive-thru standard
  standard: "marin",
  
  // Pour environnement très bruyant (autoroute)
  highNoise: "cedar",  // Voix plus grave, passe mieux
  
  // Pour clientèle jeune / casual
  casual: "verse",
  
  // Pour test A/B
  testVariants: ["marin", "cedar", "alloy"]
};
```

#### Latence cible et monitoring

```typescript
// ============================================
// LATENCE TARGETS
// ============================================

interface LatencyTargets {
  // Time-to-first-byte depuis OpenAI
  // ~500ms US, ~600ms Europe
  ttfb: {
    target: number;
    warning: number;
    critical: number;
  };
  
  // Latence end-to-end (fin de parole client → début réponse bot)
  e2e: {
    target: number;
    warning: number;
    critical: number;
  };
}

const LATENCY_TARGETS: LatencyTargets = {
  ttfb: {
    target: 600,    // ms - cible pour Europe
    warning: 800,   // ms - acceptable mais à surveiller
    critical: 1200  // ms - déclenche alerte
  },
  e2e: {
    target: 850,    // ms - cible réaliste pour drive-thru EU
    warning: 1000,  // ms - conversation reste fluide
    critical: 1500  // ms - expérience dégradée
  }
};

// ============================================
// MESURE DE LATENCE
// ============================================

interface LatencyMeasurement {
  sessionId: string;
  turnId: string;
  timestamps: {
    userSpeechEnd: number;      // Fin de parole détectée
    apiRequestSent: number;     // Requête envoyée à OpenAI
    ttfbReceived: number;       // Premier byte audio reçu
    audioPlaybackStart: number; // Audio commence à jouer
  };
  computed: {
    ttfb: number;               // ttfbReceived - apiRequestSent
    e2e: number;                // audioPlaybackStart - userSpeechEnd
    networkLatency: number;     // Estimation latence réseau
  };
}

function measureLatency(timestamps: LatencyMeasurement['timestamps']): LatencyMeasurement['computed'] {
  return {
    ttfb: timestamps.ttfbReceived - timestamps.apiRequestSent,
    e2e: timestamps.audioPlaybackStart - timestamps.userSpeechEnd,
    networkLatency: (timestamps.ttfbReceived - timestamps.apiRequestSent) - 500 // Baseline OpenAI ~500ms
  };
}
```

#### Gestion des interruptions

```typescript
// ============================================
// INTERRUPTION HANDLING
// ============================================

// L'API Realtime gère automatiquement les interruptions.
// Quand le client parle pendant que le bot parle :
// 1. L'API détecte l'interruption
// 2. Elle arrête la génération audio en cours
// 3. Elle traite la nouvelle entrée du client

// Côté client, il faut :

interface InterruptionHandler {
  // Appelé quand une interruption est détectée
  onInterruption: () => void;
  
  // Appelé pour arrêter immédiatement le playback TTS
  stopPlayback: () => void;
  
  // Appelé pour vider le buffer audio en attente
  flushAudioBuffer: () => void;
}

const handleInterruption: InterruptionHandler = {
  onInterruption: () => {
    console.log("[INTERRUPT] Customer started speaking, stopping bot audio");
  },
  
  stopPlayback: () => {
    // Arrêter immédiatement le Web Audio / speaker
    audioContext.suspend();
    audioQueue.clear();
  },
  
  flushAudioBuffer: () => {
    // Vider tout audio en attente de lecture
    pendingAudioChunks = [];
  }
};

// Événements WebSocket à écouter pour les interruptions
const INTERRUPTION_EVENTS = [
  "input_audio_buffer.speech_started",  // Client commence à parler
  "response.cancelled",                  // Réponse annulée (interruption)
  "conversation.item.truncated"          // Item tronqué suite à interruption
];
```

#### Limites connues et workarounds

```typescript
// ============================================
// LIMITES CONNUES DE L'API REALTIME
// ============================================

const KNOWN_LIMITATIONS = {
  
  // 1. Latence augmente après 5 minutes
  // La latence passe de ~500ms à ~5-6 secondes après 5 min
  longSessionLatency: {
    threshold: 4 * 60 * 1000, // 4 minutes
    action: "reset_session",
    description: "Reset la session avant 5 min pour éviter dégradation latence"
  },
  
  // 2. Pas de support multilingue simultané parfait
  // Le switch mid-sentence fonctionne mais peut être instable
  multilingualSupport: {
    supported: true,
    reliability: "medium",
    recommendation: "Stick to single language per session when possible"
  },
  
  // 3. Structured outputs limités
  // Le modèle peut ne pas toujours respecter le format JSON exact
  structuredOutputs: {
    reliability: "high_with_tools", // Meilleur via function calling
    recommendation: "Use tools instead of asking for JSON in speech"
  },
  
  // 4. Rate limits
  rateLimits: {
    concurrentSessions: "unlimited", // Plus de limite depuis Feb 2025
    tokensPerMinute: "varies_by_tier",
    mediaBitrate: "enforced_over_webrtc"
  }
};

// ============================================
// WORKAROUNDS
// ============================================

// Workaround #1: Session reset pour éviter latence
async function checkSessionHealth(session: RealtimeSession): Promise<void> {
  const sessionAge = Date.now() - session.startedAt;
  
  if (sessionAge > KNOWN_LIMITATIONS.longSessionLatency.threshold) {
    console.log("[SESSION] Approaching 5min limit, initiating graceful reset");
    
    // Sauvegarder l'état de la conversation
    const orderState = await session.getCurrentOrder();
    const conversationContext = session.getConversationHistory();
    
    // Créer nouvelle session
    const newSession = await createNewSession({
      ...OPENAI_SESSION_CONFIG,
      // Injecter le contexte précédent
      instructions: OPENAI_SESSION_CONFIG.instructions + `
        
## CONTEXTE DE SESSION PRÉCÉDENTE
Commande en cours: ${JSON.stringify(orderState)}
La conversation a été transférée pour raisons techniques.
Continue naturellement sans mentionner ce transfert.
      `
    });
    
    // Transférer
    await migrateSession(session, newSession);
  }
}

// Workaround #2: Fallback si latence trop haute
async function monitorLatencyAndFallback(
  latency: number,
  session: RealtimeSession
): Promise<void> {
  if (latency > LATENCY_TARGETS.e2e.critical) {
    console.warn("[LATENCY] Critical latency detected, considering fallback");
    
    // Si 3 tours consécutifs avec latence critique → fallback
    session.highLatencyCount = (session.highLatencyCount || 0) + 1;
    
    if (session.highLatencyCount >= 3) {
      await session.transferToHuman({
        reason: "technical_error",
        context: "Latence API trop élevée"
      });
    }
  } else {
    session.highLatencyCount = 0;
  }
}
```

#### Configuration fallback ASR

```typescript
interface ASRConfig {
  primary: {
    provider: "openai-realtime";
    model: "gpt-realtime-2025-08-28";
    sessionConfig: typeof OPENAI_SESSION_CONFIG;
  };
  
  fallback: {
    provider: "whisper-local" | "deepgram" | "google-speech";
    triggerConditions: FallbackTrigger[];
  };
  
  latencyBudget: {
    maxTranscriptionDelayMs: 300;  // max delay entre fin de parole et transcript
    maxE2EDelayMs: 850;            // max delay entre fin de parole et réponse bot
  };
}

interface FallbackTrigger {
  type: "api_error" | "latency_exceeded" | "confidence_too_low" | "connection_lost";
  threshold?: number;
  consecutiveFailures?: number;
}
```

---

## 2.3 IMPLÉMENTATION COMPLÈTE WEBSOCKET + OPENAI REALTIME

Cette section contient le code complet production-ready pour l'intégration OpenAI Realtime API.

### Architecture de connexion

```
┌─────────────────┐     WebSocket      ┌─────────────────┐     WebSocket      ┌─────────────────┐
│   DRIVE-THRU    │◄──────────────────►│   BACKEND       │◄──────────────────►│   OPENAI        │
│   CLIENT        │   Audio + Events   │   SERVER        │   Realtime API     │   REALTIME      │
│   (Browser)     │                    │   (Node.js)     │                    │                 │
└─────────────────┘                    └─────────────────┘                    └─────────────────┘
        │                                      │
        │                                      ├── Order Engine
        │                                      ├── Catalogue Service
        ▼                                      ├── POS Adapter
   ┌─────────────────┐                         └── Monitoring
   │  ORDER DISPLAY  │
   │  (React)        │
   └─────────────────┘
```

### 2.3.1 Backend Server (Node.js + Fastify)

```typescript
// ============================================
// server.ts - Main Backend Server
// ============================================

import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { config } from './config';
import { OrderEngine } from './order-engine';
import { CatalogueService } from './catalogue-service';
import { POSAdapter } from './pos-adapter';
import { MetricsCollector } from './metrics';
import { logger } from './logger';

// ============================================
// TYPES
// ============================================

interface DriveThruSession {
  id: string;
  
  // Connections
  clientWs: WebSocket;           // Browser client
  openaiWs: WebSocket | null;    // OpenAI Realtime
  
  // State
  state: SessionState;
  order: Order;
  conversationHistory: ConversationTurn[];
  
  // Timing
  startedAt: number;
  lastActivityAt: number;
  
  // Metrics
  metrics: SessionMetrics;
  
  // Config
  storeId: string;
  laneId: string;
  mode: 'shadow' | 'live';
}

type SessionState = 
  | 'connecting'
  | 'greeting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'confirming'
  | 'validated'
  | 'fallback_to_human'
  | 'completed'
  | 'error';

interface ConversationTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  audioId?: string;
  confidence?: number;
  intent?: string;
  latencyMs?: number;
}

interface SessionMetrics {
  turnCount: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  lowConfidenceCount: number;
  toolCallCount: number;
  interruptionCount: number;
}

// ============================================
// OPENAI REALTIME EVENTS
// ============================================

type OpenAIRealtimeEvent = 
  // Session events
  | { type: 'session.created'; session: any }
  | { type: 'session.updated'; session: any }
  
  // Input audio events
  | { type: 'input_audio_buffer.committed'; item_id: string }
  | { type: 'input_audio_buffer.cleared' }
  | { type: 'input_audio_buffer.speech_started'; audio_start_ms: number }
  | { type: 'input_audio_buffer.speech_stopped'; audio_end_ms: number }
  
  // Conversation events
  | { type: 'conversation.created'; conversation: any }
  | { type: 'conversation.item.created'; item: any }
  | { type: 'conversation.item.deleted'; item_id: string }
  | { type: 'conversation.item.truncated'; item_id: string }
  | { type: 'conversation.item.input_audio_transcription.completed'; item_id: string; transcript: string }
  
  // Response events
  | { type: 'response.created'; response: any }
  | { type: 'response.output_item.added'; item: any }
  | { type: 'response.output_item.done'; item: any }
  | { type: 'response.content_part.added'; part: any }
  | { type: 'response.content_part.done'; part: any }
  | { type: 'response.audio.delta'; delta: string; item_id: string }
  | { type: 'response.audio.done'; item_id: string }
  | { type: 'response.audio_transcript.delta'; delta: string }
  | { type: 'response.audio_transcript.done'; transcript: string }
  | { type: 'response.function_call_arguments.delta'; delta: string; call_id: string }
  | { type: 'response.function_call_arguments.done'; call_id: string; name: string; arguments: string }
  | { type: 'response.done'; response: any }
  
  // Error events
  | { type: 'error'; error: { type: string; code: string; message: string } }
  
  // Rate limit events
  | { type: 'rate_limits.updated'; rate_limits: any[] };

// ============================================
// SERVER SETUP
// ============================================

const fastify = Fastify({ 
  logger: true,
  trustProxy: true
});

await fastify.register(fastifyWebsocket, {
  options: {
    maxPayload: 1024 * 1024 * 10, // 10MB for audio chunks
    clientTracking: true
  }
});

// Services
const orderEngine = new OrderEngine();
const catalogueService = new CatalogueService();
const posAdapter = new POSAdapter();
const metrics = new MetricsCollector();

// Active sessions
const sessions = new Map<string, DriveThruSession>();

// ============================================
// WEBSOCKET ROUTE - CLIENT CONNECTION
// ============================================

fastify.register(async function (fastify) {
  fastify.get('/ws/drive-thru', { websocket: true }, (socket, req) => {
    const sessionId = randomUUID();
    const storeId = req.query.storeId as string || 'default';
    const laneId = req.query.laneId as string || 'lane-1';
    const mode = (req.query.mode as 'shadow' | 'live') || config.MODE;
    
    logger.info({ sessionId, storeId, laneId, mode }, 'New drive-thru session');
    
    // Create session
    const session: DriveThruSession = {
      id: sessionId,
      clientWs: socket,
      openaiWs: null,
      state: 'connecting',
      order: orderEngine.createEmptyOrder(sessionId, storeId),
      conversationHistory: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      metrics: {
        turnCount: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        lowConfidenceCount: 0,
        toolCallCount: 0,
        interruptionCount: 0
      },
      storeId,
      laneId,
      mode
    };
    
    sessions.set(sessionId, session);
    
    // Connect to OpenAI Realtime
    connectToOpenAI(session);
    
    // Handle client messages
    socket.on('message', (data) => handleClientMessage(session, data));
    
    // Handle client disconnect
    socket.on('close', () => handleClientDisconnect(session));
    
    // Handle errors
    socket.on('error', (error) => {
      logger.error({ sessionId, error }, 'Client WebSocket error');
      handleClientDisconnect(session);
    });
  });
});

// ============================================
// OPENAI REALTIME CONNECTION
// ============================================

async function connectToOpenAI(session: DriveThruSession): Promise<void> {
  const url = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2025-08-28';
  
  logger.info({ sessionId: session.id }, 'Connecting to OpenAI Realtime');
  
  const ws = new WebSocket(url, {
    headers: {
      'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });
  
  session.openaiWs = ws;
  
  ws.on('open', () => {
    logger.info({ sessionId: session.id }, 'Connected to OpenAI Realtime');
    
    // Configure session
    sendToOpenAI(session, {
      type: 'session.update',
      session: buildSessionConfig(session)
    });
  });
  
  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString()) as OpenAIRealtimeEvent;
      handleOpenAIEvent(session, event);
    } catch (error) {
      logger.error({ sessionId: session.id, error }, 'Error parsing OpenAI message');
    }
  });
  
  ws.on('close', (code, reason) => {
    logger.warn({ sessionId: session.id, code, reason: reason.toString() }, 'OpenAI connection closed');
    
    // Attempt reconnection if session still active
    if (sessions.has(session.id) && session.state !== 'completed') {
      setTimeout(() => reconnectToOpenAI(session), 1000);
    }
  });
  
  ws.on('error', (error) => {
    logger.error({ sessionId: session.id, error }, 'OpenAI WebSocket error');
    handleOpenAIError(session, error);
  });
}

function buildSessionConfig(session: DriveThruSession) {
  // Get catalogue for system prompt
  const catalogue = catalogueService.getCatalogue(session.storeId);
  const menuRules = catalogueService.getMenuRules(session.storeId);
  
  // Build instructions with catalogue injected
  const instructions = config.OPENAI_INSTRUCTIONS
    .replace('{{CATALOGUE_JSON}}', JSON.stringify(catalogue, null, 2))
    .replace('{{MENU_RULES_JSON}}', JSON.stringify(menuRules, null, 2));
  
  return {
    modalities: ['text', 'audio'],
    voice: config.OPENAI_VOICE,
    instructions,
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    input_audio_transcription: {
      model: 'whisper-1'
    },
    turn_detection: {
      type: 'semantic_vad',
      threshold: config.VAD_THRESHOLD,
      prefix_padding_ms: config.VAD_PREFIX_PADDING_MS,
      silence_duration_ms: config.VAD_SILENCE_DURATION_MS,
      create_response: true
    },
    tools: buildTools(),
    tool_choice: 'auto',
    temperature: config.LLM_TEMPERATURE,
    max_response_output_tokens: config.MAX_RESPONSE_TOKENS
  };
}

function buildTools() {
  return [
    {
      type: 'function',
      name: 'add_item_to_order',
      description: 'Ajoute un produit à la commande en cours.',
      parameters: {
        type: 'object',
        properties: {
          product_name: { type: 'string', description: 'Nom du produit tel que compris' },
          quantity: { type: 'integer', description: 'Quantité (1-10)', minimum: 1, maximum: 10 },
          size: { type: 'string', enum: ['small', 'medium', 'large'] },
          modifiers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['side', 'drink', 'sauce', 'dessert'] },
                product_name: { type: 'string' }
              },
              required: ['type', 'product_name']
            }
          }
        },
        required: ['product_name', 'quantity']
      }
    },
    {
      type: 'function',
      name: 'remove_item_from_order',
      description: 'Supprime un item de la commande.',
      parameters: {
        type: 'object',
        properties: {
          item_index: { type: 'integer', description: 'Index de l\'item (0-based)' },
          product_name: { type: 'string', description: 'Nom du produit si index inconnu' }
        }
      }
    },
    {
      type: 'function',
      name: 'get_current_order',
      description: 'Récupère l\'état actuel de la commande pour récapitulatif.',
      parameters: { type: 'object', properties: {} }
    },
    {
      type: 'function',
      name: 'confirm_order',
      description: 'Confirme et envoie la commande au POS. UNIQUEMENT après confirmation explicite.',
      parameters: {
        type: 'object',
        properties: {
          confirmed_by_customer: { type: 'boolean' }
        },
        required: ['confirmed_by_customer']
      }
    },
    {
      type: 'function',
      name: 'cancel_order',
      description: 'Annule la commande.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' }
        }
      }
    },
    {
      type: 'function',
      name: 'transfer_to_human',
      description: 'Transfère à un équipier.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['customer_request', 'repeated_misunderstanding', 'complex_request', 
                   'allergen_query', 'complaint', 'payment_issue', 'technical_error']
          },
          context: { type: 'string' }
        },
        required: ['reason']
      }
    },
    {
      type: 'function',
      name: 'check_product_availability',
      description: 'Vérifie si un produit est disponible.',
      parameters: {
        type: 'object',
        properties: {
          product_name: { type: 'string' }
        },
        required: ['product_name']
      }
    }
  ];
}

async function reconnectToOpenAI(session: DriveThruSession): Promise<void> {
  logger.info({ sessionId: session.id }, 'Attempting to reconnect to OpenAI');
  
  // Close existing connection if any
  if (session.openaiWs) {
    try {
      session.openaiWs.close();
    } catch (e) {
      // Ignore
    }
  }
  
  // Reconnect
  await connectToOpenAI(session);
  
  // Notify client of reconnection
  sendToClient(session, {
    type: 'system',
    event: 'reconnected',
    message: 'Session restored'
  });
}

// ============================================
// MESSAGE HANDLERS
// ============================================

function sendToOpenAI(session: DriveThruSession, event: any): void {
  if (session.openaiWs?.readyState === WebSocket.OPEN) {
    session.openaiWs.send(JSON.stringify(event));
  } else {
    logger.warn({ sessionId: session.id }, 'Cannot send to OpenAI: connection not open');
  }
}

function sendToClient(session: DriveThruSession, message: any): void {
  if (session.clientWs.readyState === WebSocket.OPEN) {
    session.clientWs.send(JSON.stringify(message));
  }
}

function handleClientMessage(session: DriveThruSession, data: Buffer | string): void {
  session.lastActivityAt = Date.now();
  
  try {
    // Check if it's audio data (binary) or JSON message
    if (Buffer.isBuffer(data)) {
      // Binary audio data - forward to OpenAI
      handleAudioFromClient(session, data);
    } else {
      // JSON message
      const message = JSON.parse(data.toString());
      handleClientEvent(session, message);
    }
  } catch (error) {
    logger.error({ sessionId: session.id, error }, 'Error handling client message');
  }
}

function handleAudioFromClient(session: DriveThruSession, audioData: Buffer): void {
  // Convert to base64 and send to OpenAI
  const base64Audio = audioData.toString('base64');
  
  sendToOpenAI(session, {
    type: 'input_audio_buffer.append',
    audio: base64Audio
  });
}

function handleClientEvent(session: DriveThruSession, event: any): void {
  switch (event.type) {
    case 'start_session':
      // Session already started, send greeting
      session.state = 'greeting';
      sendToOpenAI(session, {
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          instructions: 'Dis "Bienvenue chez Quick, je vous écoute !" de manière chaleureuse.'
        }
      });
      break;
      
    case 'end_session':
      handleClientDisconnect(session);
      break;
      
    case 'interrupt':
      // Client manually interrupts (e.g., mute button)
      sendToOpenAI(session, { type: 'response.cancel' });
      break;
      
    case 'force_reply':
      // Force the bot to respond (manual turn end)
      sendToOpenAI(session, { type: 'input_audio_buffer.commit' });
      sendToOpenAI(session, { type: 'response.create' });
      break;
      
    case 'crew_takeover':
      // Crew takes over the conversation
      handleCrewTakeover(session, event.crewId);
      break;
      
    default:
      logger.warn({ sessionId: session.id, eventType: event.type }, 'Unknown client event');
  }
}

// ============================================
// OPENAI EVENT HANDLERS
// ============================================

function handleOpenAIEvent(session: DriveThruSession, event: OpenAIRealtimeEvent): void {
  const startTime = Date.now();
  
  switch (event.type) {
    // Session events
    case 'session.created':
      logger.info({ sessionId: session.id }, 'OpenAI session created');
      sendToClient(session, { type: 'session_ready' });
      break;
      
    case 'session.updated':
      logger.debug({ sessionId: session.id }, 'OpenAI session updated');
      break;
    
    // Speech detection
    case 'input_audio_buffer.speech_started':
      session.state = 'listening';
      session.metrics.turnCount++;
      sendToClient(session, { 
        type: 'speech_started',
        audioStartMs: event.audio_start_ms 
      });
      break;
      
    case 'input_audio_buffer.speech_stopped':
      session.state = 'processing';
      sendToClient(session, { 
        type: 'speech_stopped',
        audioEndMs: event.audio_end_ms 
      });
      break;
    
    // Transcription
    case 'conversation.item.input_audio_transcription.completed':
      const transcript = event.transcript;
      logger.info({ sessionId: session.id, transcript }, 'User transcript');
      
      // Add to conversation history
      session.conversationHistory.push({
        id: event.item_id,
        role: 'user',
        content: transcript,
        timestamp: Date.now()
      });
      
      // Send to client for display
      sendToClient(session, {
        type: 'transcript',
        role: 'user',
        text: transcript,
        itemId: event.item_id
      });
      break;
    
    // Response audio streaming
    case 'response.audio.delta':
      // Stream audio chunk to client
      sendToClient(session, {
        type: 'audio_delta',
        audio: event.delta,  // base64 encoded audio
        itemId: event.item_id
      });
      break;
      
    case 'response.audio.done':
      sendToClient(session, {
        type: 'audio_done',
        itemId: event.item_id
      });
      break;
    
    // Response transcript (bot's speech as text)
    case 'response.audio_transcript.delta':
      sendToClient(session, {
        type: 'bot_transcript_delta',
        text: event.delta
      });
      break;
      
    case 'response.audio_transcript.done':
      session.conversationHistory.push({
        id: randomUUID(),
        role: 'assistant',
        content: event.transcript,
        timestamp: Date.now()
      });
      
      sendToClient(session, {
        type: 'bot_transcript_done',
        text: event.transcript
      });
      break;
    
    // Function calls
    case 'response.function_call_arguments.done':
      handleFunctionCall(session, event.call_id, event.name, event.arguments);
      break;
    
    // Response complete
    case 'response.done':
      const latencyMs = Date.now() - startTime;
      session.metrics.totalLatencyMs += latencyMs;
      session.metrics.avgLatencyMs = session.metrics.totalLatencyMs / session.metrics.turnCount;
      
      session.state = 'listening';
      
      // Check for session health (reset before 5min)
      checkSessionHealth(session);
      break;
    
    // Errors
    case 'error':
      logger.error({ sessionId: session.id, error: event.error }, 'OpenAI error');
      handleOpenAIError(session, event.error);
      break;
    
    // Rate limits
    case 'rate_limits.updated':
      logger.debug({ sessionId: session.id, rateLimits: event.rate_limits }, 'Rate limits updated');
      break;
      
    default:
      logger.debug({ sessionId: session.id, eventType: event.type }, 'Unhandled OpenAI event');
  }
}

// ============================================
// FUNCTION CALL HANDLERS (Tool Execution)
// ============================================

async function handleFunctionCall(
  session: DriveThruSession, 
  callId: string, 
  functionName: string, 
  argsString: string
): Promise<void> {
  logger.info({ sessionId: session.id, functionName, args: argsString }, 'Function call');
  session.metrics.toolCallCount++;
  
  let result: any;
  let error: string | null = null;
  
  try {
    const args = JSON.parse(argsString);
    
    switch (functionName) {
      case 'add_item_to_order':
        result = await handleAddItem(session, args);
        break;
        
      case 'remove_item_from_order':
        result = await handleRemoveItem(session, args);
        break;
        
      case 'get_current_order':
        result = handleGetCurrentOrder(session);
        break;
        
      case 'confirm_order':
        result = await handleConfirmOrder(session, args);
        break;
        
      case 'cancel_order':
        result = await handleCancelOrder(session, args);
        break;
        
      case 'transfer_to_human':
        result = await handleTransferToHuman(session, args);
        break;
        
      case 'check_product_availability':
        result = await handleCheckAvailability(session, args);
        break;
        
      default:
        error = `Unknown function: ${functionName}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error';
    logger.error({ sessionId: session.id, functionName, error }, 'Function call error');
  }
  
  // Send result back to OpenAI
  sendToOpenAI(session, {
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify(error ? { error } : result)
    }
  });
  
  // Trigger response generation
  sendToOpenAI(session, { type: 'response.create' });
}

async function handleAddItem(
  session: DriveThruSession, 
  args: { product_name: string; quantity: number; size?: string; modifiers?: any[] }
): Promise<any> {
  const catalogue = catalogueService.getCatalogue(session.storeId);
  
  // Resolve product name to ID
  const product = catalogueService.resolveProduct(args.product_name, session.storeId);
  
  if (!product) {
    return {
      success: false,
      error: 'product_not_found',
      message: `Produit "${args.product_name}" non trouvé dans le catalogue`
    };
  }
  
  if (!product.available) {
    const alternatives = catalogueService.findAlternatives(product.id, session.storeId);
    return {
      success: false,
      error: 'product_unavailable',
      message: `${product.name} n'est plus disponible`,
      alternatives: alternatives.map(p => p.name)
    };
  }
  
  // Resolve modifiers
  const resolvedModifiers = (args.modifiers || []).map(mod => {
    const modProduct = catalogueService.resolveProduct(mod.product_name, session.storeId);
    return {
      type: mod.type,
      productId: modProduct?.id,
      name: modProduct?.name || mod.product_name,
      found: !!modProduct
    };
  });
  
  // Add to order
  const result = orderEngine.addItemToOrder(
    session.order,
    {
      productId: product.id,
      name: product.name,
      quantity: args.quantity,
      size: args.size,
      modifiers: resolvedModifiers.filter(m => m.found)
    },
    catalogue,
    catalogueService.getMenuRules(session.storeId)
  );
  
  if (!result.success) {
    return {
      success: false,
      error: result.errors?.[0]?.code || 'add_failed',
      message: result.errors?.[0]?.messageFr || 'Erreur lors de l\'ajout'
    };
  }
  
  session.order = result.data!;
  
  // Notify client of order update
  sendToClient(session, {
    type: 'order_updated',
    order: session.order
  });
  
  return {
    success: true,
    message: `${args.quantity}x ${product.name} ajouté`,
    orderTotal: formatPrice(session.order.total),
    itemCount: session.order.items.length
  };
}

async function handleRemoveItem(
  session: DriveThruSession,
  args: { item_index?: number; product_name?: string }
): Promise<any> {
  let itemIndex = args.item_index;
  
  // Find by name if index not provided
  if (itemIndex === undefined && args.product_name) {
    itemIndex = session.order.items.findIndex(
      item => item.name.toLowerCase().includes(args.product_name!.toLowerCase())
    );
  }
  
  if (itemIndex === undefined || itemIndex < 0 || itemIndex >= session.order.items.length) {
    return {
      success: false,
      error: 'item_not_found',
      message: 'Article non trouvé dans la commande'
    };
  }
  
  const removedItem = session.order.items[itemIndex];
  const result = orderEngine.removeItemFromOrder(session.order, itemIndex);
  
  if (!result.success) {
    return {
      success: false,
      error: 'remove_failed',
      message: 'Erreur lors de la suppression'
    };
  }
  
  session.order = result.data!;
  
  sendToClient(session, {
    type: 'order_updated',
    order: session.order
  });
  
  return {
    success: true,
    message: `${removedItem.name} retiré`,
    orderTotal: formatPrice(session.order.total),
    itemCount: session.order.items.length
  };
}

function handleGetCurrentOrder(session: DriveThruSession): any {
  const summary = orderEngine.generateOrderSummary(session.order, 'full');
  
  return {
    success: true,
    items: session.order.items.map(item => ({
      name: item.name,
      quantity: item.qty,
      price: formatPrice(item.linePrice),
      modifiers: item.modifiers.map(m => m.name)
    })),
    total: formatPrice(session.order.total),
    itemCount: session.order.items.length,
    summary
  };
}

async function handleConfirmOrder(
  session: DriveThruSession,
  args: { confirmed_by_customer: boolean }
): Promise<any> {
  if (!args.confirmed_by_customer) {
    return {
      success: false,
      error: 'not_confirmed',
      message: 'Le client n\'a pas confirmé explicitement'
    };
  }
  
  // Validate order
  const validation = orderEngine.validateOrder(
    session.order,
    catalogueService.getCatalogue(session.storeId),
    catalogueService.getMenuRules(session.storeId)
  );
  
  if (!validation.success || !validation.data?.valid) {
    return {
      success: false,
      error: 'validation_failed',
      message: validation.data?.errors?.[0]?.messageFr || 'Commande invalide',
      errors: validation.data?.errors
    };
  }
  
  session.state = 'validated';
  
  // In live mode, send to POS
  if (session.mode === 'live') {
    try {
      const posResult = await posAdapter.createOrder(session.order);
      
      if (!posResult.success) {
        return {
          success: false,
          error: 'pos_error',
          message: 'Erreur lors de l\'envoi au POS'
        };
      }
      
      session.order.status = 'sent_to_pos';
      session.order.posOrderId = posResult.orderId;
      
    } catch (error) {
      logger.error({ sessionId: session.id, error }, 'POS error');
      return {
        success: false,
        error: 'pos_error',
        message: 'Erreur de communication avec la caisse'
      };
    }
  } else {
    // Shadow mode - just mark as confirmed
    session.order.status = 'confirmed';
  }
  
  sendToClient(session, {
    type: 'order_confirmed',
    order: session.order,
    mode: session.mode
  });
  
  return {
    success: true,
    message: 'Commande confirmée',
    total: formatPrice(session.order.total),
    mode: session.mode
  };
}

async function handleCancelOrder(
  session: DriveThruSession,
  args: { reason?: string }
): Promise<any> {
  session.order.status = 'cancelled';
  session.state = 'completed';
  
  sendToClient(session, {
    type: 'order_cancelled',
    reason: args.reason
  });
  
  return {
    success: true,
    message: 'Commande annulée'
  };
}

async function handleTransferToHuman(
  session: DriveThruSession,
  args: { reason: string; context?: string }
): Promise<any> {
  session.state = 'fallback_to_human';
  
  logger.info({ 
    sessionId: session.id, 
    reason: args.reason,
    context: args.context
  }, 'Transferring to human');
  
  // Notify client
  sendToClient(session, {
    type: 'fallback_to_human',
    reason: args.reason,
    context: args.context,
    order: session.order,
    conversationHistory: session.conversationHistory
  });
  
  // Notify crew dashboard
  metrics.recordFallback(session.id, args.reason);
  
  return {
    success: true,
    message: 'Transfert à un équipier en cours'
  };
}

async function handleCheckAvailability(
  session: DriveThruSession,
  args: { product_name: string }
): Promise<any> {
  const product = catalogueService.resolveProduct(args.product_name, session.storeId);
  
  if (!product) {
    return {
      found: false,
      available: false,
      message: `"${args.product_name}" n'existe pas dans notre menu`
    };
  }
  
  // Check real-time availability
  const isAvailable = await catalogueService.checkRealTimeAvailability(product.id, session.storeId);
  
  if (!isAvailable) {
    const alternatives = catalogueService.findAlternatives(product.id, session.storeId);
    return {
      found: true,
      available: false,
      productName: product.name,
      message: `${product.name} n'est plus disponible actuellement`,
      alternatives: alternatives.map(p => p.name)
    };
  }
  
  return {
    found: true,
    available: true,
    productName: product.name,
    price: formatPrice(product.basePrice),
    message: `${product.name} est disponible à ${formatPrice(product.basePrice)}`
  };
}

// ============================================
// SESSION MANAGEMENT
// ============================================

function checkSessionHealth(session: DriveThruSession): void {
  const sessionAge = Date.now() - session.startedAt;
  
  // Reset before 5 minute limit (latency degrades after)
  if (sessionAge > 4 * 60 * 1000) {
    logger.info({ sessionId: session.id }, 'Session approaching 5min, initiating reset');
    resetSession(session);
  }
}

async function resetSession(session: DriveThruSession): Promise<void> {
  // Save current state
  const orderBackup = { ...session.order };
  const historyBackup = [...session.conversationHistory];
  
  // Close old OpenAI connection
  if (session.openaiWs) {
    session.openaiWs.close();
  }
  
  // Reconnect
  await connectToOpenAI(session);
  
  // Restore state in new session context
  session.order = orderBackup;
  session.conversationHistory = historyBackup;
  session.startedAt = Date.now(); // Reset timer
  
  // Inject context into new session
  sendToOpenAI(session, {
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'system',
      content: [{
        type: 'text',
        text: `Session restaurée. Commande en cours: ${JSON.stringify(session.order.items)}. 
               Continue la conversation naturellement sans mentionner ce transfert.`
      }]
    }
  });
}

function handleClientDisconnect(session: DriveThruSession): void {
  logger.info({ sessionId: session.id }, 'Client disconnected');
  
  // Close OpenAI connection
  if (session.openaiWs) {
    session.openaiWs.close();
  }
  
  // Record metrics
  metrics.recordSessionEnd(session);
  
  // Remove from active sessions
  sessions.delete(session.id);
}

function handleCrewTakeover(session: DriveThruSession, crewId: string): void {
  session.state = 'fallback_to_human';
  
  logger.info({ sessionId: session.id, crewId }, 'Crew takeover');
  
  // Stop bot responses
  sendToOpenAI(session, { type: 'response.cancel' });
  
  // Notify client
  sendToClient(session, {
    type: 'crew_takeover',
    crewId,
    order: session.order
  });
}

function handleOpenAIError(session: DriveThruSession, error: any): void {
  const errorCode = error?.code || error?.type || 'unknown';
  
  logger.error({ sessionId: session.id, errorCode }, 'OpenAI error');
  
  // Notify client
  sendToClient(session, {
    type: 'error',
    error: {
      code: errorCode,
      message: 'Erreur de communication'
    }
  });
  
  // On critical errors, fallback to human
  if (['server_error', 'rate_limit_exceeded', 'invalid_api_key'].includes(errorCode)) {
    handleTransferToHuman(session, {
      reason: 'technical_error',
      context: `OpenAI error: ${errorCode}`
    });
  }
}

// ============================================
// UTILITIES
// ============================================

function formatPrice(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')}€`;
}

// ============================================
// START SERVER
// ============================================

const start = async () => {
  try {
    await fastify.listen({ 
      port: config.PORT, 
      host: '0.0.0.0' 
    });
    logger.info(`Server running on port ${config.PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
```

### 2.3.2 Frontend Client (Browser)

```typescript
// ============================================
// drive-thru-client.ts - Browser Client
// ============================================

interface DriveThruClientConfig {
  serverUrl: string;
  storeId: string;
  laneId: string;
  mode: 'shadow' | 'live';
  
  // Audio settings
  sampleRate: number;
  channelCount: number;
  
  // Callbacks
  onSessionReady: () => void;
  onOrderUpdated: (order: Order) => void;
  onTranscript: (role: 'user' | 'bot', text: string) => void;
  onBotSpeaking: (speaking: boolean) => void;
  onError: (error: any) => void;
  onFallbackToHuman: (data: any) => void;
}

class DriveThruClient {
  private config: DriveThruClientConfig;
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private audioQueue: Float32Array[] = [];
  private isPlaying = false;
  private isMuted = false;
  
  constructor(config: DriveThruClientConfig) {
    this.config = config;
  }
  
  // ============================================
  // CONNECTION
  // ============================================
  
  async connect(): Promise<void> {
    const url = new URL(this.config.serverUrl);
    url.searchParams.set('storeId', this.config.storeId);
    url.searchParams.set('laneId', this.config.laneId);
    url.searchParams.set('mode', this.config.mode);
    
    this.ws = new WebSocket(url.toString());
    this.ws.binaryType = 'arraybuffer';
    
    this.ws.onopen = () => {
      console.log('[DriveThru] Connected to server');
      this.initAudio();
    };
    
    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary audio data
        this.handleAudioFromServer(event.data);
      } else {
        // JSON message
        const message = JSON.parse(event.data);
        this.handleServerMessage(message);
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('[DriveThru] WebSocket error:', error);
      this.config.onError(error);
    };
    
    this.ws.onclose = () => {
      console.log('[DriveThru] Disconnected');
      this.cleanup();
    };
  }
  
  disconnect(): void {
    this.send({ type: 'end_session' });
    this.cleanup();
  }
  
  private cleanup(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    if (this.ws) {
      this.ws.close();
    }
  }
  
  // ============================================
  // AUDIO CAPTURE
  // ============================================
  
  private async initAudio(): Promise<void> {
    try {
      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate
      });
      
      // Get microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channelCount,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      // Load audio worklet for processing
      await this.audioContext.audioWorklet.addModule('/audio-processor.js');
      
      // Create nodes
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.audioWorklet = new AudioWorkletNode(this.audioContext, 'audio-processor');
      
      // Handle audio chunks from worklet
      this.audioWorklet.port.onmessage = (event) => {
        if (!this.isMuted && this.ws?.readyState === WebSocket.OPEN) {
          // Send audio as binary
          this.ws.send(event.data.buffer);
        }
      };
      
      // Connect nodes
      source.connect(this.audioWorklet);
      
      // Start session
      this.send({ type: 'start_session' });
      
    } catch (error) {
      console.error('[DriveThru] Audio init error:', error);
      this.config.onError(error);
    }
  }
  
  // ============================================
  // AUDIO PLAYBACK
  // ============================================
  
  private handleAudioFromServer(data: ArrayBuffer): void {
    // Convert to Float32Array
    const int16Array = new Int16Array(data);
    const float32Array = new Float32Array(int16Array.length);
    
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768;
    }
    
    this.audioQueue.push(float32Array);
    
    if (!this.isPlaying) {
      this.playNextChunk();
    }
  }
  
  private handleAudioDelta(base64Audio: string): void {
    // Decode base64 to ArrayBuffer
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    this.handleAudioFromServer(bytes.buffer);
  }
  
  private async playNextChunk(): Promise<void> {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      this.config.onBotSpeaking(false);
      return;
    }
    
    this.isPlaying = true;
    this.config.onBotSpeaking(true);
    
    const chunk = this.audioQueue.shift()!;
    const buffer = this.audioContext!.createBuffer(
      1,
      chunk.length,
      this.config.sampleRate
    );
    buffer.getChannelData(0).set(chunk);
    
    const source = this.audioContext!.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext!.destination);
    
    source.onended = () => {
      this.playNextChunk();
    };
    
    source.start();
  }
  
  stopPlayback(): void {
    this.audioQueue = [];
    this.isPlaying = false;
    this.config.onBotSpeaking(false);
  }
  
  // ============================================
  // MESSAGE HANDLING
  // ============================================
  
  private handleServerMessage(message: any): void {
    switch (message.type) {
      case 'session_ready':
        this.config.onSessionReady();
        break;
        
      case 'audio_delta':
        this.handleAudioDelta(message.audio);
        break;
        
      case 'audio_done':
        // Audio stream complete for this response
        break;
        
      case 'transcript':
        this.config.onTranscript(message.role, message.text);
        break;
        
      case 'bot_transcript_delta':
        // Partial bot transcript - could update UI in real-time
        break;
        
      case 'bot_transcript_done':
        this.config.onTranscript('bot', message.text);
        break;
        
      case 'order_updated':
        this.config.onOrderUpdated(message.order);
        break;
        
      case 'order_confirmed':
        this.config.onOrderUpdated(message.order);
        break;
        
      case 'order_cancelled':
        // Handle cancellation UI
        break;
        
      case 'fallback_to_human':
        this.config.onFallbackToHuman(message);
        break;
        
      case 'speech_started':
        // User started speaking - could show indicator
        break;
        
      case 'speech_stopped':
        // User stopped speaking - processing
        break;
        
      case 'error':
        this.config.onError(message.error);
        break;
        
      default:
        console.log('[DriveThru] Unknown message:', message.type);
    }
  }
  
  private send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
  
  // ============================================
  // PUBLIC CONTROLS
  // ============================================
  
  mute(): void {
    this.isMuted = true;
  }
  
  unmute(): void {
    this.isMuted = false;
  }
  
  interrupt(): void {
    this.send({ type: 'interrupt' });
    this.stopPlayback();
  }
  
  forceReply(): void {
    this.send({ type: 'force_reply' });
  }
  
  crewTakeover(crewId: string): void {
    this.send({ type: 'crew_takeover', crewId });
  }
}

// ============================================
// AUDIO WORKLET PROCESSOR
// Save as /public/audio-processor.js
// ============================================

/*
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const channelData = input[0];
    
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];
      
      if (this.bufferIndex >= this.bufferSize) {
        // Convert to PCM16
        const pcm16 = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Send to main thread
        this.port.postMessage(pcm16, [pcm16.buffer]);
        
        this.bufferIndex = 0;
      }
    }
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
*/

export { DriveThruClient };
```

### 2.3.3 React Component — Order Display

```tsx
// ============================================
// OrderDisplay.tsx - Drive-Thru Order Screen
// ============================================

import React, { useState, useEffect, useRef } from 'react';
import { DriveThruClient } from './drive-thru-client';

interface Order {
  id: string;
  items: OrderItem[];
  total: number;
  status: string;
}

interface OrderItem {
  id: string;
  name: string;
  qty: number;
  linePrice: number;
  modifiers: { name: string }[];
}

interface Transcript {
  id: string;
  role: 'user' | 'bot';
  text: string;
  timestamp: number;
}

const DRIVE_THRU_CONFIG = {
  serverUrl: 'wss://voicebot.quick.local/ws/drive-thru',
  storeId: 'QUICK-001',
  laneId: 'lane-1',
  mode: 'live' as const,
  sampleRate: 24000,
  channelCount: 1
};

export function DriveThruScreen() {
  const [isConnected, setIsConnected] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackData, setFallbackData] = useState<any>(null);
  
  const clientRef = useRef<DriveThruClient | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Initialize client
    clientRef.current = new DriveThruClient({
      ...DRIVE_THRU_CONFIG,
      
      onSessionReady: () => {
        setIsConnected(true);
        setError(null);
      },
      
      onOrderUpdated: (newOrder) => {
        setOrder(newOrder);
      },
      
      onTranscript: (role, text) => {
        setTranscripts(prev => [...prev, {
          id: crypto.randomUUID(),
          role,
          text,
          timestamp: Date.now()
        }]);
      },
      
      onBotSpeaking: (speaking) => {
        setIsBotSpeaking(speaking);
      },
      
      onError: (err) => {
        setError(err.message || 'Erreur de connexion');
      },
      
      onFallbackToHuman: (data) => {
        setFallbackData(data);
      }
    });
    
    clientRef.current.connect();
    
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);
  
  // Auto-scroll transcripts
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);
  
  const handleMuteToggle = () => {
    if (isMuted) {
      clientRef.current?.unmute();
    } else {
      clientRef.current?.mute();
    }
    setIsMuted(!isMuted);
  };
  
  const handleInterrupt = () => {
    clientRef.current?.interrupt();
  };
  
  const handleForceReply = () => {
    clientRef.current?.forceReply();
  };
  
  const formatPrice = (cents: number) => {
    return `${(cents / 100).toFixed(2).replace('.', ',')}€`;
  };
  
  // Fallback screen
  if (fallbackData) {
    return (
      <div className="fallback-screen">
        <div className="fallback-header">
          <h1>🎧 Transfert à l'équipier</h1>
          <p>Raison: {fallbackData.reason}</p>
        </div>
        
        <div className="fallback-order">
          <h2>Commande en cours</h2>
          {fallbackData.order?.items?.map((item: OrderItem, i: number) => (
            <div key={i} className="order-item">
              <span>{item.qty}x {item.name}</span>
              <span>{formatPrice(item.linePrice)}</span>
            </div>
          ))}
          <div className="order-total">
            <strong>Total:</strong>
            <strong>{formatPrice(fallbackData.order?.total || 0)}</strong>
          </div>
        </div>
        
        <div className="fallback-transcript">
          <h2>Historique conversation</h2>
          {fallbackData.conversationHistory?.map((turn: any, i: number) => (
            <div key={i} className={`transcript-line ${turn.role}`}>
              <span className="role">{turn.role === 'user' ? '🎤' : '🤖'}</span>
              <span className="text">{turn.content}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <div className="drive-thru-screen">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <img src="/quick-logo.png" alt="Quick" />
        </div>
        <div className="status">
          <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● Connecté' : '○ Déconnecté'}
          </span>
          {isBotSpeaking && <span className="speaking-indicator">🔊 Bot parle...</span>}
        </div>
      </header>
      
      {/* Error banner */}
      {error && (
        <div className="error-banner">
          ⚠️ {error}
        </div>
      )}
      
      {/* Main content */}
      <div className="main-content">
        {/* Order panel */}
        <div className="order-panel">
          <h2>Votre commande</h2>
          
          {order && order.items.length > 0 ? (
            <>
              <div className="order-items">
                {order.items.map((item, index) => (
                  <div key={item.id || index} className="order-item">
                    <div className="item-header">
                      <span className="item-qty">{item.qty}x</span>
                      <span className="item-name">{item.name}</span>
                      <span className="item-price">{formatPrice(item.linePrice)}</span>
                    </div>
                    {item.modifiers && item.modifiers.length > 0 && (
                      <div className="item-modifiers">
                        {item.modifiers.map((mod, i) => (
                          <span key={i} className="modifier">+ {mod.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="order-total">
                <span>Total</span>
                <span className="total-amount">{formatPrice(order.total)}</span>
              </div>
            </>
          ) : (
            <div className="empty-order">
              <p>Votre commande est vide</p>
              <p className="hint">Dites ce que vous souhaitez commander</p>
            </div>
          )}
        </div>
        
        {/* Transcript panel */}
        <div className="transcript-panel">
          <h2>Conversation</h2>
          
          <div className="transcript-list">
            {transcripts.map((t) => (
              <div key={t.id} className={`transcript-item ${t.role}`}>
                <span className="transcript-icon">
                  {t.role === 'user' ? '🎤' : '🤖'}
                </span>
                <span className="transcript-text">{t.text}</span>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      </div>
      
      {/* Controls */}
      <div className="controls">
        <button 
          className={`control-btn ${isMuted ? 'active' : ''}`}
          onClick={handleMuteToggle}
        >
          {isMuted ? '🔇 Muet' : '🎤 Micro ON'}
        </button>
        
        <button 
          className="control-btn"
          onClick={handleInterrupt}
          disabled={!isBotSpeaking}
        >
          ✋ Interrompre
        </button>
        
        <button 
          className="control-btn"
          onClick={handleForceReply}
        >
          ↩️ Forcer réponse
        </button>
      </div>
      
      {/* Styles */}
      <style jsx>{`
        .drive-thru-screen {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: white;
          font-family: 'Inter', sans-serif;
        }
        
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 2rem;
          background: rgba(255,255,255,0.05);
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .logo img {
          height: 40px;
        }
        
        .status {
          display: flex;
          gap: 1rem;
          align-items: center;
        }
        
        .connection-status.connected {
          color: #4ade80;
        }
        
        .connection-status.disconnected {
          color: #f87171;
        }
        
        .speaking-indicator {
          animation: pulse 1s infinite;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        .error-banner {
          background: #dc2626;
          padding: 0.75rem;
          text-align: center;
        }
        
        .main-content {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          padding: 2rem;
          overflow: hidden;
        }
        
        .order-panel, .transcript-panel {
          background: rgba(255,255,255,0.05);
          border-radius: 1rem;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
        }
        
        .order-panel h2, .transcript-panel h2 {
          margin: 0 0 1rem 0;
          font-size: 1.25rem;
          color: #94a3b8;
        }
        
        .order-items {
          flex: 1;
          overflow-y: auto;
        }
        
        .order-item {
          background: rgba(255,255,255,0.05);
          border-radius: 0.5rem;
          padding: 1rem;
          margin-bottom: 0.75rem;
        }
        
        .item-header {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }
        
        .item-qty {
          background: #f59e0b;
          color: black;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          font-weight: bold;
        }
        
        .item-name {
          flex: 1;
          font-weight: 500;
        }
        
        .item-price {
          color: #4ade80;
          font-weight: bold;
        }
        
        .item-modifiers {
          margin-top: 0.5rem;
          padding-left: 2.5rem;
          color: #94a3b8;
          font-size: 0.875rem;
        }
        
        .modifier {
          display: block;
        }
        
        .order-total {
          display: flex;
          justify-content: space-between;
          padding-top: 1rem;
          border-top: 1px solid rgba(255,255,255,0.1);
          font-size: 1.5rem;
          font-weight: bold;
        }
        
        .total-amount {
          color: #4ade80;
        }
        
        .empty-order {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          color: #64748b;
        }
        
        .empty-order .hint {
          font-size: 0.875rem;
          margin-top: 0.5rem;
        }
        
        .transcript-list {
          flex: 1;
          overflow-y: auto;
        }
        
        .transcript-item {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
          padding: 0.75rem;
          border-radius: 0.5rem;
        }
        
        .transcript-item.user {
          background: rgba(59, 130, 246, 0.2);
        }
        
        .transcript-item.bot {
          background: rgba(16, 185, 129, 0.2);
        }
        
        .transcript-icon {
          font-size: 1.25rem;
        }
        
        .transcript-text {
          flex: 1;
        }
        
        .controls {
          display: flex;
          justify-content: center;
          gap: 1rem;
          padding: 1rem;
          background: rgba(0,0,0,0.3);
        }
        
        .control-btn {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 0.5rem;
          background: rgba(255,255,255,0.1);
          color: white;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .control-btn:hover:not(:disabled) {
          background: rgba(255,255,255,0.2);
        }
        
        .control-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .control-btn.active {
          background: #dc2626;
        }
        
        /* Fallback screen styles */
        .fallback-screen {
          height: 100vh;
          background: #dc2626;
          color: white;
          padding: 2rem;
        }
        
        .fallback-header {
          text-align: center;
          margin-bottom: 2rem;
        }
        
        .fallback-order, .fallback-transcript {
          background: rgba(0,0,0,0.2);
          border-radius: 1rem;
          padding: 1.5rem;
          margin-bottom: 1rem;
        }
      `}</style>
    </div>
  );
}

export default DriveThruScreen;
```

### 2.3.4 Configuration Environment

```typescript
// ============================================
// config.ts - Environment Configuration
// ============================================

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

const DEFAULT_INSTRUCTIONS = `
Tu es l'assistant vocal du drive-thru Quick. Tu aides les clients à passer leur commande.

## RÈGLES DE COMMUNICATION

1. **LANGUE** : Français uniquement. Phrases courtes (< 15 mots). Ton amical et professionnel.
2. **VITESSE** : Parle de manière claire et légèrement rapide.
3. **STYLE** : "C'est noté" après chaque ajout, "Autre chose ?" pour continuer.

## RÈGLES MÉTIER

1. Ne propose JAMAIS de produit absent du catalogue.
2. Ne jamais inventer de prix ou promotion.
3. TOUJOURS récapituler avant confirmation finale.
4. Si question allergènes → transfer_to_human immédiat.

## CATALOGUE PRODUITS

{{CATALOGUE_JSON}}

## RÈGLES MENUS

{{MENU_RULES_JSON}}
`;

export const config = loadConfig();
```

### 2.3.5 Package.json

```json
{
  "name": "quick-voicebot-drive-thru",
  "version": "1.0.0",
  "description": "Production-grade AI voicebot for Quick drive-thru",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fastify/websocket": "^10.0.1",
    "fastify": "^5.0.0",
    "ws": "^8.18.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "zod": "^3.23.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@playwright/test": "^1.45.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

### 2.3.6 Docker Deployment

```dockerfile
# ============================================
# Dockerfile
# ============================================

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Copy static files
COPY public/ ./public/

# Environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
```

```yaml
# ============================================
# docker-compose.yml
# ============================================

version: '3.8'

services:
  voicebot:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MODE=shadow
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_VOICE=marin
      - VAD_THRESHOLD=0.6
      - VAD_SILENCE_DURATION_MS=700
      - POS_API_URL=http://pos-api:8080
      - POS_API_KEY=${POS_API_KEY}
      - METRICS_ENABLED=true
      - LOG_LEVEL=info
    depends_on:
      - redis
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  # Monitoring (optional)
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana
    restart: unless-stopped

volumes:
  redis-data:
  grafana-data:
```

### 2.4 Order Engine — Implémentation Complète

Cette section contient l'implémentation complète et production-ready de l'Order Engine.

#### 2.4.1 Data Models

```typescript
// ============================================
// types.ts - Core Data Models
// ============================================

// ============================================
// PRODUCT TYPES
// ============================================

type ProductCategory = "menu" | "burger" | "side" | "drink" | "dessert" | "sauce" | "extra";

type ProductSize = "small" | "medium" | "large";

interface Product {
  id: string;
  name: string;
  shortName: string;                    // Pour affichage écran et TTS
  category: ProductCategory;
  synonyms: string[];                   // Variantes de noms acceptées
  available: boolean;
  basePrice: number;                    // Centimes (990 = 9.90€)
  sizes?: ProductSizeOption[];
  allergens?: string[];
  ingredients?: string[];
  calories?: number;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
}

interface ProductSizeOption {
  size: ProductSize;
  displayName: string;                  // "Petit" / "Moyen" / "Grand"
  priceModifier: number;                // Centimes à ajouter/soustraire
}

// ============================================
// MENU RULES
// ============================================

interface MenuRule {
  menuProductId: string;
  name: string;
  requiredComponents: MenuComponent[];
  optionalComponents?: MenuComponent[];
  incompatibleProducts?: string[];      // IDs de produits incompatibles
  maxTotalItems?: number;               // Limite d'items dans le menu
}

interface MenuComponent {
  type: "side" | "drink" | "dessert" | "sauce";
  displayName: string;                  // "Accompagnement", "Boisson"
  min: number;                          // Minimum requis (1 pour obligatoire)
  max: number;                          // Maximum autorisé
  allowedProductIds: string[];          // IDs des produits autorisés
  defaultProductId: string;             // Défaut si non spécifié
  priceIncluded: boolean;               // Inclus dans le prix menu
  upgradeOptions?: UpgradeOption[];     // Suppléments possibles
}

interface UpgradeOption {
  productId: string;
  extraPrice: number;                   // Supplément en centimes
  description?: string;
}

// ============================================
// ORDER TYPES
// ============================================

interface OrderItem {
  id: string;                           // UUID unique pour cette ligne
  productId: string;
  name: string;
  shortName: string;
  category: ProductCategory;
  qty: number;
  size?: ProductSize;
  unitPrice: number;                    // Prix unitaire en centimes
  linePrice: number;                    // Prix ligne (unitPrice * qty)
  modifiers: OrderItemModifier[];
  customizations?: OrderCustomization[];
  notes?: string;
  addedAt: number;                      // Timestamp
}

interface OrderItemModifier {
  id: string;
  type: "side" | "drink" | "dessert" | "sauce";
  productId: string;
  name: string;
  extraPrice: number;                   // 0 si inclus, sinon supplément
}

interface OrderCustomization {
  id: string;
  type: "remove_ingredient" | "add_ingredient" | "extra" | "less" | "allergy";
  ingredient: string;
  extraPrice: number;
  notes?: string;
}

type OrderStatus = 
  | "draft"                             // En construction
  | "confirmed"                         // Confirmé par client
  | "sent_to_pos"                       // Envoyé au POS
  | "accepted"                          // Accepté par POS
  | "rejected"                          // Rejeté par POS
  | "preparing"                         // En préparation
  | "ready"                             // Prêt
  | "delivered"                         // Livré
  | "paid"                              // Payé
  | "cancelled";                        // Annulé

interface Order {
  id: string;                           // UUID
  sessionId: string;                    // ID de la session drive-thru
  storeId: string;
  laneId?: string;
  items: OrderItem[];
  subtotal: number;                     // Sous-total en centimes
  tax: number;                          // TVA en centimes
  discounts: OrderDiscount[];
  total: number;                        // Total TTC en centimes
  currency: "EUR";
  status: OrderStatus;
  posOrderId?: string;                  // ID retourné par le POS
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  metadata?: Record<string, unknown>;
}

interface OrderDiscount {
  id: string;
  code?: string;
  description: string;
  type: "percentage" | "fixed";
  value: number;                        // Pourcentage ou centimes
  appliedAmount: number;                // Montant effectivement déduit
}

// ============================================
// VALIDATION & ERRORS
// ============================================

interface ValidationError {
  code: string;
  message: string;                      // Message technique (logs)
  messageFr: string;                    // Message client-friendly en français
  field?: string;
  details?: Record<string, unknown>;
  recoverable: boolean;                 // Peut-on corriger automatiquement ?
  suggestion?: string;                  // Suggestion de correction
  suggestedAction?: "ask_clarification" | "propose_alternative" | "remove_item" | "transfer_human";
}

interface OrderEngineResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  warnings?: string[];
}

// ============================================
// PARSED INPUT (from NLU)
// ============================================

interface ParsedOrderItem {
  productId?: string;                   // Si déjà résolu
  productName: string;                  // Nom tel que compris
  quantity: number;
  size?: ProductSize;
  modifiers?: ParsedModifier[];
  customizations?: ParsedCustomization[];
}

interface ParsedModifier {
  type: "side" | "drink" | "dessert" | "sauce";
  productId?: string;
  productName: string;
}

interface ParsedCustomization {
  type: "remove_ingredient" | "add_ingredient" | "extra" | "less";
  ingredient: string;
}

interface OrderModification {
  type: "change_side" | "change_drink" | "change_size" | "add_sauce" | 
        "remove_ingredient" | "add_ingredient" | "change_quantity";
  itemId?: string;
  itemIndex?: number;
  newValue: string | number;
  modifierIndex?: number;
}

export {
  ProductCategory,
  ProductSize,
  Product,
  ProductSizeOption,
  MenuRule,
  MenuComponent,
  UpgradeOption,
  OrderItem,
  OrderItemModifier,
  OrderCustomization,
  OrderStatus,
  Order,
  OrderDiscount,
  ValidationError,
  OrderEngineResult,
  ParsedOrderItem,
  ParsedModifier,
  ParsedCustomization,
  OrderModification
};
```

#### 2.4.2 Order Engine — Core Implementation

```typescript
// ============================================
// order-engine.ts - Complete Order Engine
// ============================================

import { randomUUID } from 'crypto';
import {
  Product,
  ProductCategory,
  ProductSize,
  MenuRule,
  MenuComponent,
  Order,
  OrderItem,
  OrderItemModifier,
  OrderCustomization,
  OrderDiscount,
  ValidationError,
  OrderEngineResult,
  ParsedOrderItem,
  ParsedModifier,
  OrderModification
} from './types';

// ============================================
// CONSTANTS
// ============================================

// TVA France - Restauration rapide à emporter
const TAX_RATE_TAKEAWAY = 0.055;  // 5.5%
const TAX_RATE_EAT_IN = 0.10;    // 10%

// Limites
const MAX_QUANTITY_PER_ITEM = 10;
const MAX_ITEMS_PER_ORDER = 50;
const MAX_ORDER_TOTAL = 50000;   // 500€ max

// ============================================
// ORDER ENGINE CLASS
// ============================================

export class OrderEngine {
  
  // ============================================
  // ORDER CREATION
  // ============================================
  
  /**
   * Crée une commande vide
   */
  createEmptyOrder(sessionId: string, storeId: string, laneId?: string): Order {
    const now = Date.now();
    
    return {
      id: randomUUID(),
      sessionId,
      storeId,
      laneId,
      items: [],
      subtotal: 0,
      tax: 0,
      discounts: [],
      total: 0,
      currency: "EUR",
      status: "draft",
      createdAt: now,
      updatedAt: now
    };
  }
  
  // ============================================
  // ADD ITEM
  // ============================================
  
  /**
   * Ajoute un item à la commande
   * 
   * @param order - Commande actuelle
   * @param parsedItem - Item parsé depuis le NLU
   * @param catalogue - Catalogue produits
   * @param menuRules - Règles des menus
   * @returns Nouvelle commande ou erreurs
   */
  addItemToOrder(
    order: Order,
    parsedItem: ParsedOrderItem,
    catalogue: Product[],
    menuRules: MenuRule[]
  ): OrderEngineResult<Order> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];
    
    // 1. Résoudre le produit
    const product = this.resolveProduct(parsedItem, catalogue);
    
    if (!product) {
      return {
        success: false,
        errors: [{
          code: 'PRODUCT_NOT_FOUND',
          message: `Product not found: ${parsedItem.productName}`,
          messageFr: `Désolé, je ne trouve pas "${parsedItem.productName}" dans notre menu.`,
          recoverable: false,
          suggestedAction: 'ask_clarification'
        }]
      };
    }
    
    // 2. Vérifier la disponibilité
    if (!product.available) {
      const alternatives = this.findAlternatives(product, catalogue);
      return {
        success: false,
        errors: [{
          code: 'PRODUCT_UNAVAILABLE',
          message: `Product unavailable: ${product.name}`,
          messageFr: `Désolé, ${product.name} n'est plus disponible.`,
          recoverable: true,
          suggestion: alternatives.length > 0 
            ? `Puis-je vous proposer ${alternatives[0].name} à la place ?`
            : undefined,
          suggestedAction: 'propose_alternative',
          details: { alternatives: alternatives.map(p => p.name) }
        }]
      };
    }
    
    // 3. Valider la quantité
    const quantity = parsedItem.quantity || 1;
    if (quantity < 1 || quantity > MAX_QUANTITY_PER_ITEM) {
      return {
        success: false,
        errors: [{
          code: 'INVALID_QUANTITY',
          message: `Invalid quantity: ${quantity}`,
          messageFr: `La quantité doit être entre 1 et ${MAX_QUANTITY_PER_ITEM}.`,
          recoverable: true,
          suggestedAction: 'ask_clarification'
        }]
      };
    }
    
    // 4. Vérifier le nombre max d'items
    if (order.items.length >= MAX_ITEMS_PER_ORDER) {
      return {
        success: false,
        errors: [{
          code: 'ORDER_TOO_LARGE',
          message: 'Order has too many items',
          messageFr: 'La commande contient trop d\'articles.',
          recoverable: false,
          suggestedAction: 'transfer_human'
        }]
      };
    }
    
    // 5. Calculer le prix de base
    let unitPrice = product.basePrice;
    
    // 6. Appliquer la taille si spécifiée
    if (parsedItem.size && product.sizes) {
      const sizeOption = product.sizes.find(s => s.size === parsedItem.size);
      if (sizeOption) {
        unitPrice += sizeOption.priceModifier;
      }
    }
    
    // 7. Traiter les modifiers (accompagnements, boissons, etc.)
    const modifiers: OrderItemModifier[] = [];
    
    if (product.category === 'menu') {
      // C'est un menu - traiter les composants
      const menuRule = menuRules.find(r => r.menuProductId === product.id);
      
      if (menuRule) {
        const modifierResult = this.processMenuModifiers(
          parsedItem.modifiers || [],
          menuRule,
          catalogue
        );
        
        if (!modifierResult.success) {
          return modifierResult as OrderEngineResult<Order>;
        }
        
        modifiers.push(...modifierResult.data!.modifiers);
        unitPrice += modifierResult.data!.extraPrice;
        
        if (modifierResult.warnings) {
          warnings.push(...modifierResult.warnings);
        }
      }
    } else if (parsedItem.modifiers && parsedItem.modifiers.length > 0) {
      // Produit simple avec sauces
      for (const mod of parsedItem.modifiers) {
        if (mod.type === 'sauce') {
          const sauceResult = this.processSauceModifier(mod, catalogue);
          if (sauceResult.success && sauceResult.data) {
            modifiers.push(sauceResult.data);
            unitPrice += sauceResult.data.extraPrice;
          }
        }
      }
    }
    
    // 8. Traiter les customizations (Phase 2)
    const customizations: OrderCustomization[] = [];
    // TODO: Implémenter pour Phase 2
    
    // 9. Créer l'item
    const linePrice = unitPrice * quantity;
    
    const newItem: OrderItem = {
      id: randomUUID(),
      productId: product.id,
      name: product.name,
      shortName: product.shortName,
      category: product.category,
      qty: quantity,
      size: parsedItem.size,
      unitPrice,
      linePrice,
      modifiers,
      customizations,
      addedAt: Date.now()
    };
    
    // 10. Créer la nouvelle commande
    const newOrder: Order = {
      ...order,
      items: [...order.items, newItem],
      updatedAt: Date.now()
    };
    
    // 11. Recalculer les totaux
    this.recalculateTotals(newOrder);
    
    // 12. Vérifier le total max
    if (newOrder.total > MAX_ORDER_TOTAL) {
      return {
        success: false,
        errors: [{
          code: 'ORDER_TOTAL_EXCEEDED',
          message: `Order total exceeds maximum: ${newOrder.total}`,
          messageFr: 'Le montant total de la commande est trop élevé.',
          recoverable: false,
          suggestedAction: 'transfer_human'
        }]
      };
    }
    
    return {
      success: true,
      data: newOrder,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
  
  // ============================================
  // MODIFY ITEM
  // ============================================
  
  /**
   * Modifie un item existant dans la commande
   */
  modifyItemInOrder(
    order: Order,
    modification: OrderModification,
    catalogue: Product[],
    menuRules: MenuRule[]
  ): OrderEngineResult<Order> {
    // Trouver l'item
    let itemIndex = modification.itemIndex;
    
    if (itemIndex === undefined && modification.itemId) {
      itemIndex = order.items.findIndex(item => item.id === modification.itemId);
    }
    
    if (itemIndex === undefined || itemIndex < 0 || itemIndex >= order.items.length) {
      return {
        success: false,
        errors: [{
          code: 'ITEM_NOT_FOUND',
          message: 'Item not found in order',
          messageFr: 'Je ne trouve pas cet article dans votre commande.',
          recoverable: true,
          suggestedAction: 'ask_clarification'
        }]
      };
    }
    
    const item = order.items[itemIndex];
    let updatedItem = { ...item };
    
    switch (modification.type) {
      case 'change_quantity':
        const newQty = typeof modification.newValue === 'number' 
          ? modification.newValue 
          : parseInt(modification.newValue as string);
          
        if (isNaN(newQty) || newQty < 1 || newQty > MAX_QUANTITY_PER_ITEM) {
          return {
            success: false,
            errors: [{
              code: 'INVALID_QUANTITY',
              message: `Invalid quantity: ${newQty}`,
              messageFr: `La quantité doit être entre 1 et ${MAX_QUANTITY_PER_ITEM}.`,
              recoverable: true,
              suggestedAction: 'ask_clarification'
            }]
          };
        }
        
        updatedItem.qty = newQty;
        updatedItem.linePrice = updatedItem.unitPrice * newQty;
        break;
        
      case 'change_size':
        const product = catalogue.find(p => p.id === item.productId);
        if (!product?.sizes) {
          return {
            success: false,
            errors: [{
              code: 'SIZE_NOT_AVAILABLE',
              message: 'Size options not available for this product',
              messageFr: 'Ce produit n\'est pas disponible en différentes tailles.',
              recoverable: false
            }]
          };
        }
        
        const newSize = modification.newValue as ProductSize;
        const sizeOption = product.sizes.find(s => s.size === newSize);
        
        if (!sizeOption) {
          return {
            success: false,
            errors: [{
              code: 'INVALID_SIZE',
              message: `Invalid size: ${newSize}`,
              messageFr: `Taille "${newSize}" non disponible.`,
              recoverable: true,
              suggestedAction: 'ask_clarification'
            }]
          };
        }
        
        // Recalculer le prix avec la nouvelle taille
        const oldSizeOption = product.sizes.find(s => s.size === item.size);
        const priceDiff = sizeOption.priceModifier - (oldSizeOption?.priceModifier || 0);
        
        updatedItem.size = newSize;
        updatedItem.unitPrice += priceDiff;
        updatedItem.linePrice = updatedItem.unitPrice * updatedItem.qty;
        break;
        
      case 'change_side':
      case 'change_drink':
        if (item.category !== 'menu') {
          return {
            success: false,
            errors: [{
              code: 'NOT_A_MENU',
              message: 'Item is not a menu',
              messageFr: 'Cet article n\'est pas un menu.',
              recoverable: false
            }]
          };
        }
        
        const modType = modification.type === 'change_side' ? 'side' : 'drink';
        const modIndex = modification.modifierIndex ?? 
          item.modifiers.findIndex(m => m.type === modType);
        
        if (modIndex < 0) {
          return {
            success: false,
            errors: [{
              code: 'MODIFIER_NOT_FOUND',
              message: `No ${modType} modifier found`,
              messageFr: `Pas de ${modType === 'side' ? 'accompagnement' : 'boisson'} à modifier.`,
              recoverable: false
            }]
          };
        }
        
        // Trouver le nouveau produit
        const newModProduct = this.resolveProduct(
          { productName: modification.newValue as string, quantity: 1 },
          catalogue.filter(p => p.category === modType)
        );
        
        if (!newModProduct) {
          return {
            success: false,
            errors: [{
              code: 'PRODUCT_NOT_FOUND',
              message: `${modType} not found: ${modification.newValue}`,
              messageFr: `Je ne trouve pas "${modification.newValue}".`,
              recoverable: true,
              suggestedAction: 'ask_clarification'
            }]
          };
        }
        
        // Calculer la différence de prix
        const oldModifier = item.modifiers[modIndex];
        const menuRule = menuRules.find(r => r.menuProductId === item.productId);
        const component = menuRule?.requiredComponents.find(c => c.type === modType);
        
        let newExtraPrice = 0;
        if (component && !component.allowedProductIds.includes(newModProduct.id)) {
          // Vérifier si c'est un upgrade
          const upgrade = component.upgradeOptions?.find(u => u.productId === newModProduct.id);
          if (upgrade) {
            newExtraPrice = upgrade.extraPrice;
          } else {
            return {
              success: false,
              errors: [{
                code: 'PRODUCT_NOT_ALLOWED',
                message: `${newModProduct.name} not allowed in this menu`,
                messageFr: `${newModProduct.name} n'est pas disponible dans ce menu.`,
                recoverable: true,
                suggestedAction: 'propose_alternative'
              }]
            };
          }
        }
        
        // Mettre à jour le modifier
        const newModifier: OrderItemModifier = {
          id: randomUUID(),
          type: modType,
          productId: newModProduct.id,
          name: newModProduct.name,
          extraPrice: newExtraPrice
        };
        
        updatedItem.modifiers = [...item.modifiers];
        updatedItem.modifiers[modIndex] = newModifier;
        
        // Recalculer le prix
        const priceDelta = newExtraPrice - oldModifier.extraPrice;
        updatedItem.unitPrice += priceDelta;
        updatedItem.linePrice = updatedItem.unitPrice * updatedItem.qty;
        break;
        
      case 'add_sauce':
        const sauceProduct = this.resolveProduct(
          { productName: modification.newValue as string, quantity: 1 },
          catalogue.filter(p => p.category === 'sauce')
        );
        
        if (!sauceProduct) {
          return {
            success: false,
            errors: [{
              code: 'SAUCE_NOT_FOUND',
              message: `Sauce not found: ${modification.newValue}`,
              messageFr: `Je ne trouve pas la sauce "${modification.newValue}".`,
              recoverable: true,
              suggestedAction: 'ask_clarification'
            }]
          };
        }
        
        // Vérifier si la sauce n'est pas déjà présente
        if (item.modifiers.some(m => m.productId === sauceProduct.id)) {
          return {
            success: false,
            errors: [{
              code: 'SAUCE_ALREADY_ADDED',
              message: 'Sauce already in order',
              messageFr: `La sauce ${sauceProduct.name} est déjà dans votre commande.`,
              recoverable: false
            }]
          };
        }
        
        const newSauceModifier: OrderItemModifier = {
          id: randomUUID(),
          type: 'sauce',
          productId: sauceProduct.id,
          name: sauceProduct.name,
          extraPrice: sauceProduct.basePrice
        };
        
        updatedItem.modifiers = [...item.modifiers, newSauceModifier];
        updatedItem.unitPrice += sauceProduct.basePrice;
        updatedItem.linePrice = updatedItem.unitPrice * updatedItem.qty;
        break;
        
      default:
        return {
          success: false,
          errors: [{
            code: 'UNKNOWN_MODIFICATION',
            message: `Unknown modification type: ${modification.type}`,
            messageFr: 'Type de modification non reconnu.',
            recoverable: false
          }]
        };
    }
    
    // Créer la nouvelle commande avec l'item modifié
    const newItems = [...order.items];
    newItems[itemIndex] = updatedItem;
    
    const newOrder: Order = {
      ...order,
      items: newItems,
      updatedAt: Date.now()
    };
    
    this.recalculateTotals(newOrder);
    
    return {
      success: true,
      data: newOrder
    };
  }
  
  // ============================================
  // REMOVE ITEM
  // ============================================
  
  /**
   * Supprime un item de la commande
   */
  removeItemFromOrder(
    order: Order,
    itemIndexOrId: number | string
  ): OrderEngineResult<Order> {
    let itemIndex: number;
    
    if (typeof itemIndexOrId === 'string') {
      itemIndex = order.items.findIndex(item => item.id === itemIndexOrId);
    } else {
      itemIndex = itemIndexOrId;
    }
    
    if (itemIndex < 0 || itemIndex >= order.items.length) {
      return {
        success: false,
        errors: [{
          code: 'ITEM_NOT_FOUND',
          message: 'Item not found in order',
          messageFr: 'Je ne trouve pas cet article dans votre commande.',
          recoverable: true,
          suggestedAction: 'ask_clarification'
        }]
      };
    }
    
    const removedItem = order.items[itemIndex];
    const newItems = order.items.filter((_, i) => i !== itemIndex);
    
    const newOrder: Order = {
      ...order,
      items: newItems,
      updatedAt: Date.now()
    };
    
    this.recalculateTotals(newOrder);
    
    return {
      success: true,
      data: newOrder,
      warnings: [`${removedItem.name} retiré de la commande`]
    };
  }
  
  /**
   * Supprime un item par nom de produit
   */
  removeItemByName(
    order: Order,
    productName: string,
    catalogue: Product[]
  ): OrderEngineResult<Order> {
    const normalizedName = this.normalizeString(productName);
    
    // Chercher l'item correspondant
    const itemIndex = order.items.findIndex(item => {
      const itemNameNorm = this.normalizeString(item.name);
      return itemNameNorm.includes(normalizedName) || normalizedName.includes(itemNameNorm);
    });
    
    if (itemIndex < 0) {
      // Essayer de résoudre via le catalogue
      const product = this.resolveProduct({ productName, quantity: 1 }, catalogue);
      if (product) {
        const idx = order.items.findIndex(item => item.productId === product.id);
        if (idx >= 0) {
          return this.removeItemFromOrder(order, idx);
        }
      }
      
      return {
        success: false,
        errors: [{
          code: 'ITEM_NOT_FOUND',
          message: `Item not found: ${productName}`,
          messageFr: `Je ne trouve pas "${productName}" dans votre commande.`,
          recoverable: true,
          suggestedAction: 'ask_clarification'
        }]
      };
    }
    
    return this.removeItemFromOrder(order, itemIndex);
  }
  
  // ============================================
  // VALIDATE ORDER
  // ============================================
  
  /**
   * Valide la commande complète avant envoi au POS
   */
  validateOrder(
    order: Order,
    catalogue: Product[],
    menuRules: MenuRule[]
  ): OrderEngineResult<{ valid: boolean; errors: ValidationError[] }> {
    const errors: ValidationError[] = [];
    
    // 1. Vérifier qu'il y a au moins un item
    if (order.items.length === 0) {
      errors.push({
        code: 'EMPTY_ORDER',
        message: 'Order is empty',
        messageFr: 'Votre commande est vide.',
        recoverable: true,
        suggestedAction: 'ask_clarification'
      });
    }
    
    // 2. Vérifier chaque item
    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      
      // Vérifier que le produit existe
      const product = catalogue.find(p => p.id === item.productId);
      if (!product) {
        errors.push({
          code: 'PRODUCT_NOT_IN_CATALOGUE',
          message: `Product ${item.productId} not found`,
          messageFr: `${item.name} n'est plus disponible dans notre menu.`,
          field: `items[${i}].productId`,
          recoverable: true,
          suggestedAction: 'remove_item'
        });
        continue;
      }
      
      // Vérifier la disponibilité
      if (!product.available) {
        errors.push({
          code: 'PRODUCT_UNAVAILABLE',
          message: `Product ${product.name} is unavailable`,
          messageFr: `${product.name} n'est plus disponible.`,
          field: `items[${i}]`,
          recoverable: true,
          suggestedAction: 'propose_alternative'
        });
      }
      
      // Vérifier la quantité
      if (item.qty < 1 || item.qty > MAX_QUANTITY_PER_ITEM) {
        errors.push({
          code: 'INVALID_QUANTITY',
          message: `Invalid quantity for ${item.name}: ${item.qty}`,
          messageFr: `Quantité invalide pour ${item.name}.`,
          field: `items[${i}].qty`,
          recoverable: true,
          suggestedAction: 'ask_clarification'
        });
      }
      
      // Si c'est un menu, vérifier les composants
      if (product.category === 'menu') {
        const menuRule = menuRules.find(r => r.menuProductId === product.id);
        
        if (menuRule) {
          const menuErrors = this.validateMenuComponents(item, menuRule, catalogue);
          errors.push(...menuErrors.map(e => ({
            ...e,
            field: `items[${i}]`
          })));
        }
      }
      
      // Vérifier la cohérence du prix
      const expectedPrice = this.calculateItemPrice(item, product, menuRules, catalogue);
      if (Math.abs(item.linePrice - expectedPrice) > 1) { // Tolérance de 1 centime
        errors.push({
          code: 'PRICE_MISMATCH',
          message: `Price mismatch for ${item.name}: expected ${expectedPrice}, got ${item.linePrice}`,
          messageFr: `Erreur de prix pour ${item.name}.`,
          field: `items[${i}].linePrice`,
          recoverable: true,
          details: { expected: expectedPrice, actual: item.linePrice }
        });
      }
    }
    
    // 3. Vérifier le total
    const expectedTotal = this.calculateOrderTotal(order);
    if (Math.abs(order.total - expectedTotal) > 1) {
      errors.push({
        code: 'TOTAL_MISMATCH',
        message: `Total mismatch: expected ${expectedTotal}, got ${order.total}`,
        messageFr: 'Erreur dans le calcul du total.',
        recoverable: true,
        details: { expected: expectedTotal, actual: order.total }
      });
    }
    
    // 4. Vérifier les limites
    if (order.total > MAX_ORDER_TOTAL) {
      errors.push({
        code: 'ORDER_TOTAL_EXCEEDED',
        message: `Order total exceeds maximum: ${order.total}`,
        messageFr: 'Le montant total dépasse la limite autorisée.',
        recoverable: false,
        suggestedAction: 'transfer_human'
      });
    }
    
    if (order.items.length > MAX_ITEMS_PER_ORDER) {
      errors.push({
        code: 'TOO_MANY_ITEMS',
        message: `Too many items: ${order.items.length}`,
        messageFr: 'La commande contient trop d\'articles.',
        recoverable: false,
        suggestedAction: 'transfer_human'
      });
    }
    
    return {
      success: true,
      data: {
        valid: errors.length === 0,
        errors
      }
    };
  }
  
  /**
   * Valide les composants d'un menu
   */
  private validateMenuComponents(
    item: OrderItem,
    menuRule: MenuRule,
    catalogue: Product[]
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    
    for (const component of menuRule.requiredComponents) {
      const modifiersOfType = item.modifiers.filter(m => m.type === component.type);
      
      // Vérifier le minimum
      if (modifiersOfType.length < component.min) {
        const componentName = component.type === 'side' ? 'accompagnement' :
                             component.type === 'drink' ? 'boisson' :
                             component.type === 'dessert' ? 'dessert' : component.type;
        errors.push({
          code: 'MISSING_MENU_COMPONENT',
          message: `Menu ${item.name} missing ${component.type}`,
          messageFr: `Il manque ${component.min === 1 ? 'un' : component.min} ${componentName} pour le ${item.name}.`,
          recoverable: true,
          suggestedAction: 'ask_clarification',
          details: { 
            missingType: component.type, 
            required: component.min, 
            current: modifiersOfType.length 
          }
        });
      }
      
      // Vérifier le maximum
      if (modifiersOfType.length > component.max) {
        errors.push({
          code: 'TOO_MANY_COMPONENTS',
          message: `Menu ${item.name} has too many ${component.type}`,
          messageFr: `Trop de ${component.type} pour le ${item.name}.`,
          recoverable: true,
          suggestedAction: 'ask_clarification',
          details: { 
            type: component.type, 
            max: component.max, 
            current: modifiersOfType.length 
          }
        });
      }
      
      // Vérifier que les produits sont autorisés
      for (const mod of modifiersOfType) {
        const isAllowed = component.allowedProductIds.includes(mod.productId);
        const isUpgrade = component.upgradeOptions?.some(u => u.productId === mod.productId);
        
        if (!isAllowed && !isUpgrade) {
          const product = catalogue.find(p => p.id === mod.productId);
          errors.push({
            code: 'PRODUCT_NOT_ALLOWED_IN_MENU',
            message: `${mod.name} not allowed in menu ${item.name}`,
            messageFr: `${mod.name} n'est pas disponible dans ce menu.`,
            recoverable: true,
            suggestedAction: 'propose_alternative',
            details: { productId: mod.productId, productName: mod.name }
          });
        }
      }
    }
    
    return errors;
  }
  
  // ============================================
  // PRICE CALCULATION
  // ============================================
  
  /**
   * Recalcule tous les totaux de la commande
   */
  recalculateTotals(order: Order): void {
    // Calculer le sous-total
    order.subtotal = order.items.reduce((sum, item) => sum + item.linePrice, 0);
    
    // Appliquer les réductions
    let discountTotal = 0;
    for (const discount of order.discounts) {
      if (discount.type === 'percentage') {
        discount.appliedAmount = Math.round(order.subtotal * discount.value / 100);
      } else {
        discount.appliedAmount = Math.min(discount.value, order.subtotal - discountTotal);
      }
      discountTotal += discount.appliedAmount;
    }
    
    // Calculer la TVA (5.5% à emporter)
    const subtotalAfterDiscount = order.subtotal - discountTotal;
    order.tax = Math.round(subtotalAfterDiscount * TAX_RATE_TAKEAWAY);
    
    // Total TTC
    order.total = subtotalAfterDiscount;
  }
  
  /**
   * Calcule le prix attendu d'un item
   */
  private calculateItemPrice(
    item: OrderItem,
    product: Product,
    menuRules: MenuRule[],
    catalogue: Product[]
  ): number {
    let unitPrice = product.basePrice;
    
    // Ajouter le modificateur de taille
    if (item.size && product.sizes) {
      const sizeOption = product.sizes.find(s => s.size === item.size);
      if (sizeOption) {
        unitPrice += sizeOption.priceModifier;
      }
    }
    
    // Ajouter les suppléments des modifiers
    for (const mod of item.modifiers) {
      unitPrice += mod.extraPrice;
    }
    
    // Ajouter les customizations
    for (const custom of item.customizations || []) {
      unitPrice += custom.extraPrice;
    }
    
    return unitPrice * item.qty;
  }
  
  /**
   * Calcule le total attendu de la commande
   */
  private calculateOrderTotal(order: Order): number {
    const subtotal = order.items.reduce((sum, item) => sum + item.linePrice, 0);
    const discounts = order.discounts.reduce((sum, d) => sum + d.appliedAmount, 0);
    return subtotal - discounts;
  }
  
  // ============================================
  // ORDER SUMMARY
  // ============================================
  
  /**
   * Génère un résumé vocal de la commande
   */
  generateOrderSummary(order: Order, format: 'short' | 'full'): string {
    if (order.items.length === 0) {
      return "Votre commande est vide.";
    }
    
    if (format === 'short') {
      // Format court pour confirmation rapide
      const itemsSummary = order.items.map(item => {
        if (item.qty > 1) {
          return `${item.qty} ${item.shortName}`;
        }
        return item.shortName;
      }).join(', ');
      
      return `${itemsSummary}, total ${this.formatPrice(order.total)}.`;
    }
    
    // Format complet avec détails
    const lines: string[] = [];
    
    for (const item of order.items) {
      let line = item.qty > 1 ? `${item.qty} ${item.name}` : item.name;
      
      // Ajouter la taille
      if (item.size) {
        const sizeName = item.size === 'small' ? 'petit' :
                        item.size === 'medium' ? 'moyen' : 'grand';
        line += ` ${sizeName}`;
      }
      
      // Ajouter les modifiers pour les menus
      if (item.category === 'menu' && item.modifiers.length > 0) {
        const mods = item.modifiers.map(m => m.name).join(', ');
        line += ` avec ${mods}`;
      }
      
      // Ajouter les sauces pour les autres produits
      const sauces = item.modifiers.filter(m => m.type === 'sauce');
      if (item.category !== 'menu' && sauces.length > 0) {
        line += ` avec sauce ${sauces.map(s => s.name).join(' et ')}`;
      }
      
      line += ` à ${this.formatPrice(item.linePrice)}`;
      lines.push(line);
    }
    
    lines.push(`Total: ${this.formatPrice(order.total)}`);
    
    return lines.join('. ');
  }
  
  /**
   * Génère un résumé JSON pour l'affichage
   */
  generateOrderDisplayData(order: Order): object {
    return {
      items: order.items.map(item => ({
        name: item.name,
        quantity: item.qty,
        size: item.size,
        modifiers: item.modifiers.map(m => ({
          type: m.type,
          name: m.name,
          extraPrice: m.extraPrice > 0 ? this.formatPrice(m.extraPrice) : null
        })),
        price: this.formatPrice(item.linePrice)
      })),
      subtotal: this.formatPrice(order.subtotal),
      discounts: order.discounts.map(d => ({
        description: d.description,
        amount: `-${this.formatPrice(d.appliedAmount)}`
      })),
      total: this.formatPrice(order.total),
      itemCount: order.items.reduce((sum, item) => sum + item.qty, 0)
    };
  }
  
  // ============================================
  // PRODUCT RESOLUTION
  // ============================================
  
  /**
   * Résout un nom de produit vers un produit du catalogue
   */
  private resolveProduct(
    parsedItem: ParsedOrderItem,
    catalogue: Product[]
  ): Product | null {
    // Si l'ID est déjà fourni
    if (parsedItem.productId) {
      return catalogue.find(p => p.id === parsedItem.productId) || null;
    }
    
    const searchName = this.normalizeString(parsedItem.productName);
    
    // 1. Recherche exacte par nom
    let product = catalogue.find(p => 
      this.normalizeString(p.name) === searchName ||
      this.normalizeString(p.shortName) === searchName
    );
    
    if (product) return product;
    
    // 2. Recherche par synonymes
    product = catalogue.find(p => 
      p.synonyms.some(s => this.normalizeString(s) === searchName)
    );
    
    if (product) return product;
    
    // 3. Recherche partielle
    product = catalogue.find(p => 
      this.normalizeString(p.name).includes(searchName) ||
      searchName.includes(this.normalizeString(p.name)) ||
      p.synonyms.some(s => 
        this.normalizeString(s).includes(searchName) ||
        searchName.includes(this.normalizeString(s))
      )
    );
    
    if (product) return product;
    
    // 4. Recherche fuzzy (Levenshtein)
    const threshold = 0.75;
    let bestMatch: { product: Product; score: number } | null = null;
    
    for (const p of catalogue) {
      const names = [p.name, p.shortName, ...p.synonyms];
      
      for (const name of names) {
        const score = this.similarityScore(searchName, this.normalizeString(name));
        
        if (score > threshold && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { product: p, score };
        }
      }
    }
    
    return bestMatch?.product || null;
  }
  
  /**
   * Trouve des alternatives à un produit indisponible
   */
  private findAlternatives(product: Product, catalogue: Product[]): Product[] {
    return catalogue
      .filter(p => 
        p.id !== product.id &&
        p.category === product.category &&
        p.available &&
        Math.abs(p.basePrice - product.basePrice) < 300 // ±3€
      )
      .slice(0, 3);
  }
  
  // ============================================
  // MENU MODIFIERS PROCESSING
  // ============================================
  
  /**
   * Traite les modifiers d'un menu
   */
  private processMenuModifiers(
    parsedModifiers: ParsedModifier[],
    menuRule: MenuRule,
    catalogue: Product[]
  ): OrderEngineResult<{ modifiers: OrderItemModifier[]; extraPrice: number }> {
    const modifiers: OrderItemModifier[] = [];
    let extraPrice = 0;
    const warnings: string[] = [];
    
    for (const component of menuRule.requiredComponents) {
      // Chercher le modifier correspondant dans les parsedModifiers
      const parsed = parsedModifiers.find(m => m.type === component.type);
      
      let productId: string;
      let productName: string;
      let modExtraPrice = 0;
      
      if (parsed) {
        // Résoudre le produit spécifié
        const product = this.resolveProduct(
          { productName: parsed.productName, quantity: 1 },
          catalogue.filter(p => p.category === component.type)
        );
        
        if (!product) {
          return {
            success: false,
            errors: [{
              code: 'MODIFIER_NOT_FOUND',
              message: `${component.type} not found: ${parsed.productName}`,
              messageFr: `Je ne trouve pas "${parsed.productName}".`,
              recoverable: true,
              suggestedAction: 'ask_clarification'
            }]
          };
        }
        
        // Vérifier si autorisé
        if (!component.allowedProductIds.includes(product.id)) {
          // Vérifier si c'est un upgrade
          const upgrade = component.upgradeOptions?.find(u => u.productId === product.id);
          
          if (!upgrade) {
            return {
              success: false,
              errors: [{
                code: 'PRODUCT_NOT_ALLOWED',
                message: `${product.name} not allowed as ${component.type}`,
                messageFr: `${product.name} n'est pas disponible comme ${component.displayName.toLowerCase()}.`,
                recoverable: true,
                suggestedAction: 'propose_alternative',
                details: {
                  allowed: component.allowedProductIds.map(id => 
                    catalogue.find(p => p.id === id)?.name
                  ).filter(Boolean)
                }
              }]
            };
          }
          
          modExtraPrice = upgrade.extraPrice;
          warnings.push(`Supplément ${this.formatPrice(modExtraPrice)} pour ${product.name}`);
        }
        
        productId = product.id;
        productName = product.name;
        
      } else if (component.min > 0) {
        // Composant requis non spécifié - utiliser le défaut
        const defaultProduct = catalogue.find(p => p.id === component.defaultProductId);
        
        if (!defaultProduct) {
          return {
            success: false,
            errors: [{
              code: 'MISSING_REQUIRED_COMPONENT',
              message: `Missing required ${component.type}`,
              messageFr: `Quel ${component.displayName.toLowerCase()} souhaitez-vous ?`,
              recoverable: true,
              suggestedAction: 'ask_clarification',
              details: {
                componentType: component.type,
                options: component.allowedProductIds.map(id =>
                  catalogue.find(p => p.id === id)?.name
                ).filter(Boolean)
              }
            }]
          };
        }
        
        productId = defaultProduct.id;
        productName = defaultProduct.name;
      } else {
        // Composant optionnel non spécifié - skip
        continue;
      }
      
      modifiers.push({
        id: randomUUID(),
        type: component.type,
        productId,
        name: productName,
        extraPrice: modExtraPrice
      });
      
      extraPrice += modExtraPrice;
    }
    
    return {
      success: true,
      data: { modifiers, extraPrice },
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
  
  /**
   * Traite une sauce
   */
  private processSauceModifier(
    parsed: ParsedModifier,
    catalogue: Product[]
  ): OrderEngineResult<OrderItemModifier> {
    const sauces = catalogue.filter(p => p.category === 'sauce');
    const sauce = this.resolveProduct({ productName: parsed.productName, quantity: 1 }, sauces);
    
    if (!sauce) {
      return {
        success: false,
        errors: [{
          code: 'SAUCE_NOT_FOUND',
          message: `Sauce not found: ${parsed.productName}`,
          messageFr: `Je ne trouve pas la sauce "${parsed.productName}".`,
          recoverable: true
        }]
      };
    }
    
    return {
      success: true,
      data: {
        id: randomUUID(),
        type: 'sauce',
        productId: sauce.id,
        name: sauce.name,
        extraPrice: sauce.basePrice
      }
    };
  }
  
  // ============================================
  // UTILITIES
  // ============================================
  
  /**
   * Normalise une chaîne pour la comparaison
   */
  private normalizeString(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
      .replace(/[^a-z0-9]/g, ' ')       // Garde que alphanum
      .replace(/\s+/g, ' ')             // Normalise les espaces
      .trim();
  }
  
  /**
   * Calcule un score de similarité entre deux chaînes (0-1)
   */
  private similarityScore(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    
    // Jaro-Winkler simplifié
    const maxLen = Math.max(a.length, b.length);
    const matchWindow = Math.floor(maxLen / 2) - 1;
    
    const aMatches = new Array(a.length).fill(false);
    const bMatches = new Array(b.length).fill(false);
    
    let matches = 0;
    let transpositions = 0;
    
    for (let i = 0; i < a.length; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, b.length);
      
      for (let j = start; j < end; j++) {
        if (bMatches[j] || a[i] !== b[j]) continue;
        aMatches[i] = true;
        bMatches[j] = true;
        matches++;
        break;
      }
    }
    
    if (matches === 0) return 0;
    
    let k = 0;
    for (let i = 0; i < a.length; i++) {
      if (!aMatches[i]) continue;
      while (!bMatches[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }
    
    const jaro = (matches / a.length + matches / b.length + 
                  (matches - transpositions / 2) / matches) / 3;
    
    // Winkler modification
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(a.length, b.length)); i++) {
      if (a[i] === b[i]) prefix++;
      else break;
    }
    
    return jaro + prefix * 0.1 * (1 - jaro);
  }
  
  /**
   * Formate un prix en euros
   */
  private formatPrice(cents: number): string {
    const euros = (cents / 100).toFixed(2).replace('.', ',');
    return `${euros}€`;
  }
}

// Export singleton
export const orderEngine = new OrderEngine();
```

#### 2.4.3 Catalogue Service

```typescript
// ============================================
// catalogue-service.ts - Catalogue Management
// ============================================

import { Product, MenuRule } from './types';
import { logger } from './logger';

interface CatalogueCache {
  products: Product[];
  menuRules: MenuRule[];
  lastUpdated: number;
  storeId: string;
}

export class CatalogueService {
  private cache: Map<string, CatalogueCache> = new Map();
  private updateInterval: number = 5 * 60 * 1000; // 5 minutes
  
  constructor(
    private posApiUrl: string,
    private posApiKey: string
  ) {
    // Démarrer le refresh périodique
    setInterval(() => this.refreshAllCatalogues(), this.updateInterval);
  }
  
  // ============================================
  // CATALOGUE ACCESS
  // ============================================
  
  /**
   * Récupère le catalogue pour un store
   */
  getCatalogue(storeId: string): Product[] {
    const cached = this.cache.get(storeId);
    
    if (!cached || Date.now() - cached.lastUpdated > this.updateInterval) {
      // Refresh async mais retourne le cache existant
      this.refreshCatalogue(storeId).catch(err => {
        logger.error({ storeId, error: err }, 'Failed to refresh catalogue');
      });
    }
    
    return cached?.products || [];
  }
  
  /**
   * Récupère les règles de menu pour un store
   */
  getMenuRules(storeId: string): MenuRule[] {
    const cached = this.cache.get(storeId);
    return cached?.menuRules || [];
  }
  
  // ============================================
  // PRODUCT RESOLUTION
  // ============================================
  
  /**
   * Résout un nom de produit vers un produit du catalogue
   */
  resolveProduct(productName: string, storeId: string): Product | null {
    const catalogue = this.getCatalogue(storeId);
    const searchName = this.normalizeString(productName);
    
    // Recherche exacte
    let product = catalogue.find(p => 
      this.normalizeString(p.name) === searchName ||
      this.normalizeString(p.shortName) === searchName
    );
    if (product) return product;
    
    // Synonymes
    product = catalogue.find(p => 
      p.synonyms.some(s => this.normalizeString(s) === searchName)
    );
    if (product) return product;
    
    // Recherche partielle
    product = catalogue.find(p => 
      this.normalizeString(p.name).includes(searchName) ||
      searchName.includes(this.normalizeString(p.name)) ||
      p.synonyms.some(s => 
        this.normalizeString(s).includes(searchName) ||
        searchName.includes(this.normalizeString(s))
      )
    );
    
    return product || null;
  }
  
  /**
   * Trouve des alternatives à un produit
   */
  findAlternatives(productId: string, storeId: string): Product[] {
    const catalogue = this.getCatalogue(storeId);
    const product = catalogue.find(p => p.id === productId);
    
    if (!product) return [];
    
    return catalogue
      .filter(p => 
        p.id !== productId &&
        p.category === product.category &&
        p.available &&
        Math.abs(p.basePrice - product.basePrice) < 300
      )
      .slice(0, 3);
  }
  
  // ============================================
  // AVAILABILITY
  // ============================================
  
  /**
   * Vérifie la disponibilité en temps réel
   */
  async checkRealTimeAvailability(productId: string, storeId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.posApiUrl}/stores/${storeId}/products/${productId}/availability`,
        {
          headers: {
            'Authorization': `Bearer ${this.posApiKey}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(2000)
        }
      );
      
      if (!response.ok) {
        // Fallback sur le cache
        const product = this.getCatalogue(storeId).find(p => p.id === productId);
        return product?.available ?? false;
      }
      
      const data = await response.json();
      
      // Mettre à jour le cache
      this.updateProductAvailability(storeId, productId, data.available);
      
      return data.available;
      
    } catch (error) {
      logger.warn({ storeId, productId, error }, 'Failed to check real-time availability');
      // Fallback sur le cache
      const product = this.getCatalogue(storeId).find(p => p.id === productId);
      return product?.available ?? false;
    }
  }
  
  /**
   * Marque un produit comme indisponible (86'd)
   */
  markProductUnavailable(storeId: string, productId: string): void {
    this.updateProductAvailability(storeId, productId, false);
    logger.info({ storeId, productId }, 'Product marked as 86d');
  }
  
  /**
   * Marque un produit comme disponible
   */
  markProductAvailable(storeId: string, productId: string): void {
    this.updateProductAvailability(storeId, productId, true);
    logger.info({ storeId, productId }, 'Product marked as available');
  }
  
  private updateProductAvailability(storeId: string, productId: string, available: boolean): void {
    const cached = this.cache.get(storeId);
    if (!cached) return;
    
    const product = cached.products.find(p => p.id === productId);
    if (product) {
      product.available = available;
    }
  }
  
  // ============================================
  // REFRESH
  // ============================================
  
  /**
   * Rafraîchit le catalogue depuis le POS
   */
  async refreshCatalogue(storeId: string): Promise<void> {
    try {
      const [productsRes, rulesRes] = await Promise.all([
        fetch(`${this.posApiUrl}/stores/${storeId}/products`, {
          headers: {
            'Authorization': `Bearer ${this.posApiKey}`,
            'Content-Type': 'application/json'
          }
        }),
        fetch(`${this.posApiUrl}/stores/${storeId}/menu-rules`, {
          headers: {
            'Authorization': `Bearer ${this.posApiKey}`,
            'Content-Type': 'application/json'
          }
        })
      ]);
      
      if (!productsRes.ok || !rulesRes.ok) {
        throw new Error('Failed to fetch catalogue');
      }
      
      const products: Product[] = await productsRes.json();
      const menuRules: MenuRule[] = await rulesRes.json();
      
      this.cache.set(storeId, {
        products,
        menuRules,
        lastUpdated: Date.now(),
        storeId
      });
      
      logger.info({ storeId, productCount: products.length }, 'Catalogue refreshed');
      
    } catch (error) {
      logger.error({ storeId, error }, 'Failed to refresh catalogue');
      throw error;
    }
  }
  
  /**
   * Rafraîchit tous les catalogues en cache
   */
  private async refreshAllCatalogues(): Promise<void> {
    for (const storeId of this.cache.keys()) {
      try {
        await this.refreshCatalogue(storeId);
      } catch (error) {
        logger.error({ storeId, error }, 'Failed to refresh catalogue');
      }
    }
  }
  
  // ============================================
  // INITIALIZATION
  // ============================================
  
  /**
   * Initialise le catalogue avec des données statiques (pour dev/test)
   */
  initializeWithStaticData(storeId: string, products: Product[], menuRules: MenuRule[]): void {
    this.cache.set(storeId, {
      products,
      menuRules,
      lastUpdated: Date.now(),
      storeId
    });
    logger.info({ storeId, productCount: products.length }, 'Catalogue initialized with static data');
  }
  
  // ============================================
  // UTILITIES
  // ============================================
  
  private normalizeString(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
```

#### 2.4.4 POS Adapter

```typescript
// ============================================
// pos-adapter.ts - POS Integration
// ============================================

import { Order, OrderItem, ValidationError } from './types';
import { logger } from './logger';

interface POSOrderPayload {
  externalId: string;
  storeId: string;
  channel: 'drive_thru';
  items: POSOrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

interface POSOrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  modifiers?: POSModifier[];
  notes?: string;
}

interface POSModifier {
  type: string;
  productId: string;
  price: number;
}

interface POSResponse {
  success: boolean;
  orderId?: string;
  orderNumber?: string;
  estimatedTime?: number;
  error?: {
    code: string;
    message: string;
  };
}

interface POSAdapterResult {
  success: boolean;
  orderId?: string;
  orderNumber?: string;
  estimatedTime?: number;
  error?: ValidationError;
}

export class POSAdapter {
  constructor(
    private apiUrl: string,
    private apiKey: string,
    private timeout: number = 5000
  ) {}
  
  // ============================================
  // ORDER CREATION
  // ============================================
  
  /**
   * Envoie une commande au POS
   */
  async createOrder(order: Order): Promise<POSAdapterResult> {
    const payload = this.transformOrderToPayload(order);
    
    logger.info({ orderId: order.id, storeId: order.storeId }, 'Sending order to POS');
    
    try {
      const response = await fetch(`${this.apiUrl}/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Request-Id': order.id
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout)
      });
      
      const data: POSResponse = await response.json();
      
      if (!response.ok || !data.success) {
        logger.error({ 
          orderId: order.id, 
          status: response.status,
          error: data.error 
        }, 'POS rejected order');
        
        return {
          success: false,
          error: {
            code: data.error?.code || 'POS_ERROR',
            message: data.error?.message || 'POS rejected the order',
            messageFr: this.translatePOSError(data.error?.code),
            recoverable: this.isRecoverableError(data.error?.code)
          }
        };
      }
      
      logger.info({ 
        orderId: order.id, 
        posOrderId: data.orderId,
        orderNumber: data.orderNumber 
      }, 'Order accepted by POS');
      
      return {
        success: true,
        orderId: data.orderId,
        orderNumber: data.orderNumber,
        estimatedTime: data.estimatedTime
      };
      
    } catch (error) {
      logger.error({ orderId: order.id, error }, 'Failed to send order to POS');
      
      if (error instanceof Error && error.name === 'TimeoutError') {
        return {
          success: false,
          error: {
            code: 'POS_TIMEOUT',
            message: 'POS request timed out',
            messageFr: 'La caisse ne répond pas. Veuillez patienter.',
            recoverable: true
          }
        };
      }
      
      return {
        success: false,
        error: {
          code: 'POS_CONNECTION_ERROR',
          message: 'Failed to connect to POS',
          messageFr: 'Erreur de connexion avec la caisse.',
          recoverable: true
        }
      };
    }
  }
  
  /**
   * Annule une commande au POS
   */
  async cancelOrder(posOrderId: string, reason?: string): Promise<POSAdapterResult> {
    logger.info({ posOrderId, reason }, 'Cancelling order in POS');
    
    try {
      const response = await fetch(`${this.apiUrl}/orders/${posOrderId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        const data = await response.json();
        return {
          success: false,
          error: {
            code: 'CANCEL_FAILED',
            message: data.error?.message || 'Failed to cancel order',
            messageFr: 'Impossible d\'annuler la commande.',
            recoverable: false
          }
        };
      }
      
      return { success: true };
      
    } catch (error) {
      logger.error({ posOrderId, error }, 'Failed to cancel order');
      return {
        success: false,
        error: {
          code: 'POS_CONNECTION_ERROR',
          message: 'Failed to connect to POS',
          messageFr: 'Erreur de connexion avec la caisse.',
          recoverable: false
        }
      };
    }
  }
  
  /**
   * Vérifie le statut d'une commande
   */
  async getOrderStatus(posOrderId: string): Promise<{
    status: string;
    estimatedTime?: number;
  } | null> {
    try {
      const response = await fetch(`${this.apiUrl}/orders/${posOrderId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) return null;
      
      const data = await response.json();
      return {
        status: data.status,
        estimatedTime: data.estimatedTime
      };
      
    } catch (error) {
      logger.error({ posOrderId, error }, 'Failed to get order status');
      return null;
    }
  }
  
  // ============================================
  // PAYLOAD TRANSFORMATION
  // ============================================
  
  /**
   * Transforme une Order en payload POS
   */
  private transformOrderToPayload(order: Order): POSOrderPayload {
    return {
      externalId: order.id,
      storeId: order.storeId,
      channel: 'drive_thru',
      items: order.items.map(item => this.transformItem(item)),
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      currency: order.currency,
      metadata: {
        sessionId: order.sessionId,
        laneId: order.laneId,
        source: 'voicebot'
      }
    };
  }
  
  private transformItem(item: OrderItem): POSOrderItem {
    return {
      productId: item.productId,
      quantity: item.qty,
      unitPrice: item.unitPrice,
      modifiers: item.modifiers.map(mod => ({
        type: mod.type,
        productId: mod.productId,
        price: mod.extraPrice
      })),
      notes: item.notes
    };
  }
  
  // ============================================
  // ERROR HANDLING
  // ============================================
  
  private translatePOSError(code?: string): string {
    const translations: Record<string, string> = {
      'PRODUCT_NOT_FOUND': 'Un produit n\'est plus disponible.',
      'PRODUCT_UNAVAILABLE': 'Un produit est en rupture de stock.',
      'INVALID_QUANTITY': 'Quantité invalide.',
      'STORE_CLOSED': 'Le restaurant est fermé.',
      'PAYMENT_REQUIRED': 'Veuillez vous présenter au guichet de paiement.',
      'ORDER_LIMIT_EXCEEDED': 'La commande dépasse les limites autorisées.',
      'SYSTEM_ERROR': 'Erreur système. Veuillez réessayer.',
      'DUPLICATE_ORDER': 'Cette commande a déjà été enregistrée.'
    };
    
    return translations[code || ''] || 'Erreur lors de l\'envoi de la commande.';
  }
  
  private isRecoverableError(code?: string): boolean {
    const recoverableCodes = ['SYSTEM_ERROR', 'TIMEOUT', 'CONNECTION_ERROR'];
    return recoverableCodes.includes(code || '');
  }
}
```

#### 2.4.5 Order Engine Data Models

interface Product {
  id: string;
  name: string;
  shortName: string;           // Pour affichage écran et TTS
  category: ProductCategory;
  synonyms: string[];
  available: boolean;
  basePrice: number;           // Centimes (990 = 9.90€)
  sizes?: ProductSize[];
  allergens?: string[];
  ingredients?: string[];
  metadata?: Record<string, any>;
}

interface ProductSize {
  id: string;
  name: "small" | "medium" | "large";
  displayName: string;         // "Petit" / "Moyen" / "Grand"
  priceModifier: number;       // Centimes à ajouter
}

interface MenuRule {
  menuProductId: string;
  requiredComponents: {
    type: "side" | "drink" | "dessert";
    min: number;
    max: number;
    allowedProductIds: string[];    // IDs des produits autorisés
    defaultProductId: string;       // Défaut si non spécifié
    priceIncluded: boolean;         // Inclus dans le prix menu
    upgradeOptions?: {              // Suppléments possibles
      productId: string;
      extraPrice: number;
    }[];
  }[];
  incompatibleWith?: string[];      // Produits qui ne peuvent pas être ajoutés
}

interface OrderItem {
  id: string;                       // UUID unique pour cette ligne
  productId: string;
  name: string;
  category: ProductCategory;
  qty: number;
  size?: string;
  unitPrice: number;
  linePrice: number;
  modifiers: OrderItemModifier[];
  customizations?: OrderCustomization[];  // Phase 2
}

interface OrderItemModifier {
  type: "side" | "drink" | "dessert" | "sauce";
  productId: string;
  name: string;
  extraPrice: number;
}

interface OrderCustomization {      // Phase 2
  type: "remove_ingredient" | "add_ingredient" | "extra" | "less";
  ingredient: string;
  extraPrice: number;
}

interface Order {
  id: string;                       // UUID
  sessionId: string;                // ID de la session drive-thru
  storeId: string;
  items: OrderItem[];
  subtotal: number;                 // Centimes
  tax: number;
  total: number;
  currency: "EUR";
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

type OrderStatus = 
  | "draft"           // En construction
  | "confirmed"       // Confirmé par client
  | "sent_to_pos"     // Envoyé au POS
  | "accepted"        // Accepté par POS
  | "rejected"        // Rejeté par POS
  | "paid"            // Payé
  | "cancelled";      // Annulé

interface ValidationError {
  code: string;
  message: string;
  messageFr: string;              // Message client-friendly en français
  field?: string;
  details?: any;
  recoverable: boolean;           // Peut-on corriger automatiquement ?
  suggestion?: string;            // Suggestion de correction
}
```

#### Fonctions pures Order Engine

```typescript
// ============================================
// ORDER ENGINE - PURE FUNCTIONS
// ============================================

interface OrderEngineResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  warnings?: string[];
}

/**
 * Ajoute un item à la commande
 */
function addItemToOrder(
  currentOrder: Order,
  parsedItem: ParsedOrderItem,
  catalogue: Product[],
  menuRules: MenuRule[]
): OrderEngineResult<Order> {
  // 1. Vérifier que le produit existe
  // 2. Vérifier qu'il est disponible
  // 3. Si menu, vérifier les composants requis
  // 4. Calculer le prix
  // 5. Retourner la nouvelle commande ou les erreurs
}

/**
 * Modifie un item existant (Phase 2)
 */
function modifyItemInOrder(
  currentOrder: Order,
  itemId: string,
  modification: OrderModification,
  catalogue: Product[],
  menuRules: MenuRule[]
): OrderEngineResult<Order> {
  // 1. Trouver l'item
  // 2. Appliquer la modification
  // 3. Revalider les règles
  // 4. Recalculer le prix
}

/**
 * Supprime un item
 */
function removeItemFromOrder(
  currentOrder: Order,
  itemId: string
): OrderEngineResult<Order> {
  // 1. Trouver l'item
  // 2. Le supprimer
  // 3. Recalculer le total
}

/**
 * Valide la commande complète avant envoi POS
 */
function validateOrder(
  order: Order,
  catalogue: Product[],
  menuRules: MenuRule[]
): OrderEngineResult<{ valid: boolean; errors: ValidationError[] }> {
  const errors: ValidationError[] = [];
  
  // Vérifications :
  // 1. Au moins 1 item
  // 2. Tous les produits existent et sont disponibles
  // 3. Tous les menus ont leurs composants requis
  // 4. Quantités valides (1-99)
  // 5. Prix cohérents
  // 6. Pas de combinaisons interdites
  
  return {
    success: errors.length === 0,
    data: { valid: errors.length === 0, errors }
  };
}

/**
 * Calcule le total de la commande
 */
function calculateOrderTotal(
  order: Order,
  discounts?: Discount[]
): { subtotal: number; tax: number; total: number } {
  // TVA française restauration rapide : 10% sur place, 5.5% à emporter
  // Drive = à emporter = 5.5%
}

/**
 * Génère le résumé vocal de la commande
 */
function generateOrderSummary(
  order: Order,
  format: "short" | "full"
): string {
  // Format court : "2 menus Giant et un sundae, total 24 euros 90"
  // Format complet : détail de chaque item avec modifiers
}
```

### 2.5 LLM Agent — System Prompt

```typescript
const LLM_SYSTEM_PROMPT = `
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

## EXEMPLES

Client: "Je voudrais un menu Giant avec des frites et un Coca"
{
  "intent": "ADD_ITEM",
  "confidence": 0.95,
  "items": [
    {
      "action": "add",
      "productRef": "menu Giant",
      "qty": 1,
      "modifiers": [
        { "type": "side", "productRef": "frites" },
        { "type": "drink", "productRef": "Coca-Cola" }
      ]
    }
  ],
  "clarificationNeeded": false,
  "responseToCustomer": "Un menu Giant avec frites et Coca, c'est noté. Autre chose ?"
}

Client: "Euh... le truc là... le burger"
{
  "intent": "CLARIFY",
  "confidence": 0.3,
  "items": [],
  "clarificationNeeded": true,
  "clarificationQuestion": "Quel burger souhaitez-vous ? Nous avons le Giant, le Big Cheese, ou le Long Chicken.",
  "responseToCustomer": "Quel burger souhaitez-vous ? Nous avons le Giant, le Big Cheese, ou le Long Chicken."
}

Client: "Vous avez des tacos ?"
{
  "intent": "UNKNOWN",
  "confidence": 0.9,
  "items": [],
  "clarificationNeeded": false,
  "responseToCustomer": "Désolé, nous n'avons pas de tacos. Puis-je vous proposer autre chose ?"
}

## CATALOGUE PRODUITS

{{CATALOGUE_JSON}}

## RÈGLES MENUS

{{MENU_RULES_JSON}}
`;
```

### 2.6 TTS — Text-to-Speech

```typescript
interface TTSConfig {
  provider: "openai" | "elevenlabs" | "google" | "azure";
  
  voice: {
    id: string;              // ID de la voix
    name: string;            // "Léa", "Thomas", etc.
    gender: "female" | "male";
    style: "friendly" | "professional" | "casual";
  };
  
  settings: {
    speed: number;           // 0.8 - 1.2 (1.0 = normal)
    pitch: number;           // -10 to +10
    volume: number;          // 0.0 - 1.0
  };
  
  // Optimisations drive-thru
  driveThruOptimizations: {
    boostedMidFrequencies: boolean;    // Meilleure intelligibilité sur HP externe
    compressorEnabled: boolean;         // Niveau sonore constant
    noiseGateEnabled: boolean;
  };
  
  // Cache pour phrases fréquentes (latence réduite)
  preGeneratedPhrases: {
    greeting: string;        // "Bienvenue chez Quick, je vous écoute"
    confirmation: string;    // "C'est noté"
    clarification: string;   // "Pouvez-vous répéter ?"
    fallback: string;        // "Je vous passe à un équipier"
    farewell: string;        // "Bonne journée, à bientôt !"
  };
  
  latencyBudget: {
    maxGenerationTimeMs: 200;
    streamingEnabled: boolean;   // Commence à jouer avant génération complète
  };
}

// Phrases pré-générées au démarrage pour latence minimale
const PREGENERERATED_AUDIO_CACHE: Map<string, AudioBuffer> = new Map();
```

---

## 2.4 ORDER ENGINE — IMPLÉMENTATION COMPLÈTE

L'Order Engine est le cœur métier du système. Il gère la construction, validation et calcul des commandes selon les règles Quick.

### 2.4.1 Data Models

```typescript
// ============================================
// types.ts - Core Data Models
// ============================================

// ============================================
// PRODUCT TYPES
// ============================================

export type ProductCategory = 
  | 'menu'           // Menu complet (burger + accomp + boisson)
  | 'burger'         // Burger seul
  | 'side'           // Accompagnement (frites, rustiques, etc.)
  | 'drink'          // Boisson
  | 'dessert'        // Dessert
  | 'sauce'          // Sauce
  | 'extra'          // Supplément
  | 'kids_menu'      // Menu enfant (Magic Box, Fun Box)
  | 'finger_food';   // Finger food (chicken dips, wings, etc.)

export type ProductSize = 'small' | 'medium' | 'large' | 'xl';

export type MenuType = 'normal' | 'maxi';

export type KidsMenuType = 'magic_box' | 'fun_box';

export interface Product {
  id: string;
  name: string;
  shortName: string;              // Pour TTS et affichage court
  category: ProductCategory;
  
  // Reconnaissance vocale
  synonyms: string[];             // Variantes de prononciation
  
  // Disponibilité
  available: boolean;
  availableFrom?: string;         // Heure début dispo (ex: "11:00")
  availableTo?: string;           // Heure fin dispo (ex: "23:00")
  
  // Prix
  basePrice: number;              // En centimes
  sizes?: {
    size: ProductSize;
    priceModifier: number;        // Ajout en centimes
    displayName: string;          // "Petit", "Moyen", "Grand"
  }[];
  
  // Métadonnées
  calories?: number;
  allergens?: string[];
  isAlcohol?: boolean;            // Pour vérification âge
  isVegetarian?: boolean;
  isSpicy?: boolean;
  
  // Pour les burgers dans menus
  availableInMenu?: boolean;
  menuPriceNormal?: number;       // Prix en menu normal
  menuPriceMaxi?: number;         // Prix en menu maxi
  
  // Pour les finger foods
  portionSizes?: {
    quantity: number;
    price: number;
    displayName: string;          // "x4", "x7", "x20"
  }[];
}

// ============================================
// MENU RULES - LOGIQUE D'ASSOCIATION QUICK
// ============================================

/**
 * RÈGLES MENUS QUICK
 * 
 * MENUS ADULTES (2 tailles):
 * - Menu Normal: Burger + Accompagnement Moyen + Boisson 35cl
 * - Menu Maxi (XL): Burger + Accompagnement Grand + Boisson 50cl
 * → Si non précisé, TOUJOURS demander: "En menu Normal ou menu Maxi ?"
 * 
 * MENUS ENFANTS:
 * - Magic Box (4-7 ans): Plat + Accomp + Boisson + Dessert + Surprise
 * - Fun Box (Ados): Plat + Accomp + Boisson + Dessert
 * → Pour Magic Box, TOUJOURS demander: "Cadeau Fille ou Garçon ?"
 */

export interface MenuRule {
  menuType: 'adult_normal' | 'adult_maxi' | 'magic_box' | 'fun_box';
  displayName: string;
  displayNameFr: string;
  
  // Composants requis
  components: MenuComponent[];
  
  // Prix de base du menu (hors burger)
  baseMenuSupplement: number;     // Supplément menu vs burger seul
  fixedPrice?: number;            // Prix fixe (pour menus enfants)
  
  // Produits incompatibles
  excludedProducts?: string[];
  
  // Questions à poser
  requiredQuestions?: string[];   // Ex: "Cadeau Fille ou Garçon ?"
}

export interface MenuComponent {
  type: 'main' | 'side' | 'drink' | 'dessert' | 'toy';
  required: boolean;
  min: number;
  max: number;
  
  // Produits autorisés pour ce composant
  allowedProductIds: string[];
  
  // Produit par défaut si non spécifié
  defaultProductId?: string;
  
  // Taille par défaut
  defaultSize?: ProductSize;
  
  // Inclus dans le prix ou supplément ?
  includedInPrice: boolean;
  
  // Options de upgrade
  upgradeOptions?: {
    productId: string;
    extraPrice: number;
    displayName: string;
  }[];
}

// ============================================
// ORDER TYPES
// ============================================

export interface Order {
  id: string;
  sessionId: string;
  storeId: string;
  laneId?: string;
  
  // Contenu
  items: OrderItem[];
  
  // Calculs
  subtotal: number;               // Avant taxes
  tax: number;                    // TVA (5.5% drive = emporter)
  total: number;                  // TTC
  currency: 'EUR';
  
  // Status
  status: OrderStatus;
  
  // POS
  posOrderId?: string;
  
  // Timing
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
  sentToPosAt?: Date;
}

export type OrderStatus = 
  | 'draft'
  | 'confirmed'
  | 'sent_to_pos'
  | 'accepted'
  | 'rejected'
  | 'paid'
  | 'cancelled';

export interface OrderItem {
  id: string;                     // UUID unique
  
  // Produit
  productId: string;
  name: string;
  category: ProductCategory;
  
  // Quantité et taille
  qty: number;
  size?: ProductSize;
  
  // Prix
  unitPrice: number;              // Prix unitaire en centimes
  linePrice: number;              // Prix total ligne (unitPrice * qty)
  
  // Type de menu (si applicable)
  menuType?: MenuType | KidsMenuType;
  
  // Composants du menu
  components?: OrderItemComponent[];
  
  // Customisations (Phase 2)
  customizations?: OrderCustomization[];
  
  // Sauces associées
  sauces?: OrderItemSauce[];
  
  // Notes spéciales
  notes?: string;
}

export interface OrderItemComponent {
  type: 'main' | 'side' | 'drink' | 'dessert' | 'toy';
  productId: string;
  name: string;
  size?: ProductSize;
  extraPrice: number;             // 0 si inclus, >0 si upgrade
}

export interface OrderItemSauce {
  productId: string;
  name: string;
  qty: number;
  price: number;                  // 0 si gratuite avec menu
}

export interface OrderCustomization {
  type: 'remove_ingredient' | 'add_ingredient' | 'extra' | 'less' | 'no_salt';
  ingredient: string;
  extraPrice: number;
}

// ============================================
// VALIDATION
// ============================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  messageFr: string;              // Message pour le client
  field?: string;
  itemId?: string;
  recoverable: boolean;
  suggestion?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  messageFr: string;
}

// ============================================
// ORDER ENGINE RESULT
// ============================================

export interface OrderEngineResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
}

// ============================================
// PARSED INPUT (from NLU)
// ============================================

export interface ParsedOrderItem {
  productName: string;            // Nom brut du NLU
  productId?: string;             // ID si déjà résolu
  quantity: number;
  size?: ProductSize;
  menuType?: MenuType;
  
  components?: ParsedComponent[];
  sauces?: string[];
  customizations?: ParsedCustomization[];
}

export interface ParsedComponent {
  type: 'side' | 'drink' | 'dessert';
  productName: string;
  productId?: string;
  size?: ProductSize;
}

export interface ParsedCustomization {
  type: 'remove' | 'add' | 'extra' | 'less';
  ingredient: string;
}
```

### 2.4.2 Catalogue Quick Complet

```typescript
// ============================================
// catalogue.ts - Quick Restaurant Catalogue
// ============================================

import { Product, MenuRule } from './types';

// ============================================
// BURGERS - GAMME GIANT (Iconique)
// ============================================

export const BURGERS: Product[] = [
  {
    id: 'BURG_GIANT',
    name: 'Giant',
    shortName: 'Giant',
    category: 'burger',
    synonyms: ['le giant', 'un giant', 'giant classique', 'giant normal', 'le géant', 'geant'],
    available: true,
    basePrice: 590,               // 5.90€ seul
    menuPriceNormal: 890,         // 8.90€ en menu
    menuPriceMaxi: 1090,          // 10.90€ en menu maxi
    availableInMenu: true,
    calories: 503,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde', 'sésame'],
  },
  {
    id: 'BURG_GIANT_MAX',
    name: 'Giant Max',
    shortName: 'Giant Max',
    category: 'burger',
    synonyms: ['giant max', 'le giant max', 'giant maxi', 'gros giant', 'giant double'],
    available: true,
    basePrice: 790,
    menuPriceNormal: 1090,
    menuPriceMaxi: 1290,
    availableInMenu: true,
    calories: 756,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde', 'sésame'],
  },
  {
    id: 'BURG_GIANT_JR',
    name: 'Giant Junior',
    shortName: 'Giant Jr',
    category: 'burger',
    synonyms: ['giant junior', 'giant jr', 'petit giant', 'giant enfant', 'giant petit'],
    available: true,
    basePrice: 390,
    availableInMenu: false,       // Uniquement dans Fun Box
    calories: 320,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde', 'sésame'],
  },
  
  // BURGERS - GAMME LONG (Pains longs)
  {
    id: 'BURG_LONG_CHICKEN',
    name: 'Long Chicken',
    shortName: 'Long Chicken',
    category: 'burger',
    synonyms: ['long chicken', 'long poulet', 'le long chicken', 'sandwich poulet', 'poulet long'],
    available: true,
    basePrice: 550,
    menuPriceNormal: 850,
    menuPriceMaxi: 1050,
    availableInMenu: true,
    calories: 458,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde'],
  },
  {
    id: 'BURG_LONG_FISH',
    name: 'Long Fish',
    shortName: 'Long Fish',
    category: 'burger',
    synonyms: ['long fish', 'long poisson', 'le long fish', 'sandwich poisson', 'filet de poisson'],
    available: true,
    basePrice: 550,
    menuPriceNormal: 850,
    menuPriceMaxi: 1050,
    availableInMenu: true,
    calories: 445,
    allergens: ['gluten', 'lait', 'œuf', 'poisson', 'moutarde'],
  },
  {
    id: 'BURG_LONG_BACON',
    name: 'Long Bacon',
    shortName: 'Long Bacon',
    category: 'burger',
    synonyms: ['long bacon', 'le long bacon', 'sandwich bacon', 'bacon long'],
    available: true,
    basePrice: 590,
    menuPriceNormal: 890,
    menuPriceMaxi: 1090,
    availableInMenu: true,
    calories: 512,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde'],
  },
  {
    id: 'BURG_LONG_BACON_JR',
    name: 'Long Bacon Junior',
    shortName: 'Long Bacon Jr',
    category: 'burger',
    synonyms: ['long bacon junior', 'long bacon jr', 'petit long bacon'],
    available: true,
    basePrice: 390,
    availableInMenu: false,       // Uniquement dans Fun Box
    calories: 380,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde'],
  },
  
  // BURGERS - GAMME SUPRÊME (Premium)
  {
    id: 'BURG_SUPREME_CLASSIQ',
    name: 'Suprême ClassiQ',
    shortName: 'Suprême',
    category: 'burger',
    synonyms: ['suprême', 'supreme', 'suprême classiq', 'le suprême', 'double steak', 'classiq'],
    available: true,
    basePrice: 690,
    menuPriceNormal: 990,
    menuPriceMaxi: 1190,
    availableInMenu: true,
    calories: 623,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde', 'sésame'],
  },
  {
    id: 'BURG_SUPREME_CHICKEN',
    name: 'Suprême Chicken',
    shortName: 'Suprême Chicken',
    category: 'burger',
    synonyms: ['suprême chicken', 'supreme chicken', 'suprême poulet', 'poulet suprême'],
    available: true,
    basePrice: 690,
    menuPriceNormal: 990,
    menuPriceMaxi: 1190,
    availableInMenu: true,
    calories: 589,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde'],
  },
  
  // BURGERS - SPÉCIALITÉS
  {
    id: 'BURG_QUICK_TOAST',
    name: "Quick'N Toast",
    shortName: 'Quick Toast',
    category: 'burger',
    synonyms: ['quick n toast', 'quick toast', 'quicken toast', 'le toast', 'croque'],
    available: true,
    basePrice: 650,
    menuPriceNormal: 950,
    menuPriceMaxi: 1150,
    availableInMenu: true,
    calories: 534,
    allergens: ['gluten', 'lait', 'œuf'],
  },
  {
    id: 'BURG_CHEESEBURGER',
    name: 'Cheeseburger',
    shortName: 'Cheese',
    category: 'burger',
    synonyms: ['cheeseburger', 'cheese burger', 'cheese', 'le cheese', 'un cheese'],
    available: true,
    basePrice: 290,
    menuPriceNormal: 590,
    menuPriceMaxi: 790,
    availableInMenu: true,
    calories: 302,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde', 'sésame'],
  },
  {
    id: 'BURG_DOUBLE_CHEESE',
    name: 'Double Cheese',
    shortName: 'Double Cheese',
    category: 'burger',
    synonyms: ['double cheese', 'double cheeseburger', 'double', 'deux cheese'],
    available: true,
    basePrice: 450,
    menuPriceNormal: 750,
    menuPriceMaxi: 950,
    availableInMenu: true,
    calories: 456,
    allergens: ['gluten', 'lait', 'œuf', 'moutarde', 'sésame'],
  },
  {
    id: 'BURG_HAMBURGER',
    name: 'Hamburger',
    shortName: 'Hamburger',
    category: 'burger',
    synonyms: ['hamburger', 'ham burger', 'le hamburger', 'burger simple', 'simple'],
    available: true,
    basePrice: 250,
    menuPriceNormal: 550,
    menuPriceMaxi: 750,
    availableInMenu: true,
    calories: 263,
    allergens: ['gluten', 'œuf', 'moutarde', 'sésame'],
  },
];

// ============================================
// ACCOMPAGNEMENTS (SIDES)
// ============================================

export const SIDES: Product[] = [
  {
    id: 'SIDE_FRITES',
    name: 'Frites',
    shortName: 'Frites',
    category: 'side',
    synonyms: ['frites', 'des frites', 'frite', 'patates', 'les frites', 'french fries'],
    available: true,
    basePrice: 250,               // Prix moyen par défaut
    sizes: [
      { size: 'small', priceModifier: -50, displayName: 'Petite' },
      { size: 'medium', priceModifier: 0, displayName: 'Moyenne' },
      { size: 'large', priceModifier: 80, displayName: 'Grande' },
    ],
    calories: 340,
    allergens: [],
    isVegetarian: true,
  },
  {
    id: 'SIDE_RUSTIQUES',
    name: 'Rustiques',
    shortName: 'Rustiques',
    category: 'side',
    synonyms: ['rustiques', 'potatoes', 'patates rustiques', 'quartiers', 'les rustiques', 'wedges'],
    available: true,
    basePrice: 290,
    sizes: [
      { size: 'medium', priceModifier: 0, displayName: 'Moyenne' },
      { size: 'large', priceModifier: 80, displayName: 'Grande' },
    ],
    calories: 380,
    allergens: [],
    isVegetarian: true,
    isSpicy: true,
  },
  {
    id: 'SIDE_TOMATES',
    name: 'Tomates Cerises',
    shortName: 'Tomates',
    category: 'side',
    synonyms: ['tomates', 'tomates cerises', 'cherry tomatoes', 'tomate'],
    available: true,
    basePrice: 150,
    calories: 25,
    allergens: [],
    isVegetarian: true,
  },
];

// ============================================
// FINGER FOOD
// ============================================

export const FINGER_FOODS: Product[] = [
  {
    id: 'FINGER_CHICKEN_DIPS',
    name: 'Chicken Dips',
    shortName: 'Chicken Dips',
    category: 'finger_food',
    synonyms: ['chicken dips', 'dips', 'nuggets', 'chicken', 'poulet pané', 'beignets de poulet', 'dips poulet'],
    available: true,
    basePrice: 350,               // Prix x4 par défaut
    portionSizes: [
      { quantity: 4, price: 350, displayName: 'x4' },
      { quantity: 7, price: 550, displayName: 'x7' },
      { quantity: 20, price: 1290, displayName: 'x20 (Bucket)' },
    ],
    calories: 45,                 // Par pièce
    allergens: ['gluten', 'œuf'],
  },
  {
    id: 'FINGER_CHICKEN_WINGS',
    name: 'Chicken Wings',
    shortName: 'Wings',
    category: 'finger_food',
    synonyms: ['chicken wings', 'wings', 'ailes de poulet', 'ailes', 'buffalo wings'],
    available: true,
    basePrice: 450,
    portionSizes: [
      { quantity: 4, price: 450, displayName: 'x4' },
      { quantity: 8, price: 790, displayName: 'x8' },
    ],
    calories: 85,                 // Par pièce
    allergens: ['gluten'],
    isSpicy: true,
  },
  {
    id: 'FINGER_CHEESY_TRIO',
    name: 'Cheesy Trio',
    shortName: 'Cheesy Trio',
    category: 'finger_food',
    synonyms: ['cheesy trio', 'bouchées fromage', 'cheese bites', 'cheesy', 'trio fromage'],
    available: true,
    basePrice: 390,
    calories: 320,
    allergens: ['gluten', 'lait'],
    isVegetarian: true,
  },
];

// ============================================
// BOISSONS (DRINKS)
// ============================================

export const DRINKS: Product[] = [
  // Sodas fontaine
  {
    id: 'DRINK_COCA',
    name: 'Coca-Cola',
    shortName: 'Coca',
    category: 'drink',
    synonyms: ['coca', 'coca cola', 'coke', 'coca-cola', 'le coca', 'un coca'],
    available: true,
    basePrice: 290,
    sizes: [
      { size: 'small', priceModifier: -60, displayName: '25cl' },
      { size: 'medium', priceModifier: 0, displayName: '35cl' },
      { size: 'large', priceModifier: 50, displayName: '50cl' },
    ],
    calories: 139,
    allergens: [],
  },
  {
    id: 'DRINK_COCA_ZERO',
    name: 'Coca-Cola Sans Sucres',
    shortName: 'Coca Zero',
    category: 'drink',
    synonyms: ['coca zero', 'coca sans sucre', 'coke zero', 'coca light', 'zero', 'sans sucre'],
    available: true,
    basePrice: 290,
    sizes: [
      { size: 'small', priceModifier: -60, displayName: '25cl' },
      { size: 'medium', priceModifier: 0, displayName: '35cl' },
      { size: 'large', priceModifier: 50, displayName: '50cl' },
    ],
    calories: 1,
    allergens: [],
  },
  {
    id: 'DRINK_COCA_CHERRY',
    name: 'Coca-Cola Cherry',
    shortName: 'Coca Cherry',
    category: 'drink',
    synonyms: ['coca cherry', 'cherry coke', 'coca cerise', 'cherry'],
    available: true,
    basePrice: 290,
    sizes: [
      { size: 'small', priceModifier: -60, displayName: '25cl' },
      { size: 'medium', priceModifier: 0, displayName: '35cl' },
      { size: 'large', priceModifier: 50, displayName: '50cl' },
    ],
    calories: 142,
    allergens: [],
  },
  {
    id: 'DRINK_FANTA',
    name: 'Fanta Orange',
    shortName: 'Fanta',
    category: 'drink',
    synonyms: ['fanta', 'fanta orange', 'orange', 'orangeade'],
    available: true,
    basePrice: 290,
    sizes: [
      { size: 'small', priceModifier: -60, displayName: '25cl' },
      { size: 'medium', priceModifier: 0, displayName: '35cl' },
      { size: 'large', priceModifier: 50, displayName: '50cl' },
    ],
    calories: 126,
    allergens: [],
  },
  {
    id: 'DRINK_SPRITE',
    name: 'Sprite',
    shortName: 'Sprite',
    category: 'drink',
    synonyms: ['sprite', 'limonade', 'citron', 'lemon'],
    available: true,
    basePrice: 290,
    sizes: [
      { size: 'small', priceModifier: -60, displayName: '25cl' },
      { size: 'medium', priceModifier: 0, displayName: '35cl' },
      { size: 'large', priceModifier: 50, displayName: '50cl' },
    ],
    calories: 105,
    allergens: [],
  },
  {
    id: 'DRINK_FUZE_TEA',
    name: 'FuzeTea Pêche',
    shortName: 'FuzeTea',
    category: 'drink',
    synonyms: ['fuze tea', 'fuzétea', 'ice tea', 'thé glacé', 'thé pêche', 'peach tea'],
    available: true,
    basePrice: 290,
    sizes: [
      { size: 'small', priceModifier: -60, displayName: '25cl' },
      { size: 'medium', priceModifier: 0, displayName: '35cl' },
      { size: 'large', priceModifier: 50, displayName: '50cl' },
    ],
    calories: 84,
    allergens: [],
  },
  {
    id: 'DRINK_TROPICO',
    name: 'Tropico',
    shortName: 'Tropico',
    category: 'drink',
    synonyms: ['tropico', 'tropical', 'jus tropical'],
    available: true,
    basePrice: 290,
    sizes: [
      { size: 'small', priceModifier: -60, displayName: '25cl' },
      { size: 'medium', priceModifier: 0, displayName: '35cl' },
      { size: 'large', priceModifier: 50, displayName: '50cl' },
    ],
    calories: 118,
    allergens: [],
  },
  {
    id: 'DRINK_OASIS',
    name: 'Oasis Tropical',
    shortName: 'Oasis',
    category: 'drink',
    synonyms: ['oasis', 'oasis tropical', 'oasis fruits'],
    available: true,
    basePrice: 290,
    sizes: [
      { size: 'small', priceModifier: -60, displayName: '25cl' },
      { size: 'medium', priceModifier: 0, displayName: '35cl' },
      { size: 'large', priceModifier: 50, displayName: '50cl' },
    ],
    calories: 98,
    allergens: [],
  },
  
  // Eaux
  {
    id: 'DRINK_VITTEL',
    name: 'Vittel',
    shortName: 'Eau',
    category: 'drink',
    synonyms: ['vittel', 'eau', 'eau plate', 'de l\'eau', 'une eau', 'bouteille d\'eau', 'water'],
    available: true,
    basePrice: 250,
    sizes: [
      { size: 'small', priceModifier: -50, displayName: '33cl' },
      { size: 'medium', priceModifier: 0, displayName: '50cl' },
    ],
    calories: 0,
    allergens: [],
  },
  {
    id: 'DRINK_SAN_PELLEGRINO',
    name: 'San Pellegrino',
    shortName: 'San Pellegrino',
    category: 'drink',
    synonyms: ['san pellegrino', 'eau gazeuse', 'pétillante', 'perrier', 'bulles'],
    available: true,
    basePrice: 290,
    calories: 0,
    allergens: [],
  },
  
  // Jus (pour enfants principalement)
  {
    id: 'DRINK_JUS_POMME',
    name: 'Jus de Pomme Bio',
    shortName: 'Jus Pomme',
    category: 'drink',
    synonyms: ['jus de pomme', 'pomme', 'jus pomme', 'apple juice'],
    available: true,
    basePrice: 200,
    calories: 95,
    allergens: [],
  },
  {
    id: 'DRINK_JUS_ORANGE',
    name: 'Jus d\'Orange Bio',
    shortName: 'Jus Orange',
    category: 'drink',
    synonyms: ['jus d\'orange', 'jus orange', 'orange juice'],
    available: true,
    basePrice: 200,
    calories: 90,
    allergens: [],
  },
  {
    id: 'DRINK_CAPRI_SUN',
    name: 'Capri-Sun',
    shortName: 'Capri-Sun',
    category: 'drink',
    synonyms: ['capri sun', 'caprisun', 'capri'],
    available: true,
    basePrice: 180,
    calories: 70,
    allergens: [],
  },
  
  // Bière (vérification âge requise)
  {
    id: 'DRINK_KRO',
    name: 'Kronenbourg 1664',
    shortName: '1664',
    category: 'drink',
    synonyms: ['1664', 'kronenbourg', 'kro', 'bière', 'une bière', 'beer'],
    available: true,
    basePrice: 350,
    calories: 145,
    allergens: ['gluten'],
    isAlcohol: true,
  },
  
  // Boissons chaudes
  {
    id: 'DRINK_ESPRESSO',
    name: 'Espresso',
    shortName: 'Espresso',
    category: 'drink',
    synonyms: ['espresso', 'café', 'expresso', 'un café', 'coffee'],
    available: true,
    basePrice: 150,
    calories: 2,
    allergens: [],
  },
  {
    id: 'DRINK_CAFE_ALLONGE',
    name: 'Café Allongé',
    shortName: 'Café Allongé',
    category: 'drink',
    synonyms: ['café allongé', 'café long', 'allongé', 'americano'],
    available: true,
    basePrice: 180,
    calories: 4,
    allergens: [],
  },
  {
    id: 'DRINK_THE',
    name: 'Thé',
    shortName: 'Thé',
    category: 'drink',
    synonyms: ['thé', 'un thé', 'tea', 'thé chaud'],
    available: true,
    basePrice: 180,
    calories: 0,
    allergens: [],
  },
  {
    id: 'DRINK_CHOCOLAT',
    name: 'Chocolat Chaud',
    shortName: 'Chocolat',
    category: 'drink',
    synonyms: ['chocolat chaud', 'chocolat', 'cacao', 'hot chocolate'],
    available: true,
    basePrice: 220,
    calories: 180,
    allergens: ['lait'],
  },
];

// ============================================
// DESSERTS
// ============================================

export const DESSERTS: Product[] = [
  // Mix Mania (Glaces mélangées)
  {
    id: 'DESSERT_MIX_LION',
    name: 'Mix Mania Lion',
    shortName: 'Mix Lion',
    category: 'dessert',
    synonyms: ['mix mania lion', 'mix lion', 'glace lion', 'lion'],
    available: true,
    basePrice: 390,
    calories: 320,
    allergens: ['gluten', 'lait', 'arachides'],
  },
  {
    id: 'DESSERT_MIX_KITKAT',
    name: 'Mix Mania KitKat',
    shortName: 'Mix KitKat',
    category: 'dessert',
    synonyms: ['mix mania kitkat', 'mix kitkat', 'glace kitkat', 'kitkat'],
    available: true,
    basePrice: 390,
    calories: 310,
    allergens: ['gluten', 'lait'],
  },
  {
    id: 'DESSERT_MIX_MMS',
    name: "Mix Mania M&M's",
    shortName: "Mix M&M's",
    category: 'dessert',
    synonyms: ['mix mania m&m', 'mix m&m', 'glace m&m', 'm and m', 'mms'],
    available: true,
    basePrice: 390,
    calories: 330,
    allergens: ['lait', 'arachides'],
  },
  {
    id: 'DESSERT_MIX_DAIM',
    name: 'Mix Mania Daim',
    shortName: 'Mix Daim',
    category: 'dessert',
    synonyms: ['mix mania daim', 'mix daim', 'glace daim', 'daim'],
    available: true,
    basePrice: 390,
    calories: 340,
    allergens: ['gluten', 'lait', 'amandes'],
  },
  {
    id: 'DESSERT_MIX_SNICKERS',
    name: 'Mix Mania Snickers',
    shortName: 'Mix Snickers',
    category: 'dessert',
    synonyms: ['mix mania snickers', 'mix snickers', 'glace snickers', 'snickers'],
    available: true,
    basePrice: 390,
    calories: 350,
    allergens: ['gluten', 'lait', 'arachides'],
  },
  
  // Softy (Glaces italiennes)
  {
    id: 'DESSERT_SOFTY_CHOCO',
    name: 'Softy Chocolat',
    shortName: 'Softy Choco',
    category: 'dessert',
    synonyms: ['softy chocolat', 'softy choco', 'glace italienne chocolat', 'cornet chocolat', 'softy'],
    available: true,
    basePrice: 250,
    sizes: [
      { size: 'small', priceModifier: -50, displayName: 'Mini' },
      { size: 'medium', priceModifier: 0, displayName: 'Normal' },
    ],
    calories: 180,
    allergens: ['lait'],
  },
  {
    id: 'DESSERT_SOFTY_CARAMEL',
    name: 'Softy Caramel',
    shortName: 'Softy Caramel',
    category: 'dessert',
    synonyms: ['softy caramel', 'glace italienne caramel', 'cornet caramel'],
    available: true,
    basePrice: 250,
    sizes: [
      { size: 'small', priceModifier: -50, displayName: 'Mini' },
      { size: 'medium', priceModifier: 0, displayName: 'Normal' },
    ],
    calories: 175,
    allergens: ['lait'],
  },
  {
    id: 'DESSERT_SOFTY_FRAISE',
    name: 'Softy Fraise',
    shortName: 'Softy Fraise',
    category: 'dessert',
    synonyms: ['softy fraise', 'glace italienne fraise', 'cornet fraise'],
    available: true,
    basePrice: 250,
    sizes: [
      { size: 'small', priceModifier: -50, displayName: 'Mini' },
      { size: 'medium', priceModifier: 0, displayName: 'Normal' },
    ],
    calories: 170,
    allergens: ['lait'],
  },
  
  // Milkshakes
  {
    id: 'DESSERT_MILKSHAKE_VANILLE',
    name: 'Milkshake Vanille',
    shortName: 'Milk Vanille',
    category: 'dessert',
    synonyms: ['milkshake vanille', 'milk vanille', 'shake vanille', 'milkshake'],
    available: true,
    basePrice: 390,
    calories: 420,
    allergens: ['lait'],
  },
  {
    id: 'DESSERT_MILKSHAKE_FRAISE',
    name: 'Milkshake Fraise',
    shortName: 'Milk Fraise',
    category: 'dessert',
    synonyms: ['milkshake fraise', 'milk fraise', 'shake fraise'],
    available: true,
    basePrice: 390,
    calories: 410,
    allergens: ['lait'],
  },
  {
    id: 'DESSERT_MILKSHAKE_CHOCOLAT',
    name: 'Milkshake Chocolat',
    shortName: 'Milk Choco',
    category: 'dessert',
    synonyms: ['milkshake chocolat', 'milk chocolat', 'shake chocolat', 'milk choco'],
    available: true,
    basePrice: 390,
    calories: 450,
    allergens: ['lait'],
  },
  {
    id: 'DESSERT_MILKSHAKE_BANANE',
    name: 'Milkshake Banane',
    shortName: 'Milk Banane',
    category: 'dessert',
    synonyms: ['milkshake banane', 'milk banane', 'shake banane'],
    available: true,
    basePrice: 390,
    calories: 400,
    allergens: ['lait'],
  },
  
  // Churros
  {
    id: 'DESSERT_CHURROS_5',
    name: 'Churros x5',
    shortName: 'Churros x5',
    category: 'dessert',
    synonyms: ['churros', '5 churros', 'churros x5', 'des churros'],
    available: true,
    basePrice: 350,
    calories: 350,
    allergens: ['gluten', 'lait'],
  },
  {
    id: 'DESSERT_CHURROS_10',
    name: 'Churros x10',
    shortName: 'Churros x10',
    category: 'dessert',
    synonyms: ['10 churros', 'churros x10', 'grosse portion churros', 'beaucoup de churros'],
    available: true,
    basePrice: 590,
    calories: 700,
    allergens: ['gluten', 'lait'],
  },
  
  // Pâtisseries
  {
    id: 'DESSERT_BEIGNET',
    name: 'Beignet Choco-Noisette',
    shortName: 'Beignet',
    category: 'dessert',
    synonyms: ['beignet', 'beignet chocolat', 'beignet noisette', 'donut'],
    available: true,
    basePrice: 250,
    calories: 280,
    allergens: ['gluten', 'lait', 'fruits à coque'],
  },
  {
    id: 'DESSERT_MUFFIN',
    name: 'Muffin Chocolat',
    shortName: 'Muffin',
    category: 'dessert',
    synonyms: ['muffin', 'muffin chocolat', 'muffin choco'],
    available: true,
    basePrice: 250,
    calories: 340,
    allergens: ['gluten', 'lait', 'œuf'],
  },
  {
    id: 'DESSERT_FONDANT',
    name: 'Fondant Chocolat',
    shortName: 'Fondant',
    category: 'dessert',
    synonyms: ['fondant', 'fondant chocolat', 'moelleux chocolat', 'coulant'],
    available: true,
    basePrice: 290,
    calories: 380,
    allergens: ['gluten', 'lait', 'œuf'],
  },
  {
    id: 'DESSERT_DONUT',
    name: 'Donut',
    shortName: 'Donut',
    category: 'dessert',
    synonyms: ['donut', 'doughnut', 'un donut'],
    available: true,
    basePrice: 220,
    calories: 250,
    allergens: ['gluten', 'lait', 'œuf'],
  },
  
  // Desserts enfants
  {
    id: 'DESSERT_POMPOTES',
    name: "Pom'Potes",
    shortName: 'Pom Potes',
    category: 'dessert',
    synonyms: ['pom potes', 'pompotes', 'compote', 'gourde'],
    available: true,
    basePrice: 150,
    calories: 70,
    allergens: [],
  },
  {
    id: 'DESSERT_DANONINO',
    name: 'Danonino',
    shortName: 'Danonino',
    category: 'dessert',
    synonyms: ['danonino', 'petit suisse', 'yaourt', 'danone'],
    available: true,
    basePrice: 150,
    calories: 85,
    allergens: ['lait'],
  },
  {
    id: 'DESSERT_GLACE_BATONNET',
    name: 'Glace Bâtonnet',
    shortName: 'Glace Bâtonnet',
    category: 'dessert',
    synonyms: ['glace bâtonnet', 'glace enfant', 'esquimau', 'bâtonnet'],
    available: true,
    basePrice: 180,
    calories: 120,
    allergens: ['lait'],
  },
];

// ============================================
// SAUCES (Gratuites avec menus/frites)
// ============================================

export const SAUCES: Product[] = [
  {
    id: 'SAUCE_KETCHUP',
    name: 'Ketchup',
    shortName: 'Ketchup',
    category: 'sauce',
    synonyms: ['ketchup', 'sauce ketchup', 'sauce tomate'],
    available: true,
    basePrice: 0,                 // Gratuit avec menu
    calories: 20,
    allergens: [],
  },
  {
    id: 'SAUCE_MAYO',
    name: 'Mayonnaise',
    shortName: 'Mayo',
    category: 'sauce',
    synonyms: ['mayonnaise', 'mayo', 'sauce mayo'],
    available: true,
    basePrice: 0,
    calories: 90,
    allergens: ['œuf', 'moutarde'],
  },
  {
    id: 'SAUCE_BBQ',
    name: 'Sauce Barbecue',
    shortName: 'BBQ',
    category: 'sauce',
    synonyms: ['barbecue', 'bbq', 'sauce barbecue', 'sauce bbq'],
    available: true,
    basePrice: 0,
    calories: 30,
    allergens: [],
  },
  {
    id: 'SAUCE_CURRY',
    name: 'Sauce Curry',
    shortName: 'Curry',
    category: 'sauce',
    synonyms: ['curry', 'sauce curry'],
    available: true,
    basePrice: 0,
    calories: 40,
    allergens: ['moutarde'],
  },
  {
    id: 'SAUCE_MOUTARDE',
    name: 'Sauce Moutarde',
    shortName: 'Moutarde',
    category: 'sauce',
    synonyms: ['moutarde', 'sauce moutarde', 'mustard'],
    available: true,
    basePrice: 0,
    calories: 25,
    allergens: ['moutarde'],
  },
  {
    id: 'SAUCE_POMMES_FRITES',
    name: 'Sauce Pommes-Frites',
    shortName: 'Sauce Blanche',
    category: 'sauce',
    synonyms: ['sauce pommes frites', 'sauce blanche', 'sauce frites', 'sauce pf', 'blanche'],
    available: true,
    basePrice: 0,
    calories: 85,
    allergens: ['œuf', 'moutarde'],
  },
  {
    id: 'SAUCE_GIANT',
    name: 'Sauce Giant',
    shortName: 'Sauce Giant',
    category: 'sauce',
    synonyms: ['sauce giant', 'giant sauce', 'sauce du giant'],
    available: true,
    basePrice: 0,
    calories: 75,
    allergens: ['œuf', 'moutarde'],
  },
  {
    id: 'SAUCE_CHINOISE',
    name: 'Sauce Chinoise',
    shortName: 'Chinoise',
    category: 'sauce',
    synonyms: ['sauce chinoise', 'chinoise', 'sauce aigre douce', 'aigre douce'],
    available: true,
    basePrice: 0,
    calories: 35,
    allergens: ['soja'],
  },
];

// ============================================
// TOYS (Pour Magic Box)
// ============================================

export const TOYS: Product[] = [
  {
    id: 'TOY_GIRL',
    name: 'Jouet Fille',
    shortName: 'Cadeau Fille',
    category: 'extra',
    synonyms: ['fille', 'cadeau fille', 'jouet fille'],
    available: true,
    basePrice: 0,
  },
  {
    id: 'TOY_BOY',
    name: 'Jouet Garçon',
    shortName: 'Cadeau Garçon',
    category: 'extra',
    synonyms: ['garçon', 'cadeau garçon', 'jouet garçon'],
    available: true,
    basePrice: 0,
  },
];

// ============================================
// MENU RULES - Règles d'association Quick
// ============================================

export const MENU_RULES: MenuRule[] = [
  // ========================================
  // MENU ADULTE NORMAL
  // Burger + Accompagnement Moyen + Boisson 35cl
  // ========================================
  {
    menuType: 'adult_normal',
    displayName: 'Menu Normal',
    displayNameFr: 'Menu',
    baseMenuSupplement: 300,      // +3€ par rapport au burger seul
    components: [
      {
        type: 'main',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: BURGERS.filter(b => b.availableInMenu).map(b => b.id),
        includedInPrice: true,
      },
      {
        type: 'side',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['SIDE_FRITES', 'SIDE_RUSTIQUES'],
        defaultProductId: 'SIDE_FRITES',
        defaultSize: 'medium',    // Moyenne
        includedInPrice: true,
        upgradeOptions: [
          { productId: 'SIDE_RUSTIQUES', extraPrice: 40, displayName: 'Rustiques (+0,40€)' },
        ],
      },
      {
        type: 'drink',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: DRINKS.filter(d => !d.isAlcohol && d.sizes).map(d => d.id),
        defaultProductId: 'DRINK_COCA',
        defaultSize: 'medium',    // 35cl
        includedInPrice: true,
      },
    ],
    requiredQuestions: [],
  },
  
  // ========================================
  // MENU ADULTE MAXI (XL)
  // Burger + Accompagnement Grand + Boisson 50cl
  // ========================================
  {
    menuType: 'adult_maxi',
    displayName: 'Menu Maxi',
    displayNameFr: 'Menu Maxi',
    baseMenuSupplement: 500,      // +5€ par rapport au burger seul
    components: [
      {
        type: 'main',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: BURGERS.filter(b => b.availableInMenu).map(b => b.id),
        includedInPrice: true,
      },
      {
        type: 'side',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['SIDE_FRITES', 'SIDE_RUSTIQUES'],
        defaultProductId: 'SIDE_FRITES',
        defaultSize: 'large',     // Grande
        includedInPrice: true,
        upgradeOptions: [
          { productId: 'SIDE_RUSTIQUES', extraPrice: 40, displayName: 'Rustiques (+0,40€)' },
        ],
      },
      {
        type: 'drink',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: DRINKS.filter(d => !d.isAlcohol && d.sizes).map(d => d.id),
        defaultProductId: 'DRINK_COCA',
        defaultSize: 'large',     // 50cl
        includedInPrice: true,
      },
    ],
    requiredQuestions: [],
  },
  
  // ========================================
  // MAGIC BOX (4-7 ans)
  // Plat + Accomp + Boisson + Dessert + Surprise
  // Prix fixe: 6.50€
  // ========================================
  {
    menuType: 'magic_box',
    displayName: 'Magic Box',
    displayNameFr: 'Magic Box',
    baseMenuSupplement: 0,
    fixedPrice: 650,              // 6.50€ prix fixe
    components: [
      {
        type: 'main',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['BURG_HAMBURGER', 'BURG_CHEESEBURGER', 'FINGER_CHICKEN_DIPS'],
        defaultProductId: 'BURG_CHEESEBURGER',
        includedInPrice: true,
      },
      {
        type: 'side',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['SIDE_FRITES', 'SIDE_TOMATES'],
        defaultProductId: 'SIDE_FRITES',
        defaultSize: 'small',     // Petite
        includedInPrice: true,
      },
      {
        type: 'drink',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['DRINK_VITTEL', 'DRINK_JUS_POMME', 'DRINK_JUS_ORANGE', 'DRINK_CAPRI_SUN'],
        defaultProductId: 'DRINK_VITTEL',
        includedInPrice: true,
      },
      {
        type: 'dessert',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['DESSERT_POMPOTES', 'DESSERT_DANONINO', 'DESSERT_GLACE_BATONNET'],
        defaultProductId: 'DESSERT_POMPOTES',
        includedInPrice: true,
      },
      {
        type: 'toy',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['TOY_GIRL', 'TOY_BOY'],
        includedInPrice: true,
      },
    ],
    // IMPORTANT: Toujours demander le choix du cadeau
    requiredQuestions: ['Cadeau Fille ou Garçon ?'],
  },
  
  // ========================================
  // FUN BOX (Ados/Grands enfants)
  // Plat + Accomp + Boisson + Dessert
  // Prix fixe: 7.90€
  // ========================================
  {
    menuType: 'fun_box',
    displayName: 'Fun Box',
    displayNameFr: 'Fun Box',
    baseMenuSupplement: 0,
    fixedPrice: 790,              // 7.90€ prix fixe
    components: [
      {
        type: 'main',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['BURG_GIANT_JR', 'BURG_LONG_BACON_JR', 'BURG_CHEESEBURGER', 'FINGER_CHICKEN_DIPS'],
        defaultProductId: 'BURG_GIANT_JR',
        includedInPrice: true,
      },
      {
        type: 'side',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['SIDE_FRITES', 'SIDE_RUSTIQUES'],
        defaultProductId: 'SIDE_FRITES',
        defaultSize: 'medium',    // Moyenne
        includedInPrice: true,
      },
      {
        type: 'drink',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: DRINKS.filter(d => !d.isAlcohol).map(d => d.id),
        defaultProductId: 'DRINK_COCA',
        defaultSize: 'small',     // 25cl
        includedInPrice: true,
      },
      {
        type: 'dessert',
        required: true,
        min: 1,
        max: 1,
        allowedProductIds: ['DESSERT_SOFTY_CHOCO', 'DESSERT_SOFTY_CARAMEL', 'DESSERT_SOFTY_FRAISE'],
        defaultProductId: 'DESSERT_SOFTY_CHOCO',
        defaultSize: 'small',     // Mini
        includedInPrice: true,
      },
    ],
    requiredQuestions: [],
  },
];

// ============================================
// PRIX FIXES MENUS ENFANTS
// ============================================

export const KIDS_MENU_PRICES = {
  magic_box: 650,                 // 6.50€
  fun_box: 790,                   // 7.90€
};

// ============================================
// FULL CATALOGUE
// ============================================

export const FULL_CATALOGUE: Product[] = [
  ...BURGERS,
  ...SIDES,
  ...FINGER_FOODS,
  ...DRINKS,
  ...DESSERTS,
  ...SAUCES,
  ...TOYS,
];

// ============================================
// CATALOGUE SERVICE
// ============================================

export class CatalogueService {
  private catalogue: Map<string, Product>;
  private synonymIndex: Map<string, string>;     // synonym → productId
  private menuRules: MenuRule[];
  
  constructor() {
    this.catalogue = new Map();
    this.synonymIndex = new Map();
    this.menuRules = MENU_RULES;
    
    // Index products
    for (const product of FULL_CATALOGUE) {
      this.catalogue.set(product.id, product);
      
      // Index synonyms
      for (const synonym of product.synonyms) {
        this.synonymIndex.set(synonym.toLowerCase(), product.id);
      }
      // Also index the name itself
      this.synonymIndex.set(product.name.toLowerCase(), product.id);
      this.synonymIndex.set(product.shortName.toLowerCase(), product.id);
    }
  }
  
  getCatalogue(storeId: string): Product[] {
    // Could filter by store availability
    return Array.from(this.catalogue.values());
  }
  
  getProduct(productId: string): Product | undefined {
    return this.catalogue.get(productId);
  }
  
  getMenuRules(storeId: string): MenuRule[] {
    return this.menuRules;
  }
  
  /**
   * Resolve a product name (from NLU) to a Product
   * Uses fuzzy matching if exact match not found
   */
  resolveProduct(name: string, storeId: string): Product | undefined {
    const normalized = name.toLowerCase().trim();
    
    // Exact match on synonym
    const exactMatch = this.synonymIndex.get(normalized);
    if (exactMatch) {
      return this.catalogue.get(exactMatch);
    }
    
    // Fuzzy match using Jaro-Winkler
    let bestMatch: { productId: string; score: number } | null = null;
    
    for (const [synonym, productId] of this.synonymIndex.entries()) {
      const score = this.jaroWinkler(normalized, synonym);
      if (score > 0.85 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { productId, score };
      }
    }
    
    if (bestMatch) {
      return this.catalogue.get(bestMatch.productId);
    }
    
    return undefined;
  }
  
  /**
   * Find alternatives for an unavailable product
   */
  findAlternatives(productId: string, storeId: string): Product[] {
    const product = this.catalogue.get(productId);
    if (!product) return [];
    
    return Array.from(this.catalogue.values())
      .filter(p => 
        p.category === product.category && 
        p.id !== productId && 
        p.available
      )
      .slice(0, 3);
  }
  
  /**
   * Check real-time availability
   */
  async checkRealTimeAvailability(productId: string, storeId: string): Promise<boolean> {
    const product = this.catalogue.get(productId);
    if (!product) return false;
    return product.available;
  }
  
  /**
   * Jaro-Winkler similarity algorithm
   */
  private jaroWinkler(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;
    
    const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);
    
    let matches = 0;
    let transpositions = 0;
    
    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, s2.length);
      
      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
    
    if (matches === 0) return 0;
    
    let k = 0;
    for (let i = 0; i < s1.length; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
    
    const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
    
    // Winkler prefix bonus
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }
    
    return jaro + prefix * 0.1 * (1 - jaro);
  }
}
```

### 2.4.3 Order Engine — Implémentation Complète

```typescript
// ============================================
// order-engine.ts - Pure Business Logic
// ============================================

import { randomUUID } from 'crypto';
import {
  Order, OrderItem, OrderItemComponent, Product, MenuRule,
  ParsedOrderItem, ValidationResult, ValidationError, ValidationWarning,
  OrderEngineResult, ProductSize, MenuType
} from './types';
import { CatalogueService, KIDS_MENU_PRICES, MENU_RULES } from './catalogue';

// ============================================
// CONSTANTS
// ============================================

const TVA_RATE = 0.055;           // 5.5% TVA emporter (drive-thru)
const MAX_QUANTITY_PER_ITEM = 10;
const MAX_ITEMS_PER_ORDER = 20;
const MAX_SAUCES_FREE = 3;        // Sauces gratuites par menu

// ============================================
// ORDER ENGINE
// ============================================

export class OrderEngine {
  
  /**
   * Create an empty order
   */
  createEmptyOrder(sessionId: string, storeId: string): Order {
    return {
      id: randomUUID(),
      sessionId,
      storeId,
      items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
      currency: 'EUR',
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
  
  /**
   * Add an item to the order
   */
  addItemToOrder(
    currentOrder: Order,
    parsedItem: ParsedOrderItem,
    catalogue: Product[],
    menuRules: MenuRule[]
  ): OrderEngineResult<Order> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    // 1. Find the product
    const product = this.findProduct(parsedItem, catalogue);
    
    if (!product) {
      return {
        success: false,
        errors: [{
          code: 'PRODUCT_NOT_FOUND',
          message: `Product "${parsedItem.productName}" not found`,
          messageFr: `Désolé, "${parsedItem.productName}" n'existe pas dans notre menu.`,
          recoverable: false,
        }]
      };
    }
    
    // 2. Check availability
    if (!product.available) {
      const alternatives = catalogue
        .filter(p => p.category === product.category && p.available)
        .slice(0, 3)
        .map(p => p.name);
      
      return {
        success: false,
        errors: [{
          code: 'PRODUCT_UNAVAILABLE',
          message: `${product.name} is not available`,
          messageFr: `Désolé, ${product.name} n'est plus disponible.`,
          recoverable: true,
          suggestion: alternatives.length > 0 
            ? `Puis-je vous proposer ${alternatives.join(' ou ')} ?`
            : undefined,
        }]
      };
    }
    
    // 3. Validate and cap quantity
    const quantity = Math.min(Math.max(1, parsedItem.quantity), MAX_QUANTITY_PER_ITEM);
    if (parsedItem.quantity > MAX_QUANTITY_PER_ITEM) {
      warnings.push({
        code: 'QUANTITY_ADJUSTED',
        message: `Quantity capped at ${MAX_QUANTITY_PER_ITEM}`,
        messageFr: `La quantité a été limitée à ${MAX_QUANTITY_PER_ITEM} maximum.`,
      });
    }
    
    // 4. Check max items
    if (currentOrder.items.length >= MAX_ITEMS_PER_ORDER) {
      return {
        success: false,
        errors: [{
          code: 'MAX_ITEMS_REACHED',
          message: 'Maximum items per order reached',
          messageFr: 'La commande a atteint le nombre maximum d\'articles.',
          recoverable: false,
        }]
      };
    }
    
    // 5. Build order item based on type
    let orderItem: OrderItem;
    
    if (product.category === 'burger' && parsedItem.menuType) {
      // Menu adulte
      const result = this.buildMenuOrderItem(product, parsedItem, quantity, catalogue, menuRules);
      if (!result.success) return result;
      orderItem = result.data!;
      if (result.warnings) warnings.push(...result.warnings);
      
    } else if (product.category === 'finger_food' && product.portionSizes) {
      // Finger food avec portions
      orderItem = this.buildFingerFoodOrderItem(product, parsedItem, quantity);
      
    } else {
      // Produit standard
      orderItem = this.buildStandardOrderItem(product, parsedItem, quantity);
    }
    
    // 6. Create updated order
    const newItems = [...currentOrder.items, orderItem];
    const totals = this.calculateTotals(newItems);
    
    return {
      success: true,
      data: {
        ...currentOrder,
        items: newItems,
        ...totals,
        updatedAt: new Date(),
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
  
  /**
   * Find product by name or ID
   */
  private findProduct(parsedItem: ParsedOrderItem, catalogue: Product[]): Product | undefined {
    // Try by ID first
    if (parsedItem.productId) {
      const byId = catalogue.find(p => p.id === parsedItem.productId);
      if (byId) return byId;
    }
    
    // Try by exact name
    const byName = catalogue.find(p => 
      p.name.toLowerCase() === parsedItem.productName.toLowerCase()
    );
    if (byName) return byName;
    
    // Try by synonym
    const bySynonym = catalogue.find(p => 
      p.synonyms.some(s => s.toLowerCase() === parsedItem.productName.toLowerCase())
    );
    if (bySynonym) return bySynonym;
    
    // Try partial match
    const byPartial = catalogue.find(p => 
      p.name.toLowerCase().includes(parsedItem.productName.toLowerCase()) ||
      p.synonyms.some(s => s.toLowerCase().includes(parsedItem.productName.toLowerCase()))
    );
    
    return byPartial;
  }
  
  /**
   * Build a menu order item
   */
  private buildMenuOrderItem(
    burger: Product,
    parsedItem: ParsedOrderItem,
    quantity: number,
    catalogue: Product[],
    menuRules: MenuRule[]
  ): OrderEngineResult<OrderItem> {
    const menuType = parsedItem.menuType || 'normal';
    const menuRuleType = menuType === 'maxi' ? 'adult_maxi' : 'adult_normal';
    const menuRule = menuRules.find(r => r.menuType === menuRuleType);
    
    if (!menuRule) {
      return {
        success: false,
        errors: [{
          code: 'MENU_RULE_NOT_FOUND',
          message: 'Menu configuration not found',
          messageFr: 'Configuration de menu introuvable.',
          recoverable: false,
        }]
      };
    }
    
    // Get menu price
    const menuPrice = menuType === 'maxi' ? burger.menuPriceMaxi : burger.menuPriceNormal;
    
    if (!menuPrice) {
      return {
        success: false,
        errors: [{
          code: 'BURGER_NOT_IN_MENU',
          message: `${burger.name} not available as menu`,
          messageFr: `${burger.name} n'est pas disponible en menu.`,
          recoverable: true,
        }]
      };
    }
    
    // Build components
    const components: OrderItemComponent[] = [];
    let totalExtraPrice = 0;
    
    // Side component
    const sideResult = this.buildMenuComponent('side', parsedItem, menuRule, catalogue);
    if (sideResult.component) {
      components.push(sideResult.component);
      totalExtraPrice += sideResult.component.extraPrice;
    }
    
    // Drink component
    const drinkResult = this.buildMenuComponent('drink', parsedItem, menuRule, catalogue);
    if (drinkResult.component) {
      components.push(drinkResult.component);
      totalExtraPrice += drinkResult.component.extraPrice;
    }
    
    const unitPrice = menuPrice + totalExtraPrice;
    
    return {
      success: true,
      data: {
        id: randomUUID(),
        productId: burger.id,
        name: `Menu ${burger.name}${menuType === 'maxi' ? ' Maxi' : ''}`,
        category: 'menu',
        qty: quantity,
        menuType: menuType as MenuType,
        unitPrice,
        linePrice: unitPrice * quantity,
        components,
        sauces: [],
      }
    };
  }
  
  /**
   * Build a menu component (side or drink)
   */
  private buildMenuComponent(
    type: 'side' | 'drink' | 'dessert',
    parsedItem: ParsedOrderItem,
    menuRule: MenuRule,
    catalogue: Product[]
  ): { component: OrderItemComponent | null } {
    const componentRule = menuRule.components.find(c => c.type === type);
    if (!componentRule) return { component: null };
    
    const parsed = parsedItem.components?.find(c => c.type === type);
    let product: Product | undefined;
    let size = componentRule.defaultSize;
    let extraPrice = 0;
    
    if (parsed) {
      // Find requested product
      product = catalogue.find(p => 
        componentRule.allowedProductIds.includes(p.id) &&
        (p.id === parsed.productId || 
         p.name.toLowerCase().includes(parsed.productName.toLowerCase()) ||
         p.synonyms.some(s => s.toLowerCase().includes(parsed.productName.toLowerCase())))
      );
      if (parsed.size) size = parsed.size;
    }
    
    // Use default if not found
    if (!product && componentRule.defaultProductId) {
      product = catalogue.find(p => p.id === componentRule.defaultProductId);
    }
    
    if (!product) return { component: null };
    
    // Check for upgrade price
    const upgrade = componentRule.upgradeOptions?.find(u => u.productId === product!.id);
    if (upgrade) {
      extraPrice = upgrade.extraPrice;
    }
    
    return {
      component: {
        type,
        productId: product.id,
        name: product.name,
        size,
        extraPrice,
      }
    };
  }
  
  /**
   * Build a finger food order item
   */
  private buildFingerFoodOrderItem(
    product: Product,
    parsedItem: ParsedOrderItem,
    quantity: number
  ): OrderItem {
    const portion = product.portionSizes?.[0];
    const unitPrice = portion?.price || product.basePrice;
    const portionName = portion?.displayName || '';
    
    return {
      id: randomUUID(),
      productId: product.id,
      name: `${product.name} ${portionName}`.trim(),
      category: product.category,
      qty: quantity,
      unitPrice,
      linePrice: unitPrice * quantity,
    };
  }
  
  /**
   * Build a standard order item
   */
  private buildStandardOrderItem(
    product: Product,
    parsedItem: ParsedOrderItem,
    quantity: number
  ): OrderItem {
    let unitPrice = product.basePrice;
    const size = parsedItem.size;
    
    // Apply size modifier
    if (size && product.sizes) {
      const sizeConfig = product.sizes.find(s => s.size === size);
      if (sizeConfig) {
        unitPrice += sizeConfig.priceModifier;
      }
    }
    
    return {
      id: randomUUID(),
      productId: product.id,
      name: product.name,
      category: product.category,
      qty: quantity,
      size,
      unitPrice,
      linePrice: unitPrice * quantity,
    };
  }
  
  /**
   * Remove an item from the order
   */
  removeItemFromOrder(currentOrder: Order, itemIndex: number): OrderEngineResult<Order> {
    if (itemIndex < 0 || itemIndex >= currentOrder.items.length) {
      return {
        success: false,
        errors: [{
          code: 'ITEM_NOT_FOUND',
          message: 'Item not found',
          messageFr: 'Article non trouvé dans la commande.',
          recoverable: false,
        }]
      };
    }
    
    const newItems = [
      ...currentOrder.items.slice(0, itemIndex),
      ...currentOrder.items.slice(itemIndex + 1)
    ];
    
    return {
      success: true,
      data: {
        ...currentOrder,
        items: newItems,
        ...this.calculateTotals(newItems),
        updatedAt: new Date(),
      }
    };
  }
  
  /**
   * Validate order before sending to POS
   */
  validateOrder(
    order: Order,
    catalogue: Product[],
    menuRules: MenuRule[]
  ): OrderEngineResult<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    // Empty order
    if (order.items.length === 0) {
      errors.push({
        code: 'EMPTY_ORDER',
        message: 'Order is empty',
        messageFr: 'La commande est vide.',
        recoverable: true,
      });
    }
    
    // Validate each item
    for (const item of order.items) {
      const product = catalogue.find(p => p.id === item.productId);
      
      if (!product) {
        errors.push({
          code: 'INVALID_PRODUCT',
          message: `Product ${item.productId} not found`,
          messageFr: `Produit "${item.name}" introuvable.`,
          itemId: item.id,
          recoverable: false,
        });
        continue;
      }
      
      if (!product.available) {
        errors.push({
          code: 'PRODUCT_UNAVAILABLE',
          message: `${product.name} no longer available`,
          messageFr: `${product.name} n'est plus disponible.`,
          itemId: item.id,
          recoverable: true,
        });
      }
      
      if (item.qty < 1 || item.qty > MAX_QUANTITY_PER_ITEM) {
        errors.push({
          code: 'INVALID_QUANTITY',
          message: `Invalid quantity for ${product.name}`,
          messageFr: `Quantité invalide pour ${product.name}.`,
          itemId: item.id,
          recoverable: true,
        });
      }
      
      // Validate menu components
      if (item.category === 'menu' && item.components) {
        const menuRule = menuRules.find(r => 
          r.menuType === (item.menuType === 'maxi' ? 'adult_maxi' : 'adult_normal')
        );
        
        if (menuRule) {
          for (const required of menuRule.components.filter(c => c.required)) {
            if (!item.components.some(c => c.type === required.type)) {
              const typeFr = required.type === 'side' ? 'accompagnement' : 
                            required.type === 'drink' ? 'boisson' : 'composant';
              errors.push({
                code: 'MISSING_MENU_COMPONENT',
                message: `Menu missing ${required.type}`,
                messageFr: `Il manque ${typeFr === 'accompagnement' ? 'l\'' : 'la '}${typeFr} dans le menu.`,
                itemId: item.id,
                recoverable: true,
              });
            }
          }
        }
      }
    }
    
    return {
      success: true,
      data: {
        valid: errors.length === 0,
        errors,
        warnings,
      }
    };
  }
  
  /**
   * Calculate order totals
   */
  calculateTotals(items: OrderItem[]): { subtotal: number; tax: number; total: number } {
    const subtotal = items.reduce((sum, item) => sum + item.linePrice, 0);
    const tax = Math.round(subtotal * TVA_RATE);
    const total = subtotal + tax;
    
    return { subtotal, tax, total };
  }
  
  /**
   * Generate order summary for TTS
   */
  generateOrderSummary(order: Order, format: 'short' | 'full'): string {
    if (order.items.length === 0) {
      return 'La commande est vide.';
    }
    
    if (format === 'short') {
      const items = order.items.map(i => `${i.qty} ${i.name}`).join(', ');
      return `${items}, total ${this.formatPrice(order.total)}`;
    }
    
    const lines = order.items.map(item => {
      let line = `${item.qty}x ${item.name}`;
      if (item.components?.length) {
        line += ` (${item.components.map(c => c.name).join(', ')})`;
      }
      line += ` - ${this.formatPrice(item.linePrice)}`;
      return line;
    });
    
    lines.push(`Total: ${this.formatPrice(order.total)}`);
    return lines.join('\n');
  }
  
  /**
   * Format price for display/TTS
   */
  formatPrice(cents: number): string {
    const euros = Math.floor(cents / 100);
    const centimes = cents % 100;
    if (centimes === 0) {
      return `${euros} euros`;
    }
    return `${euros} euros ${centimes}`;
  }
}
```

---

## 2.5 GESTION MULTI-LOCUTEURS (Famille/Groupe)

Un des défis majeurs du drive-thru vocal est la gestion des situations où plusieurs personnes parlent simultanément (famille avec enfants, groupe d'amis, etc.).

### 2.5.1 Le Problème

```
Situation typique:
┌─────────────────────────────────────────────────────────────┐
│  Parent:    "Je voudrais un menu Gi-"                       │
│  Enfant 1:  "MOI JE VEUX DES NUGGETS!"                      │
│  Enfant 2:  "COCA! COCA! COCA!"                             │
│  Parent:    "-ant avec..."                                  │
│  Passager:  "Prends-moi un Long Fish"                       │
│  Enfant 1:  "ET UN JOUET!"                                  │
└─────────────────────────────────────────────────────────────┘

Résultat audio: Chaos total, signal incompréhensible
```

**Statistiques terrain:**
- ~30% des commandes drive-thru impliquent plusieurs locuteurs
- ~15% ont des overlaps significatifs (>2 secondes)
- Les familles avec enfants représentent ~40% du chaos audio

### 2.5.2 Architecture de Détection

```
┌─────────────────────────────────────────────────────────────────┐
│                    DRIVE-THRU MICROPHONE                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PRE-PROCESSING LAYER                           │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │ Noise Reduction │→ │ Voice Activity  │→ │   Overlap      │  │
│  │   (RNNoise)     │  │   Detection     │  │   Detection    │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
│                                                      │          │
│                              ┌────────────────────────┘          │
│                              ▼                                   │
│                    ┌─────────────────┐                          │
│                    │    Overlap?     │                          │
│                    └─────────────────┘                          │
│                       │           │                              │
│                      YES          NO                             │
│                       │           │                              │
│         ┌─────────────┘           └──────────────┐              │
│         ▼                                        ▼              │
│  ┌─────────────────┐                   ┌─────────────────┐      │
│  │    Speaker      │                   │   Pass-through  │      │
│  │  Diarization    │                   │   to Realtime   │      │
│  │  (Pyannote)     │                   │      API        │      │
│  └─────────────────┘                   └─────────────────┘      │
│         │                                        │              │
│         ▼                                        │              │
│  ┌─────────────────┐                             │              │
│  │ Select Dominant │                             │              │
│  │    Speaker      │                             │              │
│  └─────────────────┘                             │              │
│         │                                        │              │
│         └──────────────┬─────────────────────────┘              │
│                        ▼                                        │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 OPENAI REALTIME API                             │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              MULTI-SPEAKER STATE MANAGER                        │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │ Overlap Counter │    │  Confirmation   │                    │
│  │   & History     │    │    Frequency    │                    │
│  └─────────────────┘    └─────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.5.3 Types et Interfaces

```typescript
// ============================================
// multi-speaker-types.ts
// ============================================

/**
 * Configuration pour la détection multi-locuteurs
 */
export interface MultiSpeakerConfig {
  // Activation du mode
  enabled: boolean;
  
  // Preprocessing audio
  preprocessing: {
    // Modèle de diarization (séparation locuteurs)
    diarizationModel: 'pyannote/speaker-diarization-3.1' | 'speechbrain' | 'none';
    
    // Activer la séparation des flux par locuteur
    separateSpeakerStreams: boolean;
    
    // Nombre max de locuteurs à tracker
    maxSpeakers: number;
    
    // Seuil de détection d'overlap (0-1)
    overlapDetectionThreshold: number;
  };
  
  // Analyse post-transcription
  postprocessing: {
    // Détecter les overlaps dans la transcription
    detectOverlappingSpeech: boolean;
    
    // Seuil de confiance pour considérer un overlap
    confidenceThreshold: number;
  };
  
  // Comportement UX
  behavior: {
    // Nombre d'overlaps avant intervention polie
    overlapsBeforeIntervention: number;
    
    // Nombre max de clarifications avant escalade humain
    maxClarificationsBeforeHuman: number;
    
    // Confirmer après chaque item en mode multi-locuteur
    confirmAfterEachItem: boolean;
    
    // Délai supplémentaire après overlap (ms)
    waitAfterOverlapMs: number;
  };
}

/**
 * Configuration par défaut
 */
export const DEFAULT_MULTI_SPEAKER_CONFIG: MultiSpeakerConfig = {
  enabled: true,
  preprocessing: {
    diarizationModel: 'pyannote/speaker-diarization-3.1',
    separateSpeakerStreams: true,
    maxSpeakers: 4,
    overlapDetectionThreshold: 0.6,
  },
  postprocessing: {
    detectOverlappingSpeech: true,
    confidenceThreshold: 0.5,
  },
  behavior: {
    overlapsBeforeIntervention: 2,
    maxClarificationsBeforeHuman: 5,
    confirmAfterEachItem: true,
    waitAfterOverlapMs: 1500,
  },
};

/**
 * Événement d'overlap détecté
 */
export interface OverlapEvent {
  timestamp: Date;
  
  // Overlap détecté ?
  detected: boolean;
  
  // Niveau de confiance (0-1)
  confidence: number;
  
  // Nombre estimé de locuteurs simultanés
  estimatedSpeakers: number;
  
  // Durée de l'overlap en ms
  durationMs: number;
  
  // Audio du locuteur dominant (si extraction possible)
  dominantSpeakerAudio?: ArrayBuffer;
  
  // Caractéristiques vocales détectées
  voiceCharacteristics?: {
    hasChildVoice: boolean;        // Voix enfant détectée
    hasMultipleAdults: boolean;    // Plusieurs adultes
    dominantPitch: 'low' | 'medium' | 'high';
  };
}

/**
 * État de session multi-locuteurs
 */
export interface MultiSpeakerSessionState {
  // Mode multi-locuteur activé
  isMultiSpeakerMode: boolean;
  
  // Timestamp d'activation
  activatedAt?: Date;
  
  // Nombre de locuteurs détectés dans la session
  detectedSpeakersCount: number;
  
  // Historique des overlaps
  overlapHistory: OverlapEvent[];
  
  // Compteur d'overlaps non résolus
  unresolvedOverlaps: number;
  
  // Compteur de clarifications demandées
  clarificationCount: number;
  
  // Items depuis dernière confirmation
  itemsSinceLastConfirmation: number;
  
  // Dernier locuteur dominant identifié
  lastDominantSpeakerId?: string;
  
  // Enfant détecté dans la voiture
  childDetected: boolean;
  
  // Commande enfant proposée
  kidsMenuOffered: boolean;
}

/**
 * Réponse du handler d'overlap
 */
export interface OverlapHandlerResponse {
  action: 
    | 'PROCESS_DOMINANT'      // Traiter l'audio du locuteur dominant
    | 'REQUEST_REPEAT'        // Demander de répéter
    | 'REQUEST_ONE_SPEAKER'   // Demander qu'une personne parle
    | 'ESCALATE_TO_HUMAN'     // Passer à un humain
    | 'WAIT_AND_RETRY';       // Attendre et réessayer
  
  // Message à dire au client
  response?: string;
  
  // Audio à traiter (si PROCESS_DOMINANT)
  audioToProcess?: ArrayBuffer;
  
  // Interrompre l'audio en cours ?
  interruptCurrentAudio: boolean;
  
  // Priorité du message
  priority: 'low' | 'medium' | 'high';
  
  // Activer le mode multi-locuteur pour le reste de la session
  enableMultiSpeakerMode: boolean;
}

/**
 * Détection de locuteur dominant
 */
export interface DominantSpeakerDetection {
  // Métriques de scoring
  metrics: {
    // Poids du volume relatif
    volumeWeight: number;
    
    // Poids de la clarté du signal
    signalClarityWeight: number;
    
    // Poids de la continuité conversationnelle
    conversationContinuityWeight: number;
  };
  
  // Fenêtre d'analyse en ms
  analysisWindowMs: number;
  
  // Seuil pour changement de locuteur dominant
  switchThreshold: number;
}

export const DEFAULT_DOMINANT_SPEAKER_CONFIG: DominantSpeakerDetection = {
  metrics: {
    volumeWeight: 0.3,
    signalClarityWeight: 0.3,
    conversationContinuityWeight: 0.4,
  },
  analysisWindowMs: 500,
  switchThreshold: 0.7,
};
```

### 2.5.4 Overlap Handler

```typescript
// ============================================
// overlap-handler.ts
// ============================================

import {
  MultiSpeakerConfig,
  MultiSpeakerSessionState,
  OverlapEvent,
  OverlapHandlerResponse,
  DEFAULT_MULTI_SPEAKER_CONFIG,
} from './multi-speaker-types';
import { Order } from './types';

/**
 * Messages d'intervention pour les situations multi-locuteurs
 */
const INTERVENTION_MESSAGES = {
  // Première intervention (douce)
  polite_request: [
    "Je vous entends tous ! Pour être sûr de ne rien oublier, est-ce qu'une personne peut me donner la commande ?",
    "Pas de souci, prenez votre temps. Qui me donne la commande ?",
    "J'ai du mal à tout suivre. On y va un par un ?",
  ],
  
  // Demande de répétition
  repeat_request: [
    "Pardon, je n'ai pas bien compris. Vous pouvez répéter ?",
    "Excusez-moi, vous pouvez me redire ça ?",
    "J'ai pas bien entendu, vous dites ?",
  ],
  
  // Après détection d'enfant
  child_detected: [
    "Et pour les enfants, on part sur une Magic Box ou une Fun Box ?",
    "Je propose une Magic Box pour le petit ? Avec le jouet !",
    "Pour les enfants, j'ai la Magic Box avec surprise !",
  ],
  
  // Récapitulatif en cas de chaos
  chaos_recap: (orderSummary: string) => [
    `Attendez, je récapitule ce que j'ai : ${orderSummary}. C'est bon jusque-là ?`,
    `OK, donc pour l'instant j'ai : ${orderSummary}. On continue ?`,
    `Je fais le point : ${orderSummary}. C'est correct ?`,
  ],
  
  // Transition vers personne suivante
  next_person: [
    "C'est noté ! Quelqu'un d'autre veut commander ?",
    "Parfait ! Et pour les autres ?",
    "OK c'est bon pour vous. La suite ?",
  ],
  
  // Avant escalade humain
  pre_escalation: [
    "Je vais demander à un collègue de vous aider, un instant.",
    "Je vous passe quelqu'un qui va finaliser votre commande.",
  ],
};

/**
 * Sélectionne un message aléatoire dans une liste
 */
function randomMessage(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Gestionnaire principal des overlaps multi-locuteurs
 */
export class OverlapHandler {
  private config: MultiSpeakerConfig;
  private state: MultiSpeakerSessionState;
  
  constructor(config: Partial<MultiSpeakerConfig> = {}) {
    this.config = { ...DEFAULT_MULTI_SPEAKER_CONFIG, ...config };
    this.state = this.createInitialState();
  }
  
  /**
   * Créer l'état initial de session
   */
  private createInitialState(): MultiSpeakerSessionState {
    return {
      isMultiSpeakerMode: false,
      detectedSpeakersCount: 1,
      overlapHistory: [],
      unresolvedOverlaps: 0,
      clarificationCount: 0,
      itemsSinceLastConfirmation: 0,
      childDetected: false,
      kidsMenuOffered: false,
    };
  }
  
  /**
   * Réinitialiser l'état (nouvelle commande)
   */
  reset(): void {
    this.state = this.createInitialState();
  }
  
  /**
   * Obtenir l'état actuel
   */
  getState(): MultiSpeakerSessionState {
    return { ...this.state };
  }
  
  /**
   * Traiter un événement d'overlap
   */
  async handleOverlap(event: OverlapEvent): Promise<OverlapHandlerResponse> {
    // Enregistrer l'événement
    this.state.overlapHistory.push(event);
    
    if (!event.detected) {
      // Pas d'overlap, traitement normal
      return {
        action: 'PROCESS_DOMINANT',
        audioToProcess: event.dominantSpeakerAudio,
        interruptCurrentAudio: false,
        priority: 'low',
        enableMultiSpeakerMode: false,
      };
    }
    
    // Overlap détecté
    this.state.unresolvedOverlaps++;
    
    // Activer le mode multi-locuteur
    if (!this.state.isMultiSpeakerMode) {
      this.state.isMultiSpeakerMode = true;
      this.state.activatedAt = new Date();
    }
    
    // Mettre à jour le nombre de locuteurs
    this.state.detectedSpeakersCount = Math.max(
      this.state.detectedSpeakersCount,
      event.estimatedSpeakers
    );
    
    // Détecter la présence d'enfants
    if (event.voiceCharacteristics?.hasChildVoice) {
      this.state.childDetected = true;
    }
    
    // Vérifier si on doit escalader vers humain
    if (this.shouldEscalateToHuman()) {
      return {
        action: 'ESCALATE_TO_HUMAN',
        response: randomMessage(INTERVENTION_MESSAGES.pre_escalation),
        interruptCurrentAudio: true,
        priority: 'high',
        enableMultiSpeakerMode: true,
      };
    }
    
    // Vérifier si intervention nécessaire
    const recentOverlaps = this.countRecentOverlaps(5000); // 5 dernières secondes
    
    if (recentOverlaps >= this.config.behavior.overlapsBeforeIntervention) {
      this.state.clarificationCount++;
      
      return {
        action: 'REQUEST_ONE_SPEAKER',
        response: randomMessage(INTERVENTION_MESSAGES.polite_request),
        interruptCurrentAudio: true,
        priority: 'high',
        enableMultiSpeakerMode: true,
      };
    }
    
    // Essayer de traiter le locuteur dominant si confiance suffisante
    if (event.confidence > 0.5 && event.dominantSpeakerAudio) {
      return {
        action: 'PROCESS_DOMINANT',
        audioToProcess: event.dominantSpeakerAudio,
        interruptCurrentAudio: false,
        priority: 'medium',
        enableMultiSpeakerMode: true,
      };
    }
    
    // Sinon, demander de répéter
    this.state.clarificationCount++;
    
    return {
      action: 'REQUEST_REPEAT',
      response: randomMessage(INTERVENTION_MESSAGES.repeat_request),
      interruptCurrentAudio: false,
      priority: 'medium',
      enableMultiSpeakerMode: true,
    };
  }
  
  /**
   * Compter les overlaps récents
   */
  private countRecentOverlaps(windowMs: number): number {
    const now = Date.now();
    return this.state.overlapHistory.filter(
      e => e.detected && (now - e.timestamp.getTime()) < windowMs
    ).length;
  }
  
  /**
   * Vérifier si on doit escalader vers un humain
   */
  private shouldEscalateToHuman(): boolean {
    return (
      this.state.clarificationCount >= this.config.behavior.maxClarificationsBeforeHuman ||
      this.state.unresolvedOverlaps >= 10
    );
  }
  
  /**
   * Marquer un overlap comme résolu (commande comprise)
   */
  markOverlapResolved(): void {
    if (this.state.unresolvedOverlaps > 0) {
      this.state.unresolvedOverlaps--;
    }
  }
  
  /**
   * Notifier qu'un item a été ajouté
   */
  onItemAdded(): void {
    this.state.itemsSinceLastConfirmation++;
    this.markOverlapResolved();
  }
  
  /**
   * Notifier qu'une confirmation a été faite
   */
  onConfirmationGiven(): void {
    this.state.itemsSinceLastConfirmation = 0;
  }
  
  /**
   * Vérifier si on doit confirmer maintenant
   */
  shouldConfirmNow(): boolean {
    if (!this.state.isMultiSpeakerMode) {
      // Mode normal: confirmer tous les 3 items
      return this.state.itemsSinceLastConfirmation >= 3;
    }
    
    // Mode multi-locuteur: confirmer après chaque item
    if (this.config.behavior.confirmAfterEachItem) {
      return this.state.itemsSinceLastConfirmation >= 1;
    }
    
    return this.state.itemsSinceLastConfirmation >= 2;
  }
  
  /**
   * Générer un message de confirmation adapté
   */
  generateConfirmation(order: Order, lastItemName: string): string {
    if (this.state.isMultiSpeakerMode) {
      // Confirmation courte en mode multi-locuteur
      return `${lastItemName}, c'est noté. Ensuite ?`;
    }
    
    return `J'ai ajouté ${lastItemName}.`;
  }
  
  /**
   * Générer une proposition de menu enfant si approprié
   */
  generateKidsMenuOffer(): string | null {
    if (this.state.childDetected && !this.state.kidsMenuOffered) {
      this.state.kidsMenuOffered = true;
      return randomMessage(INTERVENTION_MESSAGES.child_detected);
    }
    return null;
  }
  
  /**
   * Générer un récapitulatif en cas de chaos
   */
  generateChaosRecap(orderSummary: string): string {
    return randomMessage(INTERVENTION_MESSAGES.chaos_recap(orderSummary));
  }
  
  /**
   * Obtenir le message pour passer à la personne suivante
   */
  getNextPersonMessage(): string {
    return randomMessage(INTERVENTION_MESSAGES.next_person);
  }
}
```

### 2.5.5 Multi-Speaker Flow Manager

```typescript
// ============================================
// multi-speaker-flow.ts
// ============================================

import { Order, OrderItem } from './types';
import { OverlapHandler, OverlapHandlerResponse } from './overlap-handler';
import { OverlapEvent, MultiSpeakerSessionState } from './multi-speaker-types';

/**
 * Gestionnaire de flux pour les commandes multi-locuteurs
 */
export class MultiSpeakerFlowManager {
  private overlapHandler: OverlapHandler;
  private currentOrder: Order;
  
  constructor(order: Order) {
    this.overlapHandler = new OverlapHandler();
    this.currentOrder = order;
  }
  
  /**
   * Mettre à jour la commande courante
   */
  updateOrder(order: Order): void {
    this.currentOrder = order;
  }
  
  /**
   * Traiter un événement audio
   */
  async processAudioEvent(event: OverlapEvent): Promise<{
    response: OverlapHandlerResponse;
    additionalMessage?: string;
  }> {
    const response = await this.overlapHandler.handleOverlap(event);
    
    let additionalMessage: string | undefined;
    
    // Vérifier si on doit proposer un menu enfant
    if (response.action !== 'ESCALATE_TO_HUMAN') {
      const kidsOffer = this.overlapHandler.generateKidsMenuOffer();
      if (kidsOffer) {
        additionalMessage = kidsOffer;
      }
    }
    
    return { response, additionalMessage };
  }
  
  /**
   * Notifier l'ajout d'un item
   */
  onItemAdded(item: OrderItem): {
    shouldConfirm: boolean;
    confirmationMessage?: string;
  } {
    this.overlapHandler.onItemAdded();
    
    if (this.overlapHandler.shouldConfirmNow()) {
      const message = this.overlapHandler.generateConfirmation(
        this.currentOrder,
        item.name
      );
      this.overlapHandler.onConfirmationGiven();
      
      return {
        shouldConfirm: true,
        confirmationMessage: message,
      };
    }
    
    return { shouldConfirm: false };
  }
  
  /**
   * Obtenir l'état courant
   */
  getState(): MultiSpeakerSessionState {
    return this.overlapHandler.getState();
  }
  
  /**
   * Vérifier si en mode multi-locuteur
   */
  isMultiSpeakerMode(): boolean {
    return this.overlapHandler.getState().isMultiSpeakerMode;
  }
  
  /**
   * Réinitialiser pour une nouvelle commande
   */
  reset(): void {
    this.overlapHandler.reset();
  }
}
```

### 2.5.6 Configuration VAD Adaptée

```typescript
// ============================================
// multi-speaker-vad-config.ts
// ============================================

/**
 * Configuration VAD standard (single speaker)
 */
export const STANDARD_VAD_CONFIG = {
  turn_detection: {
    type: "semantic_vad" as const,
    threshold: 0.6,
    silence_duration_ms: 700,
    prefix_padding_ms: 400,
    create_response: true,
  },
};

/**
 * Configuration VAD pour environnement multi-locuteurs
 * Plus tolérante aux interruptions
 */
export const MULTI_SPEAKER_VAD_CONFIG = {
  turn_detection: {
    type: "semantic_vad" as const,
    
    // Seuil plus bas pour capter les interruptions
    threshold: 0.5,
    
    // Plus long pour laisser les gens finir malgré le bruit
    silence_duration_ms: 900,
    
    // Plus de padding pour ne pas couper les phrases
    prefix_padding_ms: 500,
    
    create_response: true,
  },
};

/**
 * Configuration VAD pour chaos total (beaucoup d'enfants)
 * Très conservatrice
 */
export const CHAOS_MODE_VAD_CONFIG = {
  turn_detection: {
    type: "semantic_vad" as const,
    
    // Seuil très bas
    threshold: 0.4,
    
    // Très long silence requis pour confirmer fin de tour
    silence_duration_ms: 1200,
    
    // Maximum de padding
    prefix_padding_ms: 600,
    
    create_response: true,
  },
};

/**
 * Sélectionner la config VAD appropriée
 */
export function selectVadConfig(state: {
  isMultiSpeakerMode: boolean;
  detectedSpeakersCount: number;
  childDetected: boolean;
  unresolvedOverlaps: number;
}): typeof STANDARD_VAD_CONFIG {
  // Mode chaos: beaucoup d'overlaps ou enfants
  if (state.unresolvedOverlaps >= 3 || 
      (state.childDetected && state.detectedSpeakersCount >= 3)) {
    return CHAOS_MODE_VAD_CONFIG;
  }
  
  // Mode multi-locuteur standard
  if (state.isMultiSpeakerMode) {
    return MULTI_SPEAKER_VAD_CONFIG;
  }
  
  // Mode normal
  return STANDARD_VAD_CONFIG;
}
```

### 2.5.7 Instructions System Prompt

```typescript
// ============================================
// multi-speaker-prompt.ts
// ============================================

/**
 * Section du system prompt pour la gestion multi-locuteurs
 */
export const MULTI_SPEAKER_SYSTEM_PROMPT = `
## GESTION MULTI-LOCUTEURS (Familles, Groupes)

Tu vas régulièrement avoir plusieurs personnes qui parlent en même temps dans la voiture (famille avec enfants, groupe d'amis). C'est NORMAL et tu dois gérer ça avec patience et bonne humeur.

### INDICES DE MULTI-LOCUTEURS
- Plusieurs prénoms mentionnés ("pour moi", "pour papa", "et lui il veut")
- Voix d'enfants mélangées aux adultes
- Commandes contradictoires ("Coca!" "Non Sprite!")
- Phrases interrompues ou incomplètes
- Bruit de fond avec conversations parallèles

### TON COMPORTEMENT (TRÈS IMPORTANT)
1. **JAMAIS de frustration** - Même si c'est le chaos total
2. **Toujours patient et souriant** (dans ta voix)
3. **Humour léger** pour détendre - "Ah je vois que tout le monde a faim !"
4. **Structurer poliment** - "Super ! On fait chacun son tour ?"

### STRATÉGIES À UTILISER

**Après 2 overlaps incompréhensibles:**
→ "Je vous entends tous ! Pour être sûr de ne rien oublier, est-ce qu'une personne peut me donner la commande ?"

**Quand tu détectes un enfant:**
→ Proposer directement : "Et pour le petit, une Magic Box avec la surprise ?"

**En cas de chaos:**
→ Récapituler fréquemment : "OK, donc j'ai [COMMANDE]. C'est bon jusque-là ?"

**Après chaque item en mode famille:**
→ Confirmer rapidement : "Menu Giant, c'est noté ! Ensuite ?"

**Pour passer à la personne suivante:**
→ "Parfait pour vous ! Et pour les autres ?"

### PHRASES UTILES

| Situation | Phrase |
|-----------|--------|
| Début chaos | "Pas de souci, on a le temps !" |
| Clarification | "Alors, c'est Coca ou Sprite finalement ?" |
| Enfant crie | "Je t'ai entendu ! Des nuggets c'est ça ?" |
| Récap | "Je fais le point : [COMMANDE]. On continue ?" |
| Désaccord | "Hmm, je mets quoi du coup ?" |

### CE QU'IL NE FAUT JAMAIS FAIRE
- ❌ "Je ne comprends rien" → Trop négatif
- ❌ "Parlez un à la fois" → Trop sec/autoritaire  
- ❌ "Calmez-vous" → Condescendant
- ❌ Ignorer les voix d'enfants → Ils sont clients aussi !
- ❌ Demander de répéter plus de 2 fois la même chose → Escalader plutôt
- ❌ S'énerver ou soupirer → Tu es une IA patiente

### DÉTECTION DES PATTERNS

**Pattern "Commande famille type":**
- 1-2 menus adultes
- 1-2 menus enfants (Magic Box / Fun Box)
- Boissons supplémentaires
- Desserts à partager

**Pattern "Groupe d'amis":**
- Plusieurs menus similaires
- Souvent le même burger pour tous
- Négociation sur les desserts

**Pattern "Couple + bébé":**
- 2 menus adultes
- Rien pour le bébé (ou juste compote)
- Rapide et efficace

### ESCALADE VERS HUMAIN

Si après 4-5 tentatives tu n'arrives toujours pas à comprendre:
→ "Je vais demander à un collègue de vous aider, un instant s'il vous plaît."
→ Déclencher le transfert vers équipier humain

Ne JAMAIS rester bloqué indéfiniment - mieux vaut escalader avec le sourire.
`;

/**
 * Exemples de dialogues multi-locuteurs pour few-shot
 */
export const MULTI_SPEAKER_EXAMPLES = `
### EXEMPLES DE DIALOGUES MULTI-LOCUTEURS

**Exemple 1: Famille avec enfant**
Client (parent): "Bonjour, je voudrais un menu Gi-"
Client (enfant): "DES NUGGETS!"
Bot: "Bonjour ! Un menu Giant et des nuggets pour le petit, c'est ça ? On part sur une Magic Box ?"
Client (parent): "Oui une Magic Box"
Bot: "Super ! Magic Box avec quel jouet, fille ou garçon ?"

**Exemple 2: Désaccord sur la boisson**
Client 1: "Avec un Coca"
Client 2: "Non prends Sprite"
Client 1: "Mais je veux Coca moi"
Bot: "Alors je mets quoi, Coca ou Sprite ? Ou un de chaque ?"
Client 1: "Un Coca et un Sprite alors"
Bot: "Parfait, un Coca et un Sprite ! Autre chose ?"

**Exemple 3: Chaos total**
[Plusieurs voix simultanées incompréhensibles]
Bot: "Je vous entends tous ! Pour être sûr de ne rien oublier, qui me donne la commande ?"
Client (parent): "Pardon. Alors, deux menus Giant, une Magic Box..."
Bot: "Deux menus Giant et une Magic Box. Je vous écoute pour la suite."

**Exemple 4: Enfant qui interrompt**
Client (parent): "Je voudrais un menu Long Chicken avec-"
Client (enfant): "ET MOI UN SUNDAE!"
Bot: "Un menu Long Chicken, noté ! Et un sundae pour toi. Quel parfum le sundae ?"
`;
```

### 2.5.8 Intégration avec le Backend

```typescript
// ============================================
// server-multi-speaker-integration.ts
// ============================================

import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { MultiSpeakerFlowManager } from './multi-speaker-flow';
import { selectVadConfig } from './multi-speaker-vad-config';
import { OverlapEvent } from './multi-speaker-types';

/**
 * Intégration du multi-speaker handling dans le serveur WebSocket
 */
export function integrateMultiSpeakerHandling(
  fastify: FastifyInstance,
  clientWs: WebSocket,
  openaiWs: WebSocket,
  flowManager: MultiSpeakerFlowManager
) {
  // Analyser l'audio entrant pour détecter les overlaps
  // Note: Cette analyse se fait en parallèle de l'envoi à OpenAI
  
  let audioAnalysisBuffer: ArrayBuffer[] = [];
  let lastOverlapCheck = Date.now();
  const OVERLAP_CHECK_INTERVAL = 500; // ms
  
  /**
   * Analyser le buffer audio pour détecter des overlaps
   * Utilise une heuristique simple basée sur l'énergie du signal
   */
  async function analyzeForOverlap(audioData: ArrayBuffer): Promise<OverlapEvent | null> {
    // Convertir en échantillons
    const samples = new Int16Array(audioData);
    
    // Calculer l'énergie RMS
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    
    // Détecter les variations rapides d'énergie (indicateur d'overlap)
    const segments = splitIntoSegments(samples, 10);
    const energyVariance = calculateEnergyVariance(segments);
    
    // Détecter les fréquences multiples (plusieurs voix)
    const hasMultipleVoices = detectMultipleVoices(samples);
    
    // Détecter voix enfant (fréquence élevée)
    const hasChildVoice = detectChildVoice(samples);
    
    // Heuristique de détection d'overlap
    const overlapScore = 
      (energyVariance > 0.3 ? 0.4 : 0) +
      (hasMultipleVoices ? 0.4 : 0) +
      (rms > 3000 ? 0.2 : 0);
    
    if (overlapScore > 0.5) {
      return {
        timestamp: new Date(),
        detected: true,
        confidence: overlapScore,
        estimatedSpeakers: hasMultipleVoices ? 2 : 1,
        durationMs: (samples.length / 16000) * 1000,
        voiceCharacteristics: {
          hasChildVoice,
          hasMultipleAdults: hasMultipleVoices && !hasChildVoice,
          dominantPitch: hasChildVoice ? 'high' : 'medium',
        },
      };
    }
    
    return null;
  }
  
  /**
   * Handler pour les données audio entrantes
   */
  async function handleIncomingAudio(audioData: ArrayBuffer): Promise<void> {
    audioAnalysisBuffer.push(audioData);
    
    // Vérifier périodiquement les overlaps
    if (Date.now() - lastOverlapCheck > OVERLAP_CHECK_INTERVAL) {
      lastOverlapCheck = Date.now();
      
      // Combiner le buffer
      const combinedBuffer = combineAudioBuffers(audioAnalysisBuffer);
      audioAnalysisBuffer = [];
      
      // Analyser
      const overlapEvent = await analyzeForOverlap(combinedBuffer);
      
      if (overlapEvent) {
        const { response, additionalMessage } = await flowManager.processAudioEvent(overlapEvent);
        
        // Appliquer la réponse
        if (response.action === 'REQUEST_ONE_SPEAKER' || response.action === 'REQUEST_REPEAT') {
          // Interrompre et envoyer le message
          if (response.interruptCurrentAudio) {
            openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
          }
          
          // Envoyer la réponse vocale
          sendBotMessage(openaiWs, response.response!);
        }
        
        if (response.action === 'ESCALATE_TO_HUMAN') {
          // Déclencher le transfert
          triggerHumanHandoff(clientWs, response.response!);
        }
        
        // Ajuster la config VAD si nécessaire
        const newVadConfig = selectVadConfig(flowManager.getState());
        updateVadConfig(openaiWs, newVadConfig);
        
        // Message additionnel (ex: proposition menu enfant)
        if (additionalMessage) {
          setTimeout(() => {
            sendBotMessage(openaiWs, additionalMessage);
          }, 2000);
        }
      }
    }
  }
  
  /**
   * Envoyer un message vocal via OpenAI
   */
  function sendBotMessage(ws: WebSocket, message: string): void {
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'input_text', text: message }],
      },
    }));
    ws.send(JSON.stringify({ type: 'response.create' }));
  }
  
  /**
   * Déclencher le transfert vers humain
   */
  function triggerHumanHandoff(ws: WebSocket, message: string): void {
    ws.send(JSON.stringify({
      type: 'crew_action',
      action: 'request_takeover',
      reason: 'multi_speaker_chaos',
      message,
    }));
  }
  
  /**
   * Mettre à jour la config VAD
   */
  function updateVadConfig(ws: WebSocket, config: any): void {
    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        turn_detection: config.turn_detection,
      },
    }));
  }
  
  return { handleIncomingAudio };
}

// ============================================
// Fonctions utilitaires d'analyse audio
// ============================================

function splitIntoSegments(samples: Int16Array, count: number): Int16Array[] {
  const segmentSize = Math.floor(samples.length / count);
  const segments: Int16Array[] = [];
  
  for (let i = 0; i < count; i++) {
    segments.push(samples.slice(i * segmentSize, (i + 1) * segmentSize));
  }
  
  return segments;
}

function calculateEnergyVariance(segments: Int16Array[]): number {
  const energies = segments.map(seg => {
    let sum = 0;
    for (let i = 0; i < seg.length; i++) {
      sum += seg[i] * seg[i];
    }
    return Math.sqrt(sum / seg.length);
  });
  
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
  const variance = energies.reduce((sum, e) => sum + (e - mean) ** 2, 0) / energies.length;
  
  return variance / (mean * mean + 1); // Normalized variance
}

function detectMultipleVoices(samples: Int16Array): boolean {
  // Simplified: detect if there are multiple dominant frequencies
  // In production, use proper FFT analysis
  
  // Calculate zero-crossing rate variations
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) {
      crossings++;
    }
  }
  
  const zcr = crossings / samples.length;
  
  // High variance in ZCR suggests multiple voices
  // This is a simplified heuristic
  return zcr > 0.1 && zcr < 0.4;
}

function detectChildVoice(samples: Int16Array): boolean {
  // Simplified: detect high-pitched voice
  // Children's voices typically have fundamental frequency > 250Hz
  
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) {
      crossings++;
    }
  }
  
  // Estimate fundamental frequency from zero-crossing rate
  const sampleRate = 16000;
  const estimatedF0 = (crossings / 2) / (samples.length / sampleRate);
  
  return estimatedF0 > 250;
}

function combineAudioBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  
  let offset = 0;
  for (const buffer of buffers) {
    combined.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  
  return combined.buffer;
}
```

### 2.5.9 Résumé des Stratégies

| Niveau | Stratégie | Implémentation |
|--------|-----------|----------------|
| **Audio** | Overlap Detection | Analyse énergie + ZCR en temps réel |
| **Audio** | Child Voice Detection | Fréquence fondamentale > 250Hz |
| **Audio** | Speaker Diarization | Pyannote (optionnel, edge processing) |
| **VAD** | Adaptive Config | 3 profils: Standard / Multi / Chaos |
| **UX** | Polite Intervention | Messages variés après 2 overlaps |
| **UX** | Frequent Confirmation | Confirmer chaque item en mode multi |
| **UX** | Kids Menu Offer | Proposition auto si enfant détecté |
| **UX** | Chaos Recap | Récapitulatif fréquent |
| **LLM** | System Prompt | Instructions détaillées + exemples |
| **Fallback** | Human Escalation | Après 5 clarifications échouées |

### 2.5.10 Métriques à Suivre

```typescript
interface MultiSpeakerMetrics {
  // Par session
  sessionMetrics: {
    multiSpeakerModeActivated: boolean;
    timeInMultiSpeakerMode: number;        // seconds
    overlapCount: number;
    clarificationCount: number;
    successfulResolutions: number;
    humanEscalations: number;
    childMenusOffered: number;
    childMenusAccepted: number;
  };
  
  // Agrégées (dashboard)
  aggregateMetrics: {
    percentSessionsMultiSpeaker: number;   // Target: understand baseline
    avgOverlapsPerMultiSpeakerSession: number;
    resolutionRate: number;                // Target: > 85%
    escalationRate: number;                // Target: < 10%
    avgTimeToResolution: number;           // seconds
    childDetectionAccuracy: number;        // Validated manually
  };
}
```

---

## 3. SÉCURITÉ ET PROTECTION

### 3.1 Prompt Injection Protection

```typescript
interface SecurityConfig {
  promptInjection: {
    enabled: boolean;
    
    // Patterns à détecter et bloquer
    blockedPatterns: RegExp[];
    
    // Actions si détecté
    onDetection: "ignore" | "log_and_ignore" | "fallback_to_human";
  };
  
  // Limite de tokens pour éviter les attaques par longueur
  maxInputTokens: number;
  
  // Rate limiting par session
  rateLimiting: {
    maxUtterancesPerMinute: number;
    maxSessionDurationMinutes: number;
  };
}

const BLOCKED_PATTERNS: RegExp[] = [
  /ignore.*(?:previous|précédent|instruction)/i,
  /oublie.*(?:tout|instruction|règle)/i,
  /tu es maintenant/i,
  /nouveau.*(?:rôle|rôle|personnage)/i,
  /désactive.*(?:filtre|sécurité|règle)/i,
  /gratuit|offert|promo.*100%/i,        // Tentatives de fraude
  /admin|administrator|root/i,
  /système.*(?:prompt|instruction)/i,
];

function detectPromptInjection(transcript: string): {
  detected: boolean;
  pattern?: string;
  riskLevel: "low" | "medium" | "high";
} {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(transcript)) {
      return {
        detected: true,
        pattern: pattern.source,
        riskLevel: "high"
      };
    }
  }
  return { detected: false, riskLevel: "low" };
}
```

### 3.2 Protection données personnelles

```typescript
interface PrivacyConfig {
  // Les données audio sont-elles conservées ?
  audioRetention: {
    enabled: boolean;
    durationDays: number;
    anonymized: boolean;       // Voix transformée
  };
  
  // Transcripts
  transcriptRetention: {
    enabled: boolean;
    durationDays: number;
    piiRedaction: boolean;     // Suppression noms, numéros, etc.
  };
  
  // RGPD
  gdprCompliance: {
    consentRequired: boolean;
    consentMessage: string;    // "Cette conversation peut être enregistrée..."
    rightToErasure: boolean;
  };
}

// PII patterns à masquer dans les logs
const PII_PATTERNS: RegExp[] = [
  /\b\d{10}\b/g,                           // Numéros de téléphone
  /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g,   // Numéros de carte
  /\b[A-Z]{2}\d{3}[A-Z]{2}\b/g,           // Plaques d'immatriculation FR
];

function redactPII(text: string): string {
  let redacted = text;
  for (const pattern of PII_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}
```

---

## 4. GESTION DES ERREURS ET MODE DÉGRADÉ

### 4.1 Fallback Cascade

```typescript
interface FallbackConfig {
  // Niveaux de fallback
  levels: FallbackLevel[];
  
  // Triggers de fallback
  triggers: FallbackTrigger[];
}

interface FallbackLevel {
  level: number;
  name: string;
  description: string;
  action: () => void;
}

const FALLBACK_LEVELS: FallbackLevel[] = [
  {
    level: 1,
    name: "ASR_FALLBACK",
    description: "OpenAI Realtime down, bascule sur Whisper local",
    action: () => { /* Switch ASR provider */ }
  },
  {
    level: 2,
    name: "TTS_FALLBACK",
    description: "TTS down, utilise messages pré-enregistrés",
    action: () => { /* Switch to prerecorded audio */ }
  },
  {
    level: 3,
    name: "LLM_FALLBACK",
    description: "LLM down, bascule sur règles simples",
    action: () => { /* Switch to rule-based NLU */ }
  },
  {
    level: 4,
    name: "HUMAN_FALLBACK",
    description: "Système dégradé, transfert systématique à l'équipier",
    action: () => { /* Route all to human */ }
  },
  {
    level: 5,
    name: "FULL_OUTAGE",
    description: "Système HS, affichage message 'Passez directement au guichet'",
    action: () => { /* Display static message */ }
  }
];

interface FallbackTrigger {
  condition: string;
  level: number;
  cooldownSeconds: number;      // Temps avant réessai du niveau normal
}

const FALLBACK_TRIGGERS: FallbackTrigger[] = [
  { condition: "openai_api_error", level: 1, cooldownSeconds: 60 },
  { condition: "openai_latency > 2000ms", level: 1, cooldownSeconds: 30 },
  { condition: "tts_error", level: 2, cooldownSeconds: 60 },
  { condition: "llm_error", level: 3, cooldownSeconds: 60 },
  { condition: "llm_latency > 3000ms", level: 3, cooldownSeconds: 30 },
  { condition: "pos_unreachable", level: 4, cooldownSeconds: 120 },
  { condition: "network_down", level: 5, cooldownSeconds: 300 },
];
```

### 4.2 Circuit Breaker

```typescript
interface CircuitBreakerConfig {
  service: string;
  
  // Seuils
  failureThreshold: number;        // Nombre d'échecs avant ouverture
  successThreshold: number;        // Nombre de succès pour refermer
  timeout: number;                 // Temps en half-open avant retry
  
  // État
  state: "closed" | "open" | "half-open";
  failureCount: number;
  lastFailure: Date | null;
}

const CIRCUIT_BREAKERS: Record<string, CircuitBreakerConfig> = {
  "openai-realtime": {
    service: "openai-realtime",
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000,
    state: "closed",
    failureCount: 0,
    lastFailure: null
  },
  "pos-api": {
    service: "pos-api",
    failureThreshold: 2,
    successThreshold: 1,
    timeout: 60000,
    state: "closed",
    failureCount: 0,
    lastFailure: null
  }
};
```

---

## 5. INTERFACE ÉQUIPIER

### 5.1 Crew Dashboard

```typescript
interface CrewDashboardState {
  // Session en cours
  currentSession: {
    sessionId: string;
    startTime: Date;
    status: "bot_active" | "human_active" | "hybrid";
    laneNumber: number;
  };
  
  // Transcript en temps réel
  liveTranscript: TranscriptEntry[];
  
  // Commande en cours
  currentOrder: Order | null;
  
  // Indicateurs
  indicators: {
    botConfidence: number;           // 0-100%
    customerFrustration: number;     // 0-100% (basé sur répétitions, ton)
    timeInLane: number;              // Secondes
    itemCount: number;
  };
  
  // Actions disponibles
  actions: CrewAction[];
}

interface TranscriptEntry {
  timestamp: Date;
  speaker: "customer" | "bot" | "crew";
  text: string;
  confidence: number;
  intent?: string;
}

interface CrewAction {
  id: string;
  label: string;
  icon: string;
  action: () => void;
}

const CREW_ACTIONS: CrewAction[] = [
  {
    id: "take_over",
    label: "Reprendre la main",
    icon: "🎤",
    action: () => { /* Désactive le bot, active le micro équipier */ }
  },
  {
    id: "assist_bot",
    label: "Assister le bot",
    icon: "🤝",
    action: () => { /* Mode hybride : équipier peut injecter des corrections */ }
  },
  {
    id: "add_item_manually",
    label: "Ajouter un article",
    icon: "➕",
    action: () => { /* Ouvre le catalogue pour ajout manuel */ }
  },
  {
    id: "cancel_order",
    label: "Annuler la commande",
    icon: "❌",
    action: () => { /* Annule et reset */ }
  },
  {
    id: "send_to_pos",
    label: "Envoyer au POS",
    icon: "✅",
    action: () => { /* Force l'envoi au POS */ }
  },
  {
    id: "replay_audio",
    label: "Réécouter",
    icon: "🔊",
    action: () => { /* Rejoue les dernières 10 secondes */ }
  }
];
```

### 5.2 Alertes équipier

```typescript
interface CrewAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  actions?: string[];
}

const ALERT_DEFINITIONS = {
  LOW_CONFIDENCE: {
    severity: "warning",
    title: "Confiance basse",
    message: "Le bot a du mal à comprendre le client"
  },
  CUSTOMER_FRUSTRATED: {
    severity: "warning", 
    title: "Client frustré",
    message: "Le client a répété sa demande plusieurs fois"
  },
  FALLBACK_TRIGGERED: {
    severity: "critical",
    title: "Transfert équipier",
    message: "Le bot demande votre intervention"
  },
  LONG_WAIT: {
    severity: "warning",
    title: "Attente longue",
    message: "Le client attend depuis plus de 2 minutes"
  },
  ORDER_VALIDATION_ERROR: {
    severity: "warning",
    title: "Erreur commande",
    message: "La commande contient des erreurs à corriger"
  },
  POS_ERROR: {
    severity: "critical",
    title: "Erreur POS",
    message: "Impossible d'envoyer la commande au POS"
  }
};
```

---

## 6. SYNCHRONISATION CATALOGUE

### 6.1 Catalogue Sync Strategy

```typescript
interface CatalogueSyncConfig {
  // Mode de synchronisation
  mode: "polling" | "webhook" | "hybrid";
  
  // Polling
  pollingIntervalSeconds: number;     // 300 = 5 minutes
  
  // Webhook
  webhookEndpoint: string;
  webhookSecret: string;
  
  // Cache
  cacheStrategy: {
    ttlSeconds: number;
    staleWhileRevalidate: boolean;
  };
  
  // Events
  onCatalogueUpdate: (diff: CatalogueDiff) => void;
  onProductUnavailable: (productId: string) => void;
}

interface CatalogueDiff {
  added: Product[];
  removed: Product[];
  modified: Array<{
    productId: string;
    changes: Record<string, { old: any; new: any }>;
  }>;
  availabilityChanges: Array<{
    productId: string;
    available: boolean;
  }>;
}

// Gestion 86'd (produit épuisé)
async function handle86d(productId: string): Promise<void> {
  // 1. Mettre à jour le cache local
  catalogueCache.setUnavailable(productId);
  
  // 2. Si le produit est dans une commande en cours, alerter
  for (const session of activeSessions) {
    if (session.order.items.some(i => i.productId === productId)) {
      await notifyProductUnavailable(session, productId);
    }
  }
  
  // 3. Mettre à jour le LLM context
  await updateLLMCatalogueContext();
}

async function notifyProductUnavailable(
  session: DriveThruSession, 
  productId: string
): Promise<void> {
  const product = catalogueCache.get(productId);
  const alternatives = findAlternatives(productId);
  
  const message = alternatives.length > 0
    ? `Désolé, le ${product.name} n'est plus disponible. Puis-je vous proposer ${alternatives[0].name} à la place ?`
    : `Désolé, le ${product.name} n'est plus disponible.`;
  
  await session.speak(message);
  await session.removeItemFromOrder(productId);
}
```

---

## 7. SHADOW MODE & MÉTRIQUES

### 7.1 Shadow Mode Implementation

```typescript
interface ShadowModeConfig {
  enabled: boolean;
  
  // Comparaison
  comparison: {
    groundTruthSource: "pos_final_order" | "crew_manual_entry";
    comparisonDelay: number;        // Secondes après fin de session
  };
  
  // Métriques à collecter
  metrics: ShadowMetric[];
  
  // Export
  exportFormat: "json" | "csv" | "bigquery";
  exportDestination: string;
}

interface ShadowMetric {
  name: string;
  type: "accuracy" | "timing" | "count" | "ratio";
  formula: string;
}

const SHADOW_METRICS: ShadowMetric[] = [
  {
    name: "item_accuracy",
    type: "accuracy",
    formula: "correct_items / total_items_in_ground_truth"
  },
  {
    name: "order_exact_match",
    type: "accuracy",
    formula: "bot_order === ground_truth ? 1 : 0"
  },
  {
    name: "price_delta",
    type: "accuracy",
    formula: "abs(bot_total - ground_truth_total)"
  },
  {
    name: "time_to_order",
    type: "timing",
    formula: "order_confirmed_timestamp - session_start_timestamp"
  },
  {
    name: "utterances_count",
    type: "count",
    formula: "count(customer_utterances)"
  },
  {
    name: "clarification_rate",
    type: "ratio",
    formula: "clarification_requests / total_intents"
  },
  {
    name: "fallback_rate",
    type: "ratio",
    formula: "fallback_triggered / total_sessions"
  },
  {
    name: "asr_confidence_avg",
    type: "accuracy",
    formula: "avg(asr_confidence_scores)"
  }
];

interface ShadowComparison {
  sessionId: string;
  timestamp: Date;
  
  botOrder: Order;
  groundTruthOrder: Order;
  
  metrics: {
    itemAccuracy: number;
    orderExactMatch: boolean;
    priceDelta: number;
    missingItems: string[];
    extraItems: string[];
    wrongQuantities: Array<{
      productId: string;
      botQty: number;
      truthQty: number;
    }>;
  };
  
  sessionData: {
    duration: number;
    utteranceCount: number;
    clarificationCount: number;
    avgConfidence: number;
  };
}

function compareShadowOrder(
  botOrder: Order,
  groundTruth: Order
): ShadowComparison['metrics'] {
  const botItems = new Map(botOrder.items.map(i => [i.productId, i]));
  const truthItems = new Map(groundTruth.items.map(i => [i.productId, i]));
  
  const missingItems: string[] = [];
  const extraItems: string[] = [];
  const wrongQuantities: Array<{ productId: string; botQty: number; truthQty: number }> = [];
  
  // Items manquants
  for (const [productId, item] of truthItems) {
    if (!botItems.has(productId)) {
      missingItems.push(productId);
    }
  }
  
  // Items en trop
  for (const [productId, item] of botItems) {
    if (!truthItems.has(productId)) {
      extraItems.push(productId);
    }
  }
  
  // Quantités incorrectes
  for (const [productId, truthItem] of truthItems) {
    const botItem = botItems.get(productId);
    if (botItem && botItem.qty !== truthItem.qty) {
      wrongQuantities.push({
        productId,
        botQty: botItem.qty,
        truthQty: truthItem.qty
      });
    }
  }
  
  const correctItems = truthItems.size - missingItems.length - wrongQuantities.length;
  const itemAccuracy = correctItems / truthItems.size;
  
  return {
    itemAccuracy,
    orderExactMatch: missingItems.length === 0 && extraItems.length === 0 && wrongQuantities.length === 0,
    priceDelta: Math.abs(botOrder.total - groundTruth.total),
    missingItems,
    extraItems,
    wrongQuantities
  };
}
```

### 7.2 Monitoring Dashboard

```typescript
interface DashboardConfig {
  refreshInterval: number;      // Secondes
  
  panels: DashboardPanel[];
}

interface DashboardPanel {
  id: string;
  title: string;
  type: "metric" | "chart" | "table" | "alert";
  dataSource: string;
  config: Record<string, any>;
}

const DASHBOARD_PANELS: DashboardPanel[] = [
  // Métriques temps réel
  {
    id: "active_sessions",
    title: "Sessions actives",
    type: "metric",
    dataSource: "realtime.active_sessions",
    config: { format: "number" }
  },
  {
    id: "avg_latency",
    title: "Latence moyenne",
    type: "metric",
    dataSource: "realtime.avg_latency_ms",
    config: { format: "ms", threshold: { warning: 500, critical: 800 } }
  },
  {
    id: "fallback_rate_today",
    title: "Taux de fallback (aujourd'hui)",
    type: "metric",
    dataSource: "daily.fallback_rate",
    config: { format: "percent", threshold: { warning: 0.15, critical: 0.25 } }
  },
  
  // Graphiques
  {
    id: "orders_timeline",
    title: "Commandes / heure",
    type: "chart",
    dataSource: "hourly.order_count",
    config: { chartType: "line", timeRange: "24h" }
  },
  {
    id: "confidence_distribution",
    title: "Distribution des scores de confiance",
    type: "chart",
    dataSource: "daily.confidence_histogram",
    config: { chartType: "histogram", buckets: 10 }
  },
  
  // Shadow mode (si actif)
  {
    id: "shadow_accuracy",
    title: "Précision Shadow Mode",
    type: "metric",
    dataSource: "shadow.item_accuracy",
    config: { format: "percent" }
  },
  {
    id: "shadow_comparison_table",
    title: "Dernières comparaisons",
    type: "table",
    dataSource: "shadow.recent_comparisons",
    config: { columns: ["sessionId", "itemAccuracy", "priceDelta", "exactMatch"] }
  },
  
  // Alertes
  {
    id: "active_alerts",
    title: "Alertes actives",
    type: "alert",
    dataSource: "alerts.active",
    config: {}
  }
];
```

---

## 8. CONFIGURATION GLOBALE

```typescript
interface VoicebotConfig {
  // Identifiants
  storeId: string;
  laneId: string;
  environment: "development" | "staging" | "production";
  
  // Mode
  mode: "shadow" | "live";
  
  // Langue
  language: "fr-FR";
  
  // Seuils de confiance
  thresholds: {
    asrConfidence: number;              // 0.88
    intentConfidence: number;           // 0.85
    productMatchConfidence: number;     // 0.90
  };
  
  // Fallback
  fallback: {
    maxConsecutiveLowConfidence: number;  // 2
    maxRepetitions: number;               // 3
    maxSessionDuration: number;           // 300 secondes
  };
  
  // Latence
  latency: {
    maxAsrDelayMs: number;              // 300
    maxLlmDelayMs: number;              // 400
    maxTtsDelayMs: number;              // 200
    maxE2EDelayMs: number;              // 800
  };
  
  // Phase de déploiement
  phase: 1 | 2 | 3;
  
  // Features toggles
  features: {
    upsellEnabled: boolean;             // Phase 3
    customizationsEnabled: boolean;     // Phase 2+
    allergenQueriesEnabled: boolean;    // Phase 3
    multiLanguageEnabled: boolean;      // Future
  };
  
  // Providers
  providers: {
    asr: ASRConfig;
    tts: TTSConfig;
    llm: {
      model: string;
      temperature: number;
      maxTokens: number;
    };
  };
  
  // Intégrations
  integrations: {
    pos: {
      baseUrl: string;
      apiKey: string;
      timeout: number;
    };
    monitoring: {
      provider: "datadog" | "grafana" | "custom";
      endpoint: string;
    };
  };
}

// Configuration par défaut
const DEFAULT_CONFIG: VoicebotConfig = {
  storeId: "",
  laneId: "",
  environment: "development",
  mode: "shadow",
  language: "fr-FR",
  
  thresholds: {
    asrConfidence: 0.88,
    intentConfidence: 0.85,
    productMatchConfidence: 0.90
  },
  
  fallback: {
    maxConsecutiveLowConfidence: 2,
    maxRepetitions: 3,
    maxSessionDuration: 300
  },
  
  latency: {
    maxAsrDelayMs: 300,
    maxLlmDelayMs: 400,
    maxTtsDelayMs: 200,
    maxE2EDelayMs: 800
  },
  
  phase: 1,
  
  features: {
    upsellEnabled: false,
    customizationsEnabled: false,
    allergenQueriesEnabled: false,
    multiLanguageEnabled: false
  },
  
  providers: {
    asr: { /* ... */ },
    tts: { /* ... */ },
    llm: {
      model: "gpt-4o",
      temperature: 0.3,
      maxTokens: 500
    }
  },
  
  integrations: {
    pos: {
      baseUrl: "https://pos.quick.local/api",
      apiKey: "",
      timeout: 5000
    },
    monitoring: {
      provider: "datadog",
      endpoint: ""
    }
  }
};
```

---

## 9. EDGE CASES & SCÉNARIOS SPÉCIAUX

### 9.1 Multi-speaker Detection

```typescript
interface MultiSpeakerConfig {
  enabled: boolean;
  
  // Détection
  detection: {
    method: "voice_embedding" | "speaker_diarization";
    minConfidence: number;
  };
  
  // Comportement
  behavior: {
    // Si plusieurs voix détectées
    onMultipleSpeakers: "ignore_secondary" | "ask_who_ordering" | "accept_all";
    
    // Message si ambiguïté
    clarificationMessage: string;
  };
}

const MULTI_SPEAKER_HANDLING = {
  enabled: true,
  
  detection: {
    method: "voice_embedding",
    minConfidence: 0.75
  },
  
  behavior: {
    onMultipleSpeakers: "ask_who_ordering",
    clarificationMessage: "J'entends plusieurs voix. Qui passe la commande ?"
  }
};

// Détection de changement d'interlocuteur mid-order
function handleSpeakerChange(
  previousSpeakerId: string,
  newSpeakerId: string,
  context: DialogContext
): DialogAction {
  // Si c'est juste un passager qui commente, ignorer
  // Si c'est un changement de "commandeur", demander confirmation
  
  if (context.state === "TAKING_ORDER") {
    return {
      type: "SPEAK",
      message: "Je vous écoute, vous souhaitez ajouter quelque chose ?"
    };
  }
  
  return { type: "CONTINUE" };
}
```

### 9.2 Changement d'avis mid-phrase

```typescript
// Patterns de changement d'avis
const CHANGE_OF_MIND_PATTERNS = [
  /non (?:en fait|finalement|attendez)/i,
  /euh non/i,
  /(?:ah )?non (?:pardon|désolé)/i,
  /je (?:me suis trompé|voulais dire)/i,
  /(?:à la place|plutôt)/i,
];

function detectChangeOfMind(transcript: string): boolean {
  return CHANGE_OF_MIND_PATTERNS.some(p => p.test(transcript));
}

// Gestion du changement d'avis
async function handleChangeOfMind(
  session: DriveThruSession,
  transcript: string
): Promise<void> {
  // Annuler la dernière action
  await session.undoLastAction();
  
  // Demander clarification
  await session.speak("D'accord, je vous écoute.");
  
  // Passer en mode écoute active pour la correction
  session.setState("LISTENING");
}
```

### 9.3 Requêtes allergènes (Phase 3)

```typescript
interface AllergenQuery {
  productId: string;
  allergen: string;
  response: string;
}

// Note: On ne donne PAS d'info allergène par le bot pour raisons légales
// On renvoie systématiquement à l'équipier ou à l'affichage

const ALLERGEN_RESPONSE = `
Pour les informations sur les allergènes, je vous invite à consulter 
l'affichage au guichet ou à demander à un équipier. Je vous passe la main.
`;

function handleAllergenQuery(
  query: string,
  session: DriveThruSession
): DialogAction {
  return {
    type: "FALLBACK_TO_HUMAN",
    reason: "allergen_query",
    message: ALLERGEN_RESPONSE
  };
}
```

### 9.4 Client non francophone

```typescript
interface LanguageDetection {
  detected: boolean;
  language: string;
  confidence: number;
}

// Si on détecte une langue non supportée
function handleNonSupportedLanguage(
  detection: LanguageDetection,
  session: DriveThruSession
): DialogAction {
  // Phase 1 : Fallback immédiat
  if (CONFIG.phase === 1) {
    return {
      type: "FALLBACK_TO_HUMAN",
      reason: "unsupported_language",
      message: "Je vous passe à un équipier. / I'll transfer you to a crew member."
    };
  }
  
  // Phase future : Switch de langue
  return {
    type: "SWITCH_LANGUAGE",
    targetLanguage: detection.language
  };
}
```

---

## 10. TESTS ET VALIDATION

### 10.1 Test Suites

```typescript
// ============================================
// UNIT TESTS - ORDER ENGINE
// ============================================

describe("OrderEngine", () => {
  describe("addItemToOrder", () => {
    it("should add a simple burger", () => { /* ... */ });
    it("should add a menu with required components", () => { /* ... */ });
    it("should reject menu without drink", () => { /* ... */ });
    it("should reject menu without side", () => { /* ... */ });
    it("should reject unavailable product", () => { /* ... */ });
    it("should calculate correct price", () => { /* ... */ });
    it("should handle quantity > 1", () => { /* ... */ });
  });
  
  describe("validateOrder", () => {
    it("should validate complete order", () => { /* ... */ });
    it("should reject empty order", () => { /* ... */ });
    it("should detect incomplete menus", () => { /* ... */ });
    it("should detect invalid quantities", () => { /* ... */ });
  });
});

// ============================================
// INTEGRATION TESTS - NLU PIPELINE
// ============================================

describe("NLU Pipeline", () => {
  const testCases: Array<{ input: string; expectedIntent: string; expectedItems: any[] }> = [
    {
      input: "Je voudrais un menu Giant avec des frites et un Coca",
      expectedIntent: "ADD_ITEM",
      expectedItems: [{ productRef: "Giant", qty: 1, modifiers: [{ type: "side" }, { type: "drink" }] }]
    },
    {
      input: "Deux Big Cheese s'il vous plaît",
      expectedIntent: "ADD_ITEM",
      expectedItems: [{ productRef: "Big Cheese", qty: 2 }]
    },
    {
      input: "C'est tout",
      expectedIntent: "CONFIRM_ORDER",
      expectedItems: []
    },
    {
      input: "Je veux parler à quelqu'un",
      expectedIntent: "FALLBACK_HUMAN",
      expectedItems: []
    }
  ];
  
  testCases.forEach(({ input, expectedIntent, expectedItems }) => {
    it(`should parse "${input}" as ${expectedIntent}`, async () => {
      const result = await nluPipeline.parse(input);
      expect(result.intent).toBe(expectedIntent);
    });
  });
});

// ============================================
// E2E TESTS - FULL CONVERSATION
// ============================================

describe("E2E Conversation", () => {
  it("should complete a simple order", async () => {
    const session = await startTestSession();
    
    await session.customerSays("Bonjour, je voudrais un menu Giant avec frites et Sprite");
    expect(session.lastBotResponse).toContain("Giant");
    expect(session.lastBotResponse).toContain("frites");
    expect(session.lastBotResponse).toContain("Sprite");
    
    await session.customerSays("C'est tout");
    expect(session.state).toBe("CONFIRMING");
    
    await session.customerSays("Oui c'est bon");
    expect(session.state).toBe("VALIDATED");
    expect(session.order.items).toHaveLength(1);
  });
  
  it("should fallback after 3 repetitions", async () => {
    const session = await startTestSession();
    
    await session.customerSays("grblmfx"); // Incompréhensible
    await session.customerSays("grblmfx");
    await session.customerSays("grblmfx");
    
    expect(session.state).toBe("FALLBACK_TO_HUMAN");
  });
});
```

### 10.2 Shadow Mode Evaluation

```typescript
// Script d'évaluation shadow mode

async function runShadowEvaluation(
  startDate: Date,
  endDate: Date
): Promise<ShadowEvaluationReport> {
  const sessions = await getShadowSessions(startDate, endDate);
  
  const metrics = {
    totalSessions: sessions.length,
    exactMatchRate: 0,
    avgItemAccuracy: 0,
    avgPriceDelta: 0,
    fallbackRate: 0,
    avgTimeToOrder: 0,
    commonErrors: [] as Array<{ type: string; count: number }>
  };
  
  let exactMatches = 0;
  let totalItemAccuracy = 0;
  let totalPriceDelta = 0;
  let fallbacks = 0;
  let totalTime = 0;
  const errorCounts = new Map<string, number>();
  
  for (const session of sessions) {
    const comparison = compareShadowOrder(session.botOrder, session.groundTruth);
    
    if (comparison.orderExactMatch) exactMatches++;
    totalItemAccuracy += comparison.itemAccuracy;
    totalPriceDelta += comparison.priceDelta;
    totalTime += session.duration;
    
    if (session.fallbackTriggered) fallbacks++;
    
    // Track error types
    for (const missing of comparison.missingItems) {
      const key = `missing:${missing}`;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
    for (const extra of comparison.extraItems) {
      const key = `extra:${extra}`;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
  }
  
  metrics.exactMatchRate = exactMatches / sessions.length;
  metrics.avgItemAccuracy = totalItemAccuracy / sessions.length;
  metrics.avgPriceDelta = totalPriceDelta / sessions.length;
  metrics.fallbackRate = fallbacks / sessions.length;
  metrics.avgTimeToOrder = totalTime / sessions.length;
  metrics.commonErrors = Array.from(errorCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  return {
    period: { start: startDate, end: endDate },
    metrics,
    recommendations: generateRecommendations(metrics)
  };
}

function generateRecommendations(
  metrics: ShadowEvaluationReport['metrics']
): string[] {
  const recommendations: string[] = [];
  
  if (metrics.exactMatchRate < 0.85) {
    recommendations.push("Le taux de correspondance exacte est bas. Analyser les erreurs fréquentes.");
  }
  
  if (metrics.fallbackRate > 0.20) {
    recommendations.push("Le taux de fallback est élevé (>20%). Revoir les seuils de confiance ou améliorer l'ASR.");
  }
  
  if (metrics.avgPriceDelta > 200) {
    recommendations.push("L'écart de prix moyen est élevé (>2€). Vérifier les calculs de prix et les règles de combos.");
  }
  
  if (metrics.avgTimeToOrder > 120) {
    recommendations.push("Le temps moyen de commande est long (>2min). Optimiser le dialogue.");
  }
  
  return recommendations;
}
```

---

## 11. DÉPLOIEMENT ET ROLLOUT

### 11.1 Phases de déploiement

```
PHASE 0: DÉVELOPPEMENT
├── Environnement: Local / Staging
├── Mode: Tests automatisés uniquement
└── Durée: 4-6 semaines

PHASE 1A: SHADOW MODE - 1 RESTAURANT
├── Environnement: 1 restaurant pilote (faible trafic)
├── Mode: Shadow (bot écoute mais n'agit pas)
├── Durée: 2 semaines
├── Critères de passage:
│   ├── Item accuracy > 85%
│   ├── Exact match rate > 70%
│   └── No critical bugs
└── Actions: Ajustement vocabulaire, seuils

PHASE 1B: SHADOW MODE - 3 RESTAURANTS
├── Environnement: 3 restaurants variés (urbain, périurbain, autoroute)
├── Mode: Shadow
├── Durée: 2 semaines
├── Critères: Mêmes + stabilité sur profils variés
└── Actions: Ajustement profils acoustiques

PHASE 2A: LIVE - HEURES CREUSES
├── Environnement: 1 restaurant
├── Mode: Live (bot actif) 
├── Horaires: 14h-17h (heures creuses)
├── Durée: 2 semaines
├── Critères:
│   ├── Order success rate > 80%
│   ├── Fallback rate < 25%
│   ├── Customer satisfaction (enquête)
└── Actions: Monitoring intensif, équipier dédié

PHASE 2B: LIVE - TOUTES HEURES
├── Environnement: 1 restaurant
├── Mode: Live
├── Horaires: Toutes heures d'ouverture
├── Durée: 2 semaines
├── Critères:
│   ├── Order success rate > 85%
│   ├── Fallback rate < 20%
│   ├── Temps moyen < 90s
└── Actions: Stress test rush du midi

PHASE 3: ROLLOUT PROGRESSIF
├── Semaine 1: 5 restaurants
├── Semaine 2: 10 restaurants
├── Semaine 3: 25 restaurants
├── Semaine 4+: +25 restaurants/semaine
├── Critères: Maintien des KPIs
└── Rollback automatique si dégradation

PHASE 4: GÉNÉRALISATION
├── Tous les restaurants
├── Activation Phase 2 features (customizations)
└── Monitoring continu
```

### 11.2 Critères Go/No-Go

```typescript
interface GoNoGoChecklist {
  technical: {
    latencyP95: { threshold: 800, unit: "ms" };
    errorRate: { threshold: 0.01, unit: "ratio" };
    uptimeLastWeek: { threshold: 0.999, unit: "ratio" };
    asrAccuracy: { threshold: 0.90, unit: "ratio" };
  };
  
  business: {
    orderSuccessRate: { threshold: 0.85, unit: "ratio" };
    fallbackRate: { threshold: 0.20, unit: "ratio" };
    avgOrderTime: { threshold: 90, unit: "seconds" };
    customerSatisfaction: { threshold: 4.0, unit: "score_out_of_5" };
  };
  
  safety: {
    criticalBugsOpen: { threshold: 0, unit: "count" };
    securityIssuesOpen: { threshold: 0, unit: "count" };
    privacyComplianceValidated: { threshold: true, unit: "boolean" };
  };
}
```

---

## 12. INTERACTION STYLE (POUR LE DÉVELOPPEUR)

Quand tu implémentes ce système:

1. **D'abord** : Résume brièvement ce que tu vas implémenter
2. **Ensuite** : Propose une version minimale mais complète
3. **Enfin** : Explique comment l'étendre/paramétrer

Langage:
- Clair et direct
- Pas de marketing
- Réponse en français si question en français, anglais sinon
- Messages bot toujours en français (sauf demande contraire)

---

## 13. PREMIÈRE TÂCHE AU DÉMARRAGE

Quand le développeur dit "let's start" ou "build v1":

1. **Générer**:
   - Data models: `Product`, `MenuRule`, `OrderItem`, `Order`
   - Catalogue JSON exemple (5-10 produits Quick)

2. **Créer**:
   - Order Engine basique avec:
     - `addItemToOrder`
     - `validateOrder`

3. **Fournir**:
   - Exemple de sortie NLU/LLM JSON
   - Fonction de mapping NLU → `addItemToOrder`

À partir de là, itérer avec le développeur.

---

**Fin de spécification — Version 2.0 Complète**
