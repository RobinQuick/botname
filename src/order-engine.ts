import { randomUUID } from 'crypto';
import {
    Order,
    OrderItem,
    Product,
    MenuRule,
    OrderEngineResult,
    ValidationError,
    ParsedOrderItem,
    ParsedModifier,
    OrderItemModifier,
    OrderCustomization,
    OrderModification,
    ProductSize
} from './types.js';

// TVA France - Restauration rapide à emporter
const TAX_RATE_TAKEAWAY = 0.055;  // 5.5%

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
                    return modifierResult as unknown as OrderEngineResult<Order>;
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
            lines.push(line);
        }

        return `${lines.join(', ')}. Total ${this.formatPrice(order.total)}.`;
    }

    // ============================================
    // PRODUCT RESOLUTION
    // ============================================

    /**
     * Résout un produit par son nom (fuzzy search)
     */
    resolveProduct(
        item: { productName: string; quantity: number },
        catalogue: Product[]
    ): Product | null {
        const searchName = this.normalizeString(item.productName);
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

    // ============================================
    // DISPLAY HELPERS
    // ============================================

    async generateOrderDisplayData(order: Order): Promise<any> {
        // Import image mapper
        const productImages = await import('./product-images.js');
        const { getProductImage } = productImages;

        return {
            items: order.items.map(item => ({
                name: item.name,
                quantity: item.qty,
                size: item.size,
                productId: item.productId,
                imageUrl: getProductImage(item.name), // ✅ Add image URL
                modifiers: item.modifiers.map(m => ({
                    name: m.name,
                    extraPrice: m.extraPrice > 0 ? this.formatPrice(m.extraPrice) : null
                })),
                price: this.formatPrice(item.linePrice)
            })),
            subtotal: this.formatPrice(order.subtotal),
            discounts: order.discounts.map(d => ({
                description: d.description,
                amount: this.formatPrice(d.appliedAmount)
            })),
            total: this.formatPrice(order.total),
            itemCount: order.items.reduce((sum, item) => sum + item.qty, 0)
        };
    }
}

// Export singleton
export const orderEngine = new OrderEngine();
