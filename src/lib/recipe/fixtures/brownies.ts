import type { RecipeDoc } from "../types";

// The exemplar from the post that started the project: espresso brownies in
// Cooking for Engineers notation. Two gram values failed unit validation and
// carry corrected provenance, which the card surfaces as footnotes.

export const brownies: RecipeDoc = {
  slug: "espresso-brownies",
  dish: "Espresso Brownies",
  source: {
    platform: "x.com",
    creatorHandle: "@juanbuis",
  },
  prepNotes: ["Butter and flour an 8x8-in pan", "Preheat oven to 350°F"],
  ingredients: [
    {
      id: "butter",
      name: "unsalted butter",
      quantity: { display: "4 oz (115 g)", grams: 115, provenance: "stated" },
    },
    {
      id: "sugar",
      name: "sugar",
      quantity: { display: "1 cup (200 g)", grams: 200, provenance: "stated" },
    },
    {
      id: "vanilla",
      name: "vanilla extract",
      quantity: { display: "1/4 tsp (2.5 mL)", provenance: "stated" },
    },
    {
      id: "espresso",
      name: "fresh brewed espresso or very strong coffee",
      quantity: { display: "1 shot (60 mL)", provenance: "stated" },
    },
    {
      id: "eggs",
      name: "large eggs",
      quantity: { display: "2 (100 g)", grams: 100, provenance: "stated" },
    },
    {
      id: "flour",
      name: "all-purpose flour",
      quantity: {
        display: "1/2 cup (about 60 g)",
        grams: 60,
        provenance: "corrected",
        statedDisplay: "1/2 cup (80 g)",
        note: "King Arthur's ingredient weight chart puts all-purpose flour at 120 g per cup, so 1/2 cup is about 60 g.",
      },
    },
    {
      id: "cocoa",
      name: "Hershey's cocoa powder",
      quantity: {
        display: "1/3 cup (about 27 g)",
        grams: 27,
        provenance: "corrected",
        statedDisplay: "1/3 cup (80 g)",
        note: "Hershey's label weighs cocoa at 5 g per tablespoon, about 80 g per full cup, so 1/3 cup is about 27 g.",
      },
    },
    {
      id: "soda",
      name: "baking soda",
      quantity: { display: "1/4 tsp (1.3 g)", provenance: "stated" },
    },
    {
      id: "salt",
      name: "table salt",
      quantity: { display: "1/4 tsp (1.5 g)", provenance: "stated" },
    },
  ],
  steps: [
    { id: "melt", label: "melt", inputs: ["butter"] },
    { id: "mix-wet", label: "mix", inputs: ["melt", "sugar", "vanilla", "espresso"] },
    { id: "mix-eggs", label: "mix", inputs: ["mix-wet", "eggs"] },
    { id: "fold", label: "fold in", inputs: ["mix-eggs", "flour", "cocoa", "soda", "salt"] },
    { id: "bake", label: "bake 350°F, 30 to 40 min", inputs: ["fold"] },
  ],
};
