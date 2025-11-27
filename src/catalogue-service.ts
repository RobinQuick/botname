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
            // ============================================
            // BURGERS - LES ICONIQUES
            // ============================================
            {
                id: "giant-burger",
                name: "Giant",
                shortName: "Giant",
                category: "burger",
                synonyms: ["le giant", "burger giant", "dja-yeunt"],
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
                id: "quickntoast-burger",
                name: "Quick'N Toast",
                shortName: "Quick'N Toast",
                category: "burger",
                synonyms: ["quickntoast", "quick and toast", "toast"],
                available: true,
                basePrice: 550
            },
            {
                id: "quickntoast-menu",
                name: "Menu Quick'N Toast",
                shortName: "Menu Quick'N Toast",
                category: "menu",
                synonyms: ["menu quickntoast", "menu quick and toast"],
                available: true,
                basePrice: 980,
                sizes: [
                    { size: "medium", displayName: "Normal", priceModifier: 0 },
                    { size: "large", displayName: "Maxi", priceModifier: 80 }
                ]
            },
            {
                id: "long-bacon",
                name: "Long Bacon",
                shortName: "Long Bacon",
                category: "burger",
                synonyms: ["bacon long"],
                available: true,
                basePrice: 580
            },
            {
                id: "long-bacon-menu",
                name: "Menu Long Bacon",
                shortName: "Menu Long Bacon",
                category: "menu",
                synonyms: ["menu bacon long"],
                available: true,
                basePrice: 1010,
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
                synonyms: ["long chicken", "poulet long", "chicken long"],
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
                id: "long-fish",
                name: "Long Fish",
                shortName: "Long Fish",
                category: "burger",
                synonyms: ["poisson long"],
                available: true,
                basePrice: 560
            },
            {
                id: "long-fish-menu",
                name: "Menu Long Fish",
                shortName: "Menu Long Fish",
                category: "menu",
                synonyms: ["menu long fish", "menu poisson"],
                available: true,
                basePrice: 990,
                sizes: [
                    { size: "medium", displayName: "Normal", priceModifier: 0 },
                    { size: "large", displayName: "Maxi", priceModifier: 80 }
                ]
            },

            // ============================================
            // BURGERS - GAMME MAX & SUPRÊME
            // ============================================
            {
                id: "giant-max",
                name: "Giant Max",
                shortName: "Giant Max",
                category: "burger",
                synonyms: ["giantmax", "max giant"],
                available: true,
                basePrice: 680
            },
            {
                id: "giant-max-menu",
                name: "Menu Giant Max",
                shortName: "Menu Giant Max",
                category: "menu",
                synonyms: ["menu giant max"],
                available: true,
                basePrice: 1110,
                sizes: [
                    { size: "medium", displayName: "Normal", priceModifier: 0 },
                    { size: "large", displayName: "Maxi", priceModifier: 80 }
                ]
            },
            {
                id: "supreme-classiq",
                name: "Suprême ClassiQ",
                shortName: "Suprême ClassiQ",
                category: "burger",
                synonyms: ["supreme classic", "classiq"],
                available: true,
                basePrice: 720
            },
            {
                id: "supreme-classiq-menu",
                name: "Menu Suprême ClassiQ",
                shortName: "Menu Suprême ClassiQ",
                category: "menu",
                synonyms: ["menu supreme classic"],
                available: true,
                basePrice: 1150,
                sizes: [
                    { size: "medium", displayName: "Normal", priceModifier: 0 },
                    { size: "large", displayName: "Maxi", priceModifier: 80 }
                ]
            },

            // ============================================
            // FINGER FOOD
            // ============================================
            {
                id: "chicken-dips-7",
                name: "Chicken Dips",
                shortName: "Chicken Dips",
                category: "burger",
                synonyms: ["dips", "nuggets"],
                available: true,
                basePrice: 480
            },
            {
                id: "chicken-dips-menu",
                name: "Menu Chicken Dips",
                shortName: "Menu Dips",
                category: "menu",
                synonyms: ["menu dips", "menu nuggets"],
                available: true,
                basePrice: 910,
                sizes: [
                    { size: "medium", displayName: "Normal", priceModifier: 0 },
                    { size: "large", displayName: "Maxi", priceModifier: 80 }
                ]
            },
            {
                id: "chicken-wings-5",
                name: "Chicken Wings",
                shortName: "Wings",
                category: "burger",
                synonyms: ["wings", "ailes de poulet"],
                available: true,
                basePrice: 520
            },
            {
                id: "chicken-wings-menu",
                name: "Menu Chicken Wings",
                shortName: "Menu Wings",
                category: "menu",
                synonyms: ["menu wings"],
                available: true,
                basePrice: 950,
                sizes: [
                    { size: "medium", displayName: "Normal", priceModifier: 0 },
                    { size: "large", displayName: "Maxi", priceModifier: 80 }
                ]
            },

            // ============================================
            // SIDES
            // ============================================
            {
                id: "fries",
                name: "Frites",
                shortName: "Frites",
                category: "side",
                synonyms: ["frite", "pommes frites", "patate frites"],
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
                synonyms: ["potatoes", "rustique", "patates"],
                available: true,
                basePrice: 320,
                sizes: [
                    { size: "medium", displayName: "Moyenne", priceModifier: 0 },
                    { size: "large", displayName: "Grande", priceModifier: 50 }
                ]
            },

            // ============================================
            // DRINKS - SODAS
            // ============================================
            {
                id: "coca",
                name: "Coca-Cola",
                shortName: "Coca",
                category: "drink",
                synonyms: ["coca", "coke", "coca cola"],
                available: true,
                basePrice: 250,
                sizes: [
                    { size: "small", displayName: "20cl", priceModifier: -50 },
                    { size: "medium", displayName: "35cl", priceModifier: 0 },
                    { size: "large", displayName: "50cl", priceModifier: 50 }
                ]
            },
            {
                id: "coca-zero",
                name: "Coca-Cola Zéro",
                shortName: "Coca Zéro",
                category: "drink",
                synonyms: ["coca zéro", "zéro", "coca zero", "coke zero"],
                available: true,
                basePrice: 250,
                sizes: [
                    { size: "small", displayName: "20cl", priceModifier: -50 },
                    { size: "medium", displayName: "35cl", priceModifier: 0 },
                    { size: "large", displayName: "50cl", priceModifier: 50 }
                ]
            },
            {
                id: "fanta",
                name: "Fanta",
                shortName: "Fanta",
                category: "drink",
                synonyms: ["fanta orange"],
                available: true,
                basePrice: 250,
                sizes: [
                    { size: "small", displayName: "20cl", priceModifier: -50 },
                    { size: "medium", displayName: "35cl", priceModifier: 0 },
                    { size: "large", displayName: "50cl", priceModifier: 50 }
                ]
            },
            {
                id: "sprite",
                name: "Sprite",
                shortName: "Sprite",
                category: "drink",
                synonyms: ["sprite"],
                available: true,
                basePrice: 250,
                sizes: [
                    { size: "small", displayName: "20cl", priceModifier: -50 },
                    { size: "medium", displayName: "35cl", priceModifier: 0 },
                    { size: "large", displayName: "50cl", priceModifier: 50 }
                ]
            },
            {
                id: "ice-tea",
                name: "FuzeTea Pêche",
                shortName: "Ice Tea",
                category: "drink",
                synonyms: ["fuzetea", "ice tea", "thé glacé"],
                available: true,
                basePrice: 270,
                sizes: [
                    { size: "medium", displayName: "35cl", priceModifier: 0 },
                    { size: "large", displayName: "50cl", priceModifier: 50 }
                ]
            },

            // ============================================
            // DRINKS - WATER & JUICE
            // ============================================
            {
                id: "water",
                name: "Eau Vittel",
                shortName: "Eau",
                category: "drink",
                synonyms: ["eau", "vittel", "eau plate"],
                available: true,
                basePrice: 220,
                sizes: [
                    { size: "large", displayName: "50cl", priceModifier: 0 }
                ]
            },
            {
                id: "badoit",
                name: "Badoit",
                shortName: "Badoit",
                category: "drink",
                synonyms: ["eau gazeuse"],
                available: true,
                basePrice: 250,
                sizes: [
                    { size: "large", displayName: "50cl", priceModifier: 0 }
                ]
            },
            {
                id: "juice-apple",
                name: "Minute Maid Pomme",
                shortName: "Jus Pomme",
                category: "drink",
                synonyms: ["jus de pomme", "jus pomme"],
                available: true,
                basePrice: 280
            },

            // ============================================
            // SAUCES
            // ============================================
            {
                id: "sauce-giant",
                name: "Sauce Giant",
                shortName: "Sauce Giant",
                category: "sauce",
                synonyms: [],
                available: true,
                basePrice: 50
            },
            {
                id: "sauce-bbq",
                name: "Sauce Barbecue",
                shortName: "BBQ",
                category: "sauce",
                synonyms: ["barbecue", "bbq"],
                available: true,
                basePrice: 50
            },
            {
                id: "sauce-curry",
                name: "Sauce Curry Mango",
                shortName: "Curry",
                category: "sauce",
                synonyms: ["curry"],
                available: true,
                basePrice: 50
            },
            {
                id: "sauce-mayo",
                name: "Sauce Mayonnaise",
                shortName: "Mayo",
                category: "sauce",
                synonyms: ["mayonnaise", "mayo"],
                available: true,
                basePrice: 50
            },
            {
                id: "sauce-ketchup",
                name: "Ketchup",
                shortName: "Ketchup",
                category: "sauce",
                synonyms: [],
                available: true,
                basePrice: 50
            },

            // ============================================
            // DESSERTS
            // ============================================
            {
                id: "churros-5",
                name: "Churros x5",
                shortName: "Churros",
                category: "dessert",
                synonyms: ["churros"],
                available: true,
                basePrice: 300
            },
            {
                id: "churros-kitkat",
                name: "Churros KitKat",
                shortName: "Churros KitKat",
                category: "dessert",
                synonyms: ["churros kitkat", "kitkat"],
                available: true,
                basePrice: 350
            },
            {
                id: "cookie-choco",
                name: "Cookie Trio Choco",
                shortName: "Cookie",
                category: "dessert",
                synonyms: ["cookie", "cookies"],
                available: true,
                basePrice: 250
            },
            {
                id: "fondant-chocolat",
                name: "Fondant au Chocolat",
                shortName: "Fondant",
                category: "dessert",
                synonyms: ["fondant"],
                available: true,
                basePrice: 300
            },
            {
                id: "donut",
                name: "Qarré Donut Sucre",
                shortName: "Donut",
                category: "dessert",
                synonyms: ["donut", "beignet"],
                available: true,
                basePrice: 280
            },

            // ============================================
            // KIDS MENUS
            // ============================================
            {
                id: "magic-box",
                name: "Magic Box",
                shortName: "Magic Box",
                category: "menu",
                synonyms: ["menu enfant", "menu kids", "magic"],
                available: true,
                basePrice: 580
            },
            {
                id: "fun-box",
                name: "Fun Box",
                shortName: "Fun Box",
                category: "menu",
                synonyms: ["fun box", "menu ado"],
                available: true,
                basePrice: 680
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
