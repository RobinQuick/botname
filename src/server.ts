import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger } from './logger.js';
import { CatalogueService } from './catalogue-service.js';
import { OrderEngine, orderEngine } from './order-engine.js';
import { POSAdapter } from './pos-adapter.js';
import { Order, OrderEngineResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Services
const catalogueService = new CatalogueService(config.POS_API_URL, config.POS_API_KEY);
const posAdapter = new POSAdapter(config.POS_API_URL, config.POS_API_KEY, config.POS_TIMEOUT_MS);

// Server setup
const fastify = Fastify({
    logger: true,
    trustProxy: true
});

// Register static files
await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../public'),
    prefix: '/'
});

// Register WebSocket support
await fastify.register(fastifyWebsocket, {
    options: {
        maxPayload: 1024 * 1024 * 10, // 10MB for audio chunks
        clientTracking: true
    }
});

// Session management
interface SessionState {
    id: string;
    storeId: string;
    order: Order;
    clientWs: WebSocket;
    openaiWs: WebSocket | null;
    streamId: string | null;
    lastAudioTime: number;
    testMode: boolean;
}

const sessions = new Map<string, SessionState>();

// ============================================
// WEBSOCKET ROUTES
// ============================================

fastify.register(async (fastify) => {
    fastify.get('/drive-thru', { websocket: true }, (connection, req) => {
        const sessionId = randomUUID();
        const storeId = 'default';
        // @ts-ignore
        const testMode = req.query?.mode === 'test';

        logger.info({ sessionId, testMode }, 'New client connection');

        // Initialize session
        const session: SessionState = {
            id: sessionId,
            storeId,
            order: orderEngine.createEmptyOrder(sessionId, storeId),
            clientWs: (connection as any).socket,
            openaiWs: null,
            streamId: null,
            lastAudioTime: Date.now(),
            testMode
        };

        sessions.set(sessionId, session);

        // Connect to OpenAI Realtime API
        connectToOpenAI(session);

        // Handle client messages
        (connection as any).socket.on('message', (message: Buffer) => {
            handleClientMessage(session, message);
        });

        (connection as any).socket.on('close', () => {
            logger.info({ sessionId }, 'Client disconnected');
            if (session.openaiWs) {
                session.openaiWs.close();
            }
            sessions.delete(sessionId);
        });

        // Send initial state
        sendToClient(session, {
            type: 'order_update',
            order: orderEngine.generateOrderDisplayData(session.order),
            transcript: { role: 'assistant', text: 'Bienvenue chez Quick, je vous écoute.' }
        });
    });
});

// ============================================
// OPENAI INTEGRATION
// ============================================

function connectToOpenAI(session: SessionState) {
    const url = `wss://api.openai.com/v1/realtime?model=${config.OPENAI_MODEL}`;

    const ws = new WebSocket(url, {
        headers: {
            'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1'
        }
    });

    ws.on('open', () => {
        logger.info({ sessionId: session.id }, 'Connected to OpenAI Realtime API');
        session.openaiWs = ws;

        // Configure session
        const catalogue = catalogueService.getCatalogue(session.storeId);
        const menuRules = catalogueService.getMenuRules(session.storeId);

        // Inject catalogue into system prompt
        const instructions = config.OPENAI_INSTRUCTIONS
            .replace('{{CATALOGUE_JSON}}', JSON.stringify(catalogue, null, 2))
            .replace('{{MENU_RULES_JSON}}', JSON.stringify(menuRules, null, 2));

        const sessionConfig = {
            type: 'session.update',
            session: {
                voice: config.OPENAI_VOICE,
                instructions: instructions,
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                turn_detection: {
                    type: 'server_vad',
                    threshold: config.VAD_THRESHOLD,
                    prefix_padding_ms: config.VAD_PREFIX_PADDING_MS,
                    silence_duration_ms: config.VAD_SILENCE_DURATION_MS
                }
            }
        };

        ws.send(JSON.stringify(sessionConfig));

        // Send initial greeting
        ws.send(JSON.stringify({
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
                instructions: 'Dis "Bienvenue chez Quick, je vous écoute."'
            }
        }));
    });

    ws.on('message', (data: Buffer) => {
        let event;
        try {
            const rawMessage = data.toString();
            event = JSON.parse(rawMessage);
        } catch (error) {
            logger.error({ error, rawData: data.toString() }, 'Failed to parse OpenAI message');
            return;
        }

        try {
            handleOpenAIEvent(session, event);
        } catch (error: any) {
            logger.error({
                error: { message: error.message, stack: error.stack },
                eventType: event?.type
            }, 'Error handling OpenAI event');
        }
    });

    ws.on('error', (error) => {
        logger.error({ sessionId: session.id, error }, 'OpenAI WebSocket error');
    });

    ws.on('close', () => {
        logger.info({ sessionId: session.id }, 'OpenAI WebSocket closed');
        session.openaiWs = null;
    });
}

// ============================================
// MESSAGE HANDLING
// ============================================

function handleClientMessage(session: SessionState, message: any) {
    // If binary, it's audio
    if (Buffer.isBuffer(message)) {
        if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
            session.openaiWs.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: (message as Buffer).toString('base64')
            }));
        }
        return;
    }

    // If text, it's a control message
    try {
        const data = JSON.parse(message.toString());

        if (data.type === 'interrupt') {
            if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
                session.openaiWs.send(JSON.stringify({
                    type: 'input_audio_buffer.clear'
                }));
            }
        } else if (data.type === 'force_reply') {
            if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
                session.openaiWs.send(JSON.stringify({
                    type: 'response.create'
                }));
            }
        }
    } catch (error) {
        // Ignore invalid JSON
    }
}

function handleOpenAIEvent(session: SessionState, event: any) {
    switch (event.type) {
        case 'response.audio.delta':
            // Stream audio to client
            if (event.delta) {
                const audioBuffer = Buffer.from(event.delta, 'base64');
                session.clientWs.send(audioBuffer);
            }
            break;

        case 'response.audio_transcript.done':
            // Send transcript to client
            sendToClient(session, {
                type: 'transcript',
                role: 'assistant',
                text: event.transcript
            });
            break;

        case 'conversation.item.input_audio_transcription.completed':
            // Send user transcript to client
            sendToClient(session, {
                type: 'transcript',
                role: 'user',
                text: event.transcript
            });
            break;

        case 'response.done':
            // Check for function calls or text content that contains JSON
            if (event.response && event.response.output) {
                for (const item of event.response.output) {
                    if (item.type === 'message' && item.content) {
                        for (const content of item.content) {
                            if (content.type === 'text') {
                                processLLMResponse(session, content.text);
                            }
                        }
                    }
                }
            }
            break;

        case 'error':
            logger.error({ sessionId: session.id, error: event.error }, 'OpenAI error');
            break;
    }
}

// ============================================
// LOGIC PROCESSING
// ============================================

async function processLLMResponse(session: SessionState, text: string) {
    try {
        // Extract JSON from response (it might be wrapped in markdown)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return;

        const data = JSON.parse(jsonMatch[0]);
        const catalogue = catalogueService.getCatalogue(session.storeId);
        const menuRules = catalogueService.getMenuRules(session.storeId);

        let orderUpdated = false;
        let result: OrderEngineResult<Order> | null = null;

        // Process intents
        if (data.intent === 'ADD_ITEM' && data.items) {
            for (const item of data.items) {
                if (item.action === 'add') {
                    result = orderEngine.addItemToOrder(
                        session.order,
                        {
                            productName: item.productRef,
                            quantity: item.qty,
                            size: item.size,
                            modifiers: item.modifiers?.map((m: any) => ({
                                type: m.type,
                                productName: m.productRef
                            }))
                        },
                        catalogue,
                        menuRules
                    );

                    if (result && result.success && result.data) {
                        session.order = result.data;
                        orderUpdated = true;
                    }
                }
            }
        } else if (data.intent === 'REMOVE_ITEM' && data.items) {
            for (const item of data.items) {
                result = orderEngine.removeItemByName(
                    session.order,
                    item.productRef,
                    catalogue
                );
                if (result && result.success && result.data) {
                    session.order = result.data;
                    orderUpdated = true;
                }
            }
        } else if (data.intent === 'CONFIRM_ORDER') {
            // Send to POS
            if (session.testMode) {
                logger.info({ sessionId: session.id }, 'Test mode: Skipping POS submission');
                session.order.status = 'sent_to_pos';
                session.order.posOrderId = `TEST-${Date.now()}`;
                orderUpdated = true;
            } else {
                const posResult = await posAdapter.createOrder(session.order);
                if (posResult.success) {
                    session.order.status = 'sent_to_pos';
                    session.order.posOrderId = posResult.orderId;
                    orderUpdated = true;
                }
            }
        }

        // Update client if order changed
        if (orderUpdated) {
            sendToClient(session, {
                type: 'order_update',
                order: orderEngine.generateOrderDisplayData(session.order)
            });
        }

    } catch (error) {
        logger.error({ sessionId: session.id, error }, 'Failed to process LLM response');
    }
}

function sendToClient(session: SessionState, message: any) {
    try {
        if (session.clientWs.readyState === WebSocket.OPEN) {
            session.clientWs.send(JSON.stringify(message));
        }
    } catch (error) {
        logger.error({ sessionId: session.id, error }, 'Failed to send message to client');
    }
}

// ============================================
// START SERVER
// ============================================

try {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info(`Server listening on port ${config.PORT}`);
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}
