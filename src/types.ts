// ============================================
// types.ts - Core Data Models
// ============================================

// ============================================
// PRODUCT TYPES
// ============================================

export type ProductCategory = "menu" | "burger" | "side" | "drink" | "dessert" | "sauce" | "extra";

export type ProductSize = "small" | "medium" | "large";

export interface Product {
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

export interface ProductSizeOption {
    size: ProductSize;
    displayName: string;                  // "Petit" / "Moyen" / "Grand"
    priceModifier: number;                // Centimes à ajouter/soustraire
}

// ============================================
// MENU RULES
// ============================================

export interface MenuRule {
    menuProductId: string;
    name: string;
    requiredComponents: MenuComponent[];
    optionalComponents?: MenuComponent[];
    incompatibleProducts?: string[];      // IDs de produits incompatibles
    maxTotalItems?: number;               // Limite d'items dans le menu
}

export interface MenuComponent {
    type: "side" | "drink" | "dessert" | "sauce";
    displayName: string;                  // "Accompagnement", "Boisson"
    min: number;                          // Minimum requis (1 pour obligatoire)
    max: number;                          // Maximum autorisé
    allowedProductIds: string[];          // IDs des produits autorisés
    defaultProductId: string;             // Défaut si non spécifié
    priceIncluded: boolean;               // Inclus dans le prix menu
    upgradeOptions?: UpgradeOption[];     // Suppléments possibles
}

export interface UpgradeOption {
    productId: string;
    extraPrice: number;                   // Supplément en centimes
    description?: string;
}

// ============================================
// ORDER TYPES
// ============================================

export interface OrderItem {
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

export interface OrderItemModifier {
    id: string;
    type: "side" | "drink" | "dessert" | "sauce";
    productId: string;
    name: string;
    extraPrice: number;                   // 0 si inclus, sinon supplément
}

export interface OrderCustomization {
    id: string;
    type: "remove_ingredient" | "add_ingredient" | "extra" | "less" | "allergy";
    ingredient: string;
    extraPrice: number;
    notes?: string;
}

export type OrderStatus =
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

export interface Order {
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

export interface OrderDiscount {
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

export interface ValidationError {
    code: string;
    message: string;                      // Message technique (logs)
    messageFr: string;                    // Message client-friendly en français
    field?: string;
    details?: Record<string, unknown>;
    recoverable: boolean;                 // Peut-on corriger automatiquement ?
    suggestion?: string;                  // Suggestion de correction
    suggestedAction?: "ask_clarification" | "propose_alternative" | "remove_item" | "transfer_human";
}

export interface OrderEngineResult<T> {
    success: boolean;
    data?: T;
    errors?: ValidationError[];
    warnings?: string[];
}

// ============================================
// PARSED INPUT (from NLU)
// ============================================

export interface ParsedOrderItem {
    productId?: string;                   // Si déjà résolu
    productName: string;                  // Nom tel que compris
    quantity: number;
    size?: ProductSize;
    modifiers?: ParsedModifier[];
    customizations?: ParsedCustomization[];
}

export interface ParsedModifier {
    type: "side" | "drink" | "dessert" | "sauce";
    productId?: string;
    productName: string;
}

export interface ParsedCustomization {
    type: "remove_ingredient" | "add_ingredient" | "extra" | "less";
    ingredient: string;
}

export interface OrderModification {
    type: "change_side" | "change_drink" | "change_size" | "add_sauce" |
    "remove_ingredient" | "add_ingredient" | "change_quantity";
    itemId?: string;
    itemIndex?: number;
    newValue: string | number;
    modifierIndex?: number;
}
