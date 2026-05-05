export const PSA_TIERS = [
  { name: "Economy",       fee: 25 },
  { name: "Regular",       fee: 50 },
  { name: "Express",       fee: 150 },
  { name: "Super Express", fee: 300 },
  { name: "Walk-through",  fee: 600 },
];

export const BGS_TIERS = [
  { name: "Economy",       fee: 20 },
  { name: "Standard",      fee: 50 },
  { name: "Express",       fee: 150 },
  { name: "Super Express", fee: 300 },
  { name: "Concierge",     fee: 500 },
];

export const CGC_TIERS = [
  { name: "Standard",      fee: 20 },
  { name: "Express",       fee: 100 },
  { name: "Super Express", fee: 200 },
  { name: "Walk-through",  fee: 500 },
];

export const TAG_TIERS = [
  { name: "Standard",      fee: 20 },
  { name: "Express",       fee: 50 },
  { name: "Rush",          fee: 100 },
];

export const GRADING_COMPANY_TIERS = {
  PSA: PSA_TIERS,
  BGS: BGS_TIERS,
  CGC: CGC_TIERS,
  TAG: TAG_TIERS,
};
