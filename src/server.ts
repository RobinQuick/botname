import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, TOOLS } from './config.js';
import { logger } from './logger.js';
import { CatalogueService } from './catalogue-service.js';
import { OrderEngine, orderEngine } from './order-engine.js';
import { POSAdapter } from './pos-adapter.js';
import { customerService } from './customer-service.js';
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
    root: path.join(__dirname, 'public'),
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

        // Robustly determine the socket
        // @ts-ignore
        const clientSocket = connection.socket || connection;

        if (!clientSocket) {
            logger.error({ sessionId }, 'Failed to resolve client socket');
            return;
        }

        // Initialize session
        const session: SessionState = {
            id: sessionId,
            storeId,
            order: orderEngine.createEmptyOrder(sessionId, storeId),
            clientWs: clientSocket,
            openaiWs: null,
            streamId: null,
            lastAudioTime: Date.now(),
            testMode
        };

        sessions.set(sessionId, session);

        // Connect to OpenAI Realtime API
        connectToOpenAI(session);

        // Handle client messages
        clientSocket.on('message', (message: any, isBinary: boolean) => {
            handleClientMessage(session, message, isBinary);
        });

        clientSocket.on('close', () => {
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

        // Notify client that upstream connection is ready to receive audio
        sendToClient(session, {
            type: 'status',
            status: 'openai_connected'
        });

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
                },
                tools: TOOLS,
                tool_choice: 'auto'
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

        sendToClient(session, {
            type: 'status',
            status: 'openai_error',
            message: error instanceof Error ? error.message : 'OpenAI connection error'
        });
    });

    ws.on('close', () => {
        logger.info({ sessionId: session.id }, 'OpenAI WebSocket closed');
        session.openaiWs = null;

        sendToClient(session, {
            type: 'status',
            status: 'openai_disconnected'
        });
    });
}

// ============================================
// MESSAGE HANDLING
// ============================================

function handleClientMessage(session: SessionState, message: any, isBinary: boolean) {
    // If binary, it's audio
    if (isBinary) {
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
        } else if (data.type === 'identify_customer') {
            const customer = customerService.getCustomerByQrCode(data.qrCode);
            if (customer && session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
                logger.info({ sessionId: session.id, customer: customer.name }, 'Customer identified');

                // Send system event to OpenAI to inform about the customer
                const contextMessage = `
                    [SYSTÈME] Le client est identifié : ${customer.name}.
                    Sa dernière commande : ${JSON.stringify(customer.lastOrder)}.
                    ${customer.children ? `Il a ${customer.children} enfants.` : ''}
                    
                    TACHE : 
                    1. Accueille-le brièvement par son nom.
                    2. ${customer.children ? "Demande-lui si ses enfants sont là aujourd'hui (pour proposer des Magic Box)." : ""}
                    3. Propose-lui sa dernière commande.
                    
                    Exemple : "Bonjour Thomas ! Vous avez les enfants avec vous aujourd'hui ? On repart sur votre Menu Giant habituel ?"
                    NE FAIS PAS de longues descriptions. Sois direct.
                `;

                session.openaiWs.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                        type: 'message',
                        role: 'user', // Using user role as system instructions to prompt immediate reaction
                        content: [
                            {
                                type: 'input_text',
                                text: contextMessage
                            }
                        ]
                    }
                }));

                // Trigger response
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
            if (event.delta && session.clientWs) {
                const audioBuffer = Buffer.from(event.delta, 'base64');
                if (session.clientWs.readyState === WebSocket.OPEN) {
                    session.clientWs.send(audioBuffer);
                }
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
            const output = event.response?.output || [];
            for (const item of output) {
                if (item.type === 'function_call') {
                    handleFunctionCall(session, item);
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

async function handleFunctionCall(session: SessionState, item: any) {
    const { name, call_id, arguments: argsString } = item;
    let args;

    try {
        args = JSON.parse(argsString);
    } catch (e) {
        logger.error({ sessionId: session.id, error: e }, 'Failed to parse function arguments');
        return;
    }

    logger.info({ sessionId: session.id, function: name, args }, 'Executing function call');

    let result: any = { success: true };
    const catalogue = catalogueService.getCatalogue(session.storeId);
    const menuRules = catalogueService.getMenuRules(session.storeId);
    let orderUpdated = false;

    if (name === 'add_item') {
        const engineResult = orderEngine.addItemToOrder(
            session.order,
            {
                productName: args.productName,
                quantity: args.quantity,
                size: args.size,
                modifiers: args.modifiers
            },
            catalogue,
            menuRules
        );
        if (engineResult.success && engineResult.data) {
            session.order = engineResult.data;
            orderUpdated = true;
            result = { success: true, message: 'Item added successfully' };
        } else {
            result = { success: false, message: engineResult.errors?.[0]?.message || 'Unknown error' };
        }
    } else if (name === 'remove_item') {
        const engineResult = orderEngine.removeItemByName(
            session.order,
            args.productName,
            catalogue
        );
        if (engineResult.success && engineResult.data) {
            session.order = engineResult.data;
            orderUpdated = true;
            result = { success: true, message: 'Item removed successfully' };
        } else {
            result = { success: false, message: engineResult.errors?.[0]?.message || 'Unknown error' };
        }
    } else if (name === 'confirm_order') {
        if (session.testMode) {
            session.order.status = 'sent_to_pos';
            session.order.posOrderId = `TEST-${Date.now()}`;
            orderUpdated = true;
            result = { success: true, message: 'Order confirmed in test mode' };
        } else {
            const posResult = await posAdapter.createOrder(session.order);
            if (posResult.success) {
                session.order.status = 'sent_to_pos';
                session.order.posOrderId = posResult.orderId;
                orderUpdated = true;
                result = { success: true, message: 'Order sent to POS' };
            } else {
                result = { success: false, message: 'Failed to send to POS' };
            }
        }
    }

    // Update client UI
    if (orderUpdated) {
        sendToClient(session, {
            type: 'order_update',
            order: orderEngine.generateOrderDisplayData(session.order)
        });
    }

    // Send result back to OpenAI
    if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
        session.openaiWs.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: call_id,
                output: JSON.stringify(result)
            }
        }));

        // Trigger response generation based on the tool output
        session.openaiWs.send(JSON.stringify({
            type: 'response.create'
        }));
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
