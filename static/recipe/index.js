import { wrapCheeseBaconRecipe } from './wrap-cheese-bacon.js';
import { giantRecipe } from './giant.js';

export const recipesById = {
    "wrap-cheese-bacon": wrapCheeseBaconRecipe,
    "giant": giantRecipe,
    // Fallback for others
    "giant-max": { ...giantRecipe, id: "giant-max", name: "Giant Max" },
    "mega-giant": { ...giantRecipe, id: "mega-giant", name: "Méga Giant" },
    "junior-giant": { ...giantRecipe, id: "junior-giant", name: "Junior Giant" },
    "long-chicken": { ...giantRecipe, id: "long-chicken", name: "Long Chicken" },
    "long-bacon": { ...giantRecipe, id: "long-bacon", name: "Long Bacon" },
    "long-fish": { ...giantRecipe, id: "long-fish", name: "Long Fish" },
    "supreme-classiq": { ...giantRecipe, id: "supreme-classiq", name: "Suprême Classiq" },
    "supreme-spicy-chicken": { ...giantRecipe, id: "supreme-spicy-chicken", name: "Suprême Spicy Chicken" },
    "supreme-bacon": { ...giantRecipe, id: "supreme-bacon", name: "Suprême Bacon" },
    "quick-n-toast": { ...giantRecipe, id: "quick-n-toast", name: "Quick'N Toast" },
    "cheeseburger-double-cheese": { ...giantRecipe, id: "cheeseburger-double-cheese", name: "Cheeseburger" },
    "classiq-crispy-beef": { ...giantRecipe, id: "classiq-crispy-beef", name: "ClassiQ Crispy" },
    "wrap-chicken-bacon": { ...wrapCheeseBaconRecipe, id: "wrap-chicken-bacon", name: "Wrap Chicken Bacon" },
};
