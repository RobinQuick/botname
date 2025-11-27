
export interface CustomerProfile {
    id: string;
    name: string;
    children?: number;
    lastOrder: {
        productName: string;
        quantity: number;
        size?: string;
        modifiers?: { type: string; productName: string }[];
    }[];
}

const MOCK_CUSTOMERS: Record<string, CustomerProfile> = {
    'QR_THOMAS_123': {
        id: 'QR_THOMAS_123',
        name: 'Thomas',
        children: 2,
        lastOrder: [
            { productName: 'Menu Giant', quantity: 1, size: 'medium', modifiers: [{ type: 'drink', productName: 'Coca-Cola' }, { type: 'side', productName: 'Frites' }] }
        ]
    },
    'QR_SOPHIE_456': {
        id: 'QR_SOPHIE_456',
        name: 'Sophie',
        lastOrder: [
            { productName: 'Long Chicken', quantity: 1 }
        ]
    }
};

export const customerService = {
    getCustomerByQrCode(qrCode: string): CustomerProfile | null {
        return MOCK_CUSTOMERS[qrCode] || null;
    }
};
