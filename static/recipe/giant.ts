export const giantRecipe = {
    id: "giant",
    name: "Giant",
    subtitle: "L'original",

    capacities: {
        odyssee: 4,
        optikitchen: 6,
    },

    ingredients: [
        {
            id: "bun-giant-crown",
            label: "Crown Giant",
            quantity: "x1",
            icon: "/static/sop/recipe/giant/bun_crown.png",
        },
        {
            id: "sauce-giant",
            label: "Sauce Giant",
            quantity: "20g",
            icon: "/static/sop/recipe/giant/sauce.png",
        },
        {
            id: "oignons",
            label: "Oignons",
            quantity: "10g",
            icon: "/static/sop/recipe/giant/onion.png",
        },
        {
            id: "salade",
            label: "Salade",
            quantity: "20g",
            icon: "/static/sop/recipe/giant/salad.png",
        },
        {
            id: "cheddar",
            label: "Cheddar",
            quantity: "x1",
            icon: "/static/sop/recipe/giant/cheese.png",
        },
        {
            id: "patty-reg",
            label: "Patty Reg",
            quantity: "x2",
            icon: "/static/sop/recipe/giant/patty.png",
        },
        {
            id: "bun-giant-heel",
            label: "Heel Giant",
            quantity: "x1",
            icon: "/static/sop/recipe/giant/bun_heel.png",
        }
    ]
} as const;
