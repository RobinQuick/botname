export const wrapCheeseBaconRecipe = {
    id: "wrap-cheese-bacon",
    name: "Wrap Cheese & Bacon",
    subtitle: "Bacon de poulet",

    capacities: {
        odyssee: 4,
        optikitchen: 5,
    },

    ingredients: [
        {
            id: "patty-chicken-long",
            label: "Patty chicken long",
            quantity: "x1",
            note: "à couper en 2",
            icon: "/static/sop/recipe/wrap-cheese-bacon/patty-chicken-long.png",
        },
        {
            id: "bacon-poulet",
            label: "Bacon de poulet",
            quantity: "x2",
            icon: "/static/sop/recipe/wrap-cheese-bacon/bacon.png",
        },
        {
            id: "fromage-fondu",
            label: "Fromage fondu",
            quantity: "x2",
            icon: "/static/sop/recipe/wrap-cheese-bacon/cheese.png",
        },
        {
            id: "tomates",
            label: "Tomates",
            quantity: "x2",
            icon: "/static/sop/recipe/wrap-cheese-bacon/tomate.png",
        },
        {
            id: "iceberg",
            label: "Iceberg",
            quantity: "15g",
            icon: "/static/sop/recipe/wrap-cheese-bacon/iceberg.png",
        },
        {
            id: "sauce-chicken-cheese",
            label: "Sauce chicken cheese",
            quantity: "2x10g",
            note: "à étirer le long de la tortilla",
            icon: "/static/sop/recipe/wrap-cheese-bacon/sauce.png",
        },
        {
            id: "tortilla",
            label: "Tortilla",
            quantity: "",
            icon: "/static/sop/recipe/wrap-cheese-bacon/tortilla.png",
        }
    ]
} as const;
