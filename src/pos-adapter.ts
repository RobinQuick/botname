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
    ) { }

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
            // MOCK IMPLEMENTATION FOR SHADOW MODE
            if (process.env.MODE === 'shadow') {
                logger.info('Shadow mode: Order not actually sent to POS');
                return {
                    success: true,
                    orderId: `MOCK-${Date.now()}`,
                    orderNumber: `A-${Math.floor(Math.random() * 100)}`,
                    estimatedTime: 15
                };
            }

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
            // MOCK IMPLEMENTATION FOR SHADOW MODE
            if (process.env.MODE === 'shadow') {
                return { success: true };
            }

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
            // MOCK IMPLEMENTATION FOR SHADOW MODE
            if (process.env.MODE === 'shadow') {
                return { status: 'preparing', estimatedTime: 10 };
            }

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
