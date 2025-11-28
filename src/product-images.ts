// ============================================
// Product Image Mapping
// Maps product names to their images in /static/menu
// ============================================

export const PRODUCT_IMAGES: Record<string, string> = {
    // Burgers
    'Giant': '/static/menu/giant.png',
    'Hamburger': '/static/menu/hamburger.png',
    'Cheeseburger': '/static/menu/cheeseburger.png',
    'Junior Giant': '/static/menu/junior_giant.png',
    'Giant Max': '/static/menu/giant_max.png',
    'Giant Max Cheesy': '/static/menu/giant_max_cheesy.png',
    'Giant Max Chicken': '/static/menu/giant_max_chicken.png',

    // Long series
    'Long Bacon': '/static/menu/long_bacon.png',
    'Long Chicken': '/static/menu/long_chicken.png',
    'Long Fish': '/static/menu/long_fish.png',

    // Supreme
    'Suprême Classic': '/static/menu/supreme_classiq.png',
    'Suprême Bacon Chicken': '/static/menu/supreme_bacon_chicken.png',
    'Suprême Spicy Chicken': '/static/menu/supreme_spicy_chicken.png',

    // Other burgers
    'Quick\'n Toast': '/static/menu/quickntoast.png',
    'Wrap Giant Veggie': '/static/menu/wrap_giant_veggie.png',

    // Sides
    'Frites': '/static/menu/frites.png',
    'Potatoes': '/static/menu/rustique.png',
    'Rustiques': '/static/menu/rustique.png',
    'Wings': '/static/menu/wings.png',
    'Chicken Dips': '/static/menu/chicken_dips.png',
    'Chicken Spicy Pops': '/static/menu/chicken_spicy_pops.png',
    'Cheesy Rolls': '/static/menu/cheesy_rolls.png',

    // Desserts
    'Sundae': '/static/menu/sundae.png',
    'Sundae Chocolat': '/static/menu/sundae_chocolat.png',
    'Sundae Fraise': '/static/menu/sundae_fraise.png',
    'Sundae Caramel': '/static/menu/sundae_caramel.png',
    'Mix Mania': '/static/menu/mix_mania.png',
    'Mix M&M\'s': '/static/menu/mix_mms.png',
    'Mix Oreo': '/static/menu/mix_oreo.png',
    'Churros': '/static/menu/churros.png',
    'Fondant': '/static/menu/fondant.png',
    'Muffin': '/static/menu/muffin.png',

    // Default fallback
    'default': '/static/menu/giant.png'
};

// Recipe descriptions (for when customer asks "C'est quoi X?")
export const PRODUCT_DESCRIPTIONS: Record<string, string> = {
    'Giant': "Le Giant, c'est notre burger emblématique: double steak haché, fromage fondant, sauce géante. Un classique Quick!",
    'Long Chicken': "Long Chicken, c'est du poulet pané croustillant, salade fraîche, sauce onctueuse. Délicieux!",
    'Long Bacon': "Long Bacon, c'est bacon croustillant, steak haché, fromage, sauce fumée. Pour les amateurs de bacon!",
    'Long Fish': "Long Fish, notre burger de poisson pané, salade, sauce tartare. Léger et savoureux!",
    'Quick\'n Toast': "Quick'n Toast, pain toasté croustillant, fromage fondu, saveur unique. Un incontournable!",
    'Suprême Classic': "Suprême ClassiQ, le burger premium: pain suprême, double steak, cheddar, oignons crispy. Un délice!",
    'Magic Box': "Magic Box pour les petits: burger, frites, boisson, et un jouet surprise! Parfait pour les enfants.",
    'Fun Box': "Fun Box pour les ados: burger, frites, boisson. Plus copieux que la Magic Box!"
};

// Recipe images (for showing when describing)
export const RECIPE_IMAGES: Record<string, string> = {
    'Giant': '/static/recipe/giant.jpg',
    'Long Chicken': '/static/recipe/long_chicken.jpg',
    'Long Bacon': '/static/recipe/long_bacon.jpg',
    'Long Fish': '/static/recipe/long_fish.jpg',
    'Quick\'n Toast': '/static/recipe/quickntoast.jpg',
    'Suprême Classic': '/static/recipe/supreme_classiq.jpg',
    'Suprême Bacon': '/static/recipe/supreme_bacon.jpg',
    'Hamburger': '/static/recipe/hamburger.jpg',
    'Cheeseburger': '/static/recipe/cheeseburger.jpg',
    'Giant Max': '/static/recipe/giant_max.jpg',
    'Junior Giant': '/static/recipe/junior_giant.jpg'
};

/**
 * Get product image URL
 */
export function getProductImage(productName: string): string {
    return PRODUCT_IMAGES[productName] || PRODUCT_IMAGES['default'];
}

/**
 * Get product description
 */
export function getProductDescription(productName: string): string | null {
    return PRODUCT_DESCRIPTIONS[productName] || null;
}

/**
 * Get recipe image for description
 */
export function getRecipeImage(productName: string): string | null {
    return RECIPE_IMAGES[productName] || null;
}
