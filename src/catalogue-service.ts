// ============================================
// catalogue-service.ts - Catalogue Management
// ============================================

import { Product, MenuRule } from './types.js';
import { logger } from './logger.js';

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
        private posApiUrl: string = '',
        private posApiKey: string = ''
    ) {
        // Initialize with sample data for 'default' store
        this.initializeSampleData();

        // Démarrer le refresh périodique
        // setInterval(() => this.refreshAllCatalogues(), this.updateInterval);
    }

    private initializeSampleData() {
        const products: Product[] = [
            {
                id: "giant-burger",
                name: "Giant",
                shortName: "Giant",
                category: "burger",
                synonyms: ["le giant", "burger giant"],
                available: true,
                basePrice: 520,
                imageUrl: "/images/giant.png"
            },
            {
                id: "giant-menu",
                name: "Menu Giant",
                shortName: "Menu Giant",
                category: "menu",
                synonyms: ["menu giant", "formule giant"],
                available: true,
                basePrice: 950,
                sizes: [
                    { size: "medium", displayName: "Normal", priceModifier: 0 },
                    { size: "large", displayName: "Maxi", priceModifier: 80 }
                ]
            },
            {
                id: "long-chicken",
                name: "Long Chicken",
                shortName: "Long Chicken",
                category: "burger",
                synonyms: ["long chicken", "poulet long"],
                available: true,
                basePrice: 550
            },
            {
                id: "long-chicken-menu",
                name: "Menu Long Chicken",
                shortName: "Menu Long Chicken",
                category: "menu",
                synonyms: ["menu long chicken"],
                available: true,
                basePrice: 980,
                sizes: [
                    { size: "medium", displayName: "Normal", priceModifier: 0 },
                    { size: "large", displayName: "Maxi", priceModifier: 80 }
                ]
            },
            {
                id: "fries",
                name: "Frites",
                shortName: "Frites",
                category: "side",
                synonyms: ["frite", "pommes frites"],
                available: true,
                basePrice: 280,
                sizes: [
                    { size: "small", displayName: "Petite", priceModifier: -30 },
                    { size: "medium", displayName: "Moyenne", priceModifier: 0 },
                    { size: "large", displayName: "Grande", priceModifier: 50 }
                ]
            },
            {
                id: "rustiques",
                name: "Rustiques",
                shortName: "Rustiques",
                category: "side",
                synonyms: ["potatoes", "rustique"],
                available: true,
                basePrice: 320,
                sizes: [
                    { size: "medium", displayName: "Moyenne", priceModifier: 0 },
                    { size: "large", displayName: "Grande", priceModifier: 50 }
                ]
            },
            {
                id: "coca",
                name: "Coca-Cola",
                shortName: "Coca",
                category: "drink",
                synonyms: ["coca", "coke"],
                available: true,
                basePrice: 250,
                sizes: [
                    { size: "small", displayName: "Petit", priceModifier: -20 },
                    { size: "medium", displayName: "Moyen", priceModifier: 0 },
                    { size: "large", displayName: "Grand", priceModifier: 40 }
                ]
            },
            {
                id: "coca-zero",
                name: "Coca-Cola Zéro",
                shortName: "Coca Zéro",
                category: "drink",
                synonyms: ["coca zéro", "zéro"],
                available: true,
                basePrice: 250,
                sizes: [
                    { size: "small", displayName: "Petit", priceModifier: -20 },
                    { size: "medium", displayName: "Moyen", priceModifier: 0 },
                    { size: "large", displayName: "Grand", priceModifier: 40 }
                ]
            },
            {
                id: "water",
                name: "Eau Minérale",
                shortName: "Eau",
                category: "drink",
                synonyms: ["eau", "bouteille d'eau"],
                available: true,
                basePrice: 220
            },
            {
                id: "sundae",
                name: "Sundae",
                shortName: "Sundae",
                category: "dessert",
                synonyms: ["glace sundae"],
                available: true,
                basePrice: 350
            }
        ];

        const menuRules: MenuRule[] = [
            {
                menuProductId: "giant-menu",
                name: "Menu Giant",
                requiredComponents: [
                    {
                        type: "side",
                        displayName: "Accompagnement",
                        min: 1,
                        max: 1,
                        allowedProductIds: ["fries", "rustiques"],
                        defaultProductId: "fries",
                        priceIncluded: true
                    },
                    {
                        type: "drink",
                        displayName: "Boisson",
                        min: 1,
                        max: 1,
                        allowedProductIds: ["coca", "coca-zero", "water"],
                        defaultProductId: "coca",
                        priceIncluded: true
                    }
                ]
            },
            {
                menuProductId: "long-chicken-menu",
                name: "Menu Long Chicken",
                requiredComponents: [
                    {
                        type: "side",
                        displayName: "Accompagnement",
                        min: 1,
                        max: 1,
                        allowedProductIds: ["fries", "rustiques"],
                        defaultProductId: "fries",
                        priceIncluded: true
                    },
                    {
                        type: "drink",
                        displayName: "Boisson",
                        min: 1,
                        max: 1,
                        allowedProductIds: ["coca", "coca-zero", "water"],
                        defaultProductId: "coca",
                        priceIncluded: true
                    }
                ]
            }
        ];

        this.initializeWithStaticData('default', products, menuRules);
    }

    // ============================================
    // CATALOGUE ACCESS
    // ============================================

    /**
     * Récupère le catalogue pour un store
     */
    getCatalogue(storeId: string): Product[] {
        const cached = this.cache.get(storeId);

        if (!cached && storeId !== 'default') {
            // Fallback to default for now
            return this.cache.get('default')?.products || [];
        }

        return cached?.products || [];
    }

    /**
     * Récupère les règles de menu pour un store
     */
    getMenuRules(storeId: string): MenuRule[] {
        const cached = this.cache.get(storeId);

        if (!cached && storeId !== 'default') {
            return this.cache.get('default')?.menuRules || [];
        }

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
            p.synonyms.some((s: string) => this.normalizeString(s) === searchName)
        );
        if (product) return product;

        // Recherche partielle
        product = catalogue.find(p =>
            this.normalizeString(p.name).includes(searchName) ||
            searchName.includes(this.normalizeString(p.name)) ||
            p.synonyms.some((s: string) =>
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
        // Mock implementation for shadow mode
        const product = this.getCatalogue(storeId).find(p => p.id === productId);
        return product?.available ?? false;
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
