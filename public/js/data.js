// Spieldaten: Biome, Güter, Gebäude, Forschung, Bedürfnisse, Zeitalter

// ------------------------------------------------------------ Biome
// Modifikatoren wirken auf Provinzen (bei zwei Biomen je zur Hälfte)
export const BIOMES = [
  { id: 0, key: 'meer', name: 'Meer', color: '#3f6f8a', water: true },
  { id: 1, key: 'flach', name: 'Flachland', color: '#a9b46a', trees: 0.25, fert: 1.0, mods: { nahrung: 1.25, holz: 0.8, stein: 0.8, erz: 0.6, wachstum: 1.1, bau: 1.0 } },
  { id: 2, key: 'wald', name: 'Wald', color: '#5f7d45', trees: 1.0, fert: 0.55, mods: { nahrung: 0.9, holz: 1.5, stein: 0.9, erz: 0.8, wachstum: 1.0, bau: 1.05 } },
  { id: 3, key: 'hoch', name: 'Hochland', color: '#9c8f6a', trees: 0.35, fert: 0.5, mods: { nahrung: 0.8, holz: 0.9, stein: 1.4, erz: 1.4, wachstum: 0.9, bau: 1.1 } },
  { id: 4, key: 'sumpf', name: 'Sumpf', color: '#6f7d5c', trees: 0.45, fert: 0.35, mods: { nahrung: 0.85, holz: 1.0, stein: 0.6, erz: 0.6, wachstum: 0.85, bau: 1.25 } },
  { id: 5, key: 'wueste', name: 'Wüste', color: '#d8c38a', trees: 0.03, fert: 0.12, mods: { nahrung: 0.6, holz: 0.4, stein: 1.0, erz: 1.1, wachstum: 0.8, bau: 1.0 } },
  { id: 6, key: 'gebirge', name: 'Gebirge (unbewohnbar)', color: '#7d7468', trees: 0.05, fert: 0, blocked: true },
  { id: 7, key: 'pass', name: 'Bergpass', color: '#8f8470', trees: 0.15, fert: 0.3, mods: { nahrung: 0.7, holz: 0.8, stein: 1.5, erz: 1.5, wachstum: 0.85, bau: 1.2 } },
];
export const B = Object.fromEntries(BIOMES.map(b => [b.key, b.id]));
export const MOD_NAMES = { nahrung: 'Nahrung', holz: 'Holz', stein: 'Stein', erz: 'Erze', wachstum: 'Wachstum', bau: 'Baukosten' };

// ------------------------------------------------------------ Vorkommen (Lagerstätten)
export const DEPOSITS = [
  null,
  { id: 1, key: 'stein', name: 'Steinvorkommen', good: 'stein', color: '#b9b2a6' },
  { id: 2, key: 'lehm', name: 'Lehmvorkommen', good: 'lehm', color: '#b4744a' },
  { id: 3, key: 'eisen', name: 'Eisenerz', good: 'eisenerz', color: '#8a5a4a' },
  { id: 4, key: 'kupfer', name: 'Kupfererz', good: 'kupfererz', color: '#c77b3c' },
  { id: 5, key: 'zinn', name: 'Zinnerz', good: 'zinnerz', color: '#a3a9b0' },
  { id: 6, key: 'kohle', name: 'Kohle', good: 'kohle', color: '#333' },
  { id: 7, key: 'gold', name: 'Golderz', good: 'golderz', color: '#e6c34a' },
  { id: 8, key: 'edelstein', name: 'Edelsteine', good: 'edelsteine', color: '#b44ad8' },
  { id: 9, key: 'salz', name: 'Salz', good: 'salz', color: '#f0f0f0' },
  { id: 10, key: 'sand', name: 'Quarzsand', good: 'sand', color: '#e8d9a0' },
];
export const DEP = Object.fromEntries(DEPOSITS.filter(Boolean).map(d => [d.key, d.id]));

// ------------------------------------------------------------ Güter
// price = Grundpreis, food = zählt als Nahrung, q = hat Qualitätsstufen
export const GOODS = {
  holz: { name: 'Holz', price: 2, cat: 'Rohstoffe', icon: '🪵' },
  stein: { name: 'Stein', price: 3, cat: 'Rohstoffe', icon: '🪨' },
  lehm: { name: 'Lehm', price: 2, cat: 'Rohstoffe', icon: '🟫' },
  getreide: { name: 'Getreide', price: 2, cat: 'Rohstoffe', icon: '🌾' },
  wolle: { name: 'Wolle', price: 4, cat: 'Rohstoffe', icon: '🧶' },
  sand: { name: 'Quarzsand', price: 1.5, cat: 'Rohstoffe', icon: '⏳' },
  eisenerz: { name: 'Eisenerz', price: 5, cat: 'Erze', icon: '⛏️' },
  kupfererz: { name: 'Kupfererz', price: 5, cat: 'Erze', icon: '⛏️' },
  zinnerz: { name: 'Zinnerz', price: 6, cat: 'Erze', icon: '⛏️' },
  kohle: { name: 'Kohle', price: 4, cat: 'Erze', icon: '⬛' },
  golderz: { name: 'Golderz', price: 28, cat: 'Erze', icon: '✨' },
  edelsteine: { name: 'Edelsteine', price: 60, cat: 'Erze', icon: '💎' },
  salz: { name: 'Salz', price: 7, cat: 'Waren', icon: '🧂' },
  beeren: { name: 'Beeren & Kräuter', price: 2.5, cat: 'Nahrung', icon: '🫐', food: 0.8 },
  fisch: { name: 'Fisch', price: 4, cat: 'Nahrung', icon: '🐟', food: 1 },
  fleisch: { name: 'Fleisch', price: 5, cat: 'Nahrung', icon: '🍖', food: 1.1 },
  mehl: { name: 'Mehl', price: 4, cat: 'Zwischenwaren', icon: '🥣' },
  brot: { name: 'Brot', price: 5, cat: 'Nahrung', icon: '🍞', food: 1.2 },
  bretter: { name: 'Bretter', price: 5, cat: 'Baustoffe', icon: '🪚' },
  werkstein: { name: 'Werkstein', price: 7, cat: 'Baustoffe', icon: '🧱' },
  ziegel: { name: 'Ziegel', price: 6, cat: 'Baustoffe', icon: '🧱' },
  glas: { name: 'Glas', price: 14, cat: 'Baustoffe', icon: '🪟' },
  stoff: { name: 'Stoff', price: 10, cat: 'Zwischenwaren', icon: '🧵' },
  kleidung: { name: 'Kleidung', price: 18, cat: 'Waren', icon: '👕' },
  eisen: { name: 'Eisen', price: 14, cat: 'Metalle', icon: '🔩' },
  kupfer: { name: 'Kupfer', price: 13, cat: 'Metalle', icon: '🟠' },
  zinn: { name: 'Zinn', price: 15, cat: 'Metalle', icon: '⚪' },
  bronze: { name: 'Bronze', price: 30, cat: 'Metalle', icon: '🔔' },
  werkzeug: { name: 'Werkzeug', price: 22, cat: 'Waren', icon: '🔨' },
  bier: { name: 'Bier', price: 9, cat: 'Waren', icon: '🍺' },
  moebel: { name: 'Möbel', price: 42, cat: 'Luxus', icon: '🪑', q: true },
  schmuck: { name: 'Schmuck', price: 110, cat: 'Luxus', icon: '💍', q: true },
  waffen: { name: 'Waffen', price: 55, cat: 'Luxus', icon: '⚔️', q: true },
  wagen: { name: 'Wagen', price: 75, cat: 'Luxus', icon: '🛞', q: true },
};
export const GOOD_IDS = Object.keys(GOODS);
export const QUALITY = [
  { name: 'einfach', input: 1.0, price: 1.0, sat: 1.0 },
  { name: 'gut', input: 1.5, price: 1.75, sat: 1.3 },
  { name: 'edel', input: 2.2, price: 2.9, sat: 1.6 },
];
// Lagerschlüssel: "holz" oder "moebel#1" (Qualität 0..2)
export function goodKey(id, q = 0) { return GOODS[id].q ? `${id}#${q}` : id; }
export function parseKey(key) { const [id, q] = key.split('#'); return { id, q: q === undefined ? 0 : +q }; }
export function keyName(key) { const { id, q } = parseKey(key); return GOODS[id].q ? `${GOODS[id].name} (${QUALITY[q].name})` : GOODS[id].name; }
export function keyIcon(key) { return GOODS[parseKey(key).id].icon; }
export function keyBasePrice(key) { const { id, q } = parseKey(key); return GOODS[id].price * (GOODS[id].q ? QUALITY[q].price : 1); }
export const ALL_KEYS = GOOD_IDS.flatMap(id => (GOODS[id].q ? [0, 1, 2].map(q => `${id}#${q}`) : [id]));

// ------------------------------------------------------------ Bedürfnisse (pro 100 Einwohner und Tag)
export const NEEDS = [
  { tier: 1, name: 'Grundbedarf', items: [{ group: 'nahrung', name: 'Nahrung', amount: 10 }, { good: 'holz', name: 'Brennholz', amount: 3 }] },
  { tier: 2, name: 'Bürgerbedarf', items: [{ good: 'kleidung', name: 'Kleidung', amount: 1.5 }, { good: 'salz', name: 'Salz', amount: 1 }, { good: 'bier', name: 'Bier', amount: 1.5 }] },
  { tier: 3, name: 'Gehobener Bedarf', items: [{ good: 'werkzeug', name: 'Werkzeug', amount: 0.6 }, { good: 'moebel', name: 'Möbel', amount: 0.4 }, { good: 'glas', name: 'Glas', amount: 0.4 }] },
  { tier: 4, name: 'Luxusbedarf', items: [{ good: 'schmuck', name: 'Schmuck', amount: 0.25 }, { good: 'moebel', name: 'Möbel', amount: 0.3 }, { good: 'waffen', name: 'Waffen (Zier)', amount: 0.15 }] },
];
export const FOOD_GOODS = GOOD_IDS.filter(g => GOODS[g].food);

// ------------------------------------------------------------ Zeitalter
export const ERAS = [
  { id: 1, name: 'Siedlungszeit' },
  { id: 2, name: 'Mittelalter' },
  { id: 3, name: 'Frühe Neuzeit' },
  { id: 4, name: 'Manufakturzeit' },
  { id: 5, name: 'Frühe Industrie' },
];

// ------------------------------------------------------------ Gebäude
// size: [Breite, Höhe] in Welteinheiten (1 Kachel ≈ 41 Einheiten breit)
// cost: Baukosten (geld + Güter), time: Bauzeit in Stunden, workers: Arbeitsplätze, upkeep: Geld/Tag
// recipes: [{in:{}, out:{}}] je Tag bei voller Besetzung
// loc: Standortfaktor ('trees' | 'fert' | 'water' | 'deposit:<keys>' | 'grass')
// house: {cap, tier}
export const CATEGORIES = [
  { id: 'wohnen', name: 'Wohnen', icon: '🏠' },
  { id: 'roh', name: 'Rohstoffe', icon: '🪓' },
  { id: 'nahrung', name: 'Nahrung', icon: '🌾' },
  { id: 'handwerk', name: 'Handwerk', icon: '🔨' },
  { id: 'manufaktur', name: 'Manufaktur', icon: '🏭' },
  { id: 'handel', name: 'Handel', icon: '⚖️' },
  { id: 'stadt', name: 'Öffentlich', icon: '⛪' },
  { id: 'wege', name: 'Wege', icon: '🛤️' },
];

export const BUILDINGS = {
  zentrum: { name: 'Dorfplatz', cat: 'stadt', size: [10, 10], cost: {}, time: 0, workers: 0, upkeep: 0, hidden: true, color: '#c9a86a', desc: 'Mittelpunkt der Stadt. Hier lagern alle Waren.', prestige: 2 },

  // --- Wohnen
  haus1: { name: 'Einfamilienhaus', cat: 'wohnen', era: 1, size: [5, 5], cost: { geld: 20, holz: 12 }, time: 12, workers: 0, upkeep: 0.2, house: { cap: 6, tier: 1 }, color: '#b5651d', desc: 'Bietet 6 Einwohnern Platz. Bewohner brauchen Nahrung und Brennholz.' },
  haus2: { name: 'Mehrfamilienhaus', cat: 'wohnen', era: 2, tech: 'stadtrecht', size: [8, 7], cost: { geld: 80, bretter: 20, werkstein: 12, ziegel: 10 }, time: 36, workers: 0, upkeep: 0.6, house: { cap: 18, tier: 2 }, color: '#9b3b2a', desc: 'Bietet 18 Einwohnern Platz. Bewohner verlangen zusätzlich Kleidung, Salz und Bier.' },
  haus3: { name: 'Bürgerhaus', cat: 'wohnen', era: 3, tech: 'buergertum', size: [9, 8], cost: { geld: 220, werkstein: 30, ziegel: 30, glas: 10, bretter: 20 }, time: 60, workers: 0, upkeep: 1.2, house: { cap: 30, tier: 3 }, color: '#7a2f3a', desc: 'Bietet 30 Einwohnern Platz. Bewohner verlangen Werkzeug, Möbel und Glas.', prestige: 1 },
  haus4: { name: 'Patrizierhaus', cat: 'wohnen', era: 4, tech: 'patriziat', size: [11, 10], cost: { geld: 500, werkstein: 50, ziegel: 40, glas: 25, moebel: 4 }, time: 96, workers: 0, upkeep: 3, house: { cap: 24, tier: 4 }, color: '#5a2a5a', desc: 'Wohlhabende Familien. Hohe Steuern, verlangen Schmuck, Möbel und Zierwaffen.', prestige: 3 },

  // --- Rohstoffe
  holzfaeller: { name: 'Holzfäller', cat: 'roh', era: 1, size: [6, 6], cost: { geld: 40 }, time: 16, workers: 3, upkeep: 0.5, loc: 'trees', mod: 'holz', recipes: [{ in: {}, out: { holz: 9 } }], color: '#6b4f2a', desc: 'Schlägt Holz in der Umgebung. Je mehr Bäume (Wald!), desto mehr Holz.' },
  steinbruch: { name: 'Steinbruch', cat: 'roh', era: 1, size: [7, 7], cost: { geld: 40, holz: 15 }, time: 20, workers: 4, upkeep: 0.6, loc: 'deposit:stein', mod: 'stein', recipes: [{ in: {}, out: { stein: 7 } }], color: '#8a8a80', desc: 'Bricht Stein. Steinvorkommen in der Nähe erhöhen den Ertrag stark.' },
  lehmgrube: { name: 'Lehmgrube', cat: 'roh', era: 1, size: [6, 6], cost: { geld: 25, holz: 10 }, time: 14, workers: 3, upkeep: 0.4, loc: 'deposit:lehm', mod: 'stein', recipes: [{ in: {}, out: { lehm: 7 } }], color: '#a0603a', desc: 'Gräbt Lehm. Ideal an Lehmvorkommen, im Sumpf oder am Fluss.' },
  schaeferei: { name: 'Schäferei', cat: 'roh', era: 1, tech: 'viehzucht', size: [9, 8], cost: { geld: 35, holz: 15 }, time: 18, workers: 2, upkeep: 0.4, loc: 'grass', mod: 'nahrung', recipes: [{ in: {}, out: { wolle: 4 } }], color: '#d9d3b5', desc: 'Hält Schafe für Wolle. Braucht offenes Weideland.' },
  bergwerk: { name: 'Bergwerk', cat: 'roh', era: 2, tech: 'bergbau', size: [8, 8], cost: { geld: 90, holz: 20, bretter: 10 }, time: 36, workers: 6, upkeep: 1.2, loc: 'deposit:eisen,kupfer,zinn,kohle,gold,edelstein', mod: 'erz', recipes: 'deposit', color: '#4f4a45', desc: 'Fördert das Erz der nächstgelegenen Lagerstätte (Eisen, Kupfer, Zinn, Kohle, Gold, Edelsteine).' },
  sandgrube: { name: 'Sandgrube', cat: 'roh', era: 2, tech: 'glasblaeserei', size: [6, 6], cost: { geld: 30, holz: 10 }, time: 14, workers: 2, upkeep: 0.3, loc: 'deposit:sand', mod: 'stein', recipes: [{ in: {}, out: { sand: 8 } }], color: '#e0cf8f', desc: 'Gewinnt Quarzsand, vor allem in der Wüste.' },
  salzsiederei: { name: 'Salzsiederei', cat: 'roh', era: 2, tech: 'salzgewinnung', size: [7, 6], cost: { geld: 60, holz: 15, stein: 15 }, time: 24, workers: 3, upkeep: 0.6, loc: 'deposit:salz', mod: 'erz', recipes: [{ in: { holz: 2 }, out: { salz: 4 } }], color: '#e6e6e6', desc: 'Siedet Salz aus Salzvorkommen (Wüste, Küste).' },

  // --- Nahrung
  sammler: { name: 'Sammlerhütte', cat: 'nahrung', era: 1, size: [5, 5], cost: { geld: 20 }, time: 10, workers: 2, upkeep: 0.2, loc: 'forage', mod: 'nahrung', recipes: [{ in: {}, out: { beeren: 7 } }], color: '#7a4a7a', desc: 'Sammelt Beeren und Kräuter. Einfache erste Nahrungsquelle.' },
  jaeger: { name: 'Jägerhütte', cat: 'nahrung', era: 1, size: [5, 5], cost: { geld: 25, holz: 5 }, time: 12, workers: 2, upkeep: 0.3, loc: 'trees', mod: 'nahrung', recipes: [{ in: {}, out: { fleisch: 5 } }], color: '#7a3a2a', desc: 'Jagt Wild. Im Wald besonders ergiebig.' },
  fischer: { name: 'Fischerhütte', cat: 'nahrung', era: 1, size: [5, 5], cost: { geld: 30, holz: 15 }, time: 14, workers: 2, upkeep: 0.3, loc: 'water', mod: 'nahrung', recipes: [{ in: {}, out: { fisch: 8 } }], color: '#4a6a8a', desc: 'Fängt Fisch. Muss am Meer oder Fluss stehen.' },
  bauernhof: { name: 'Bauernhof', cat: 'nahrung', era: 1, tech: 'ackerbau', size: [12, 10], cost: { geld: 45, holz: 20 }, time: 24, workers: 4, upkeep: 0.6, loc: 'fert', mod: 'nahrung', recipes: [{ in: {}, out: { getreide: 14 } }], color: '#d6b84a', desc: 'Baut Getreide an. Fruchtbares Flachland ist ideal.' },
  muehle: { name: 'Mühle', cat: 'nahrung', era: 1, tech: 'muehlenbau', size: [6, 6], cost: { geld: 60, bretter: 10, stein: 10 }, time: 24, workers: 2, upkeep: 0.6, recipes: [{ in: { getreide: 10 }, out: { mehl: 9 } }], color: '#e8d6a0', desc: 'Mahlt Getreide zu Mehl.' },
  baeckerei: { name: 'Bäckerei', cat: 'nahrung', era: 1, tech: 'muehlenbau', size: [6, 5], cost: { geld: 50, bretter: 8, stein: 10 }, time: 20, workers: 2, upkeep: 0.5, recipes: [{ in: { mehl: 8, holz: 1 }, out: { brot: 12 } }], color: '#c48a3a', desc: 'Backt Brot – die beste Nahrung.' },
  brauerei: { name: 'Brauerei', cat: 'nahrung', era: 2, tech: 'braukunst', size: [7, 6], cost: { geld: 80, bretter: 15, werkstein: 10 }, time: 30, workers: 3, upkeep: 0.8, recipes: [{ in: { getreide: 6, holz: 1 }, out: { bier: 6 } }], color: '#a06a2a', desc: 'Braut Bier aus Getreide.' },

  // --- Handwerk
  schreiner: { name: 'Schreinerei', cat: 'handwerk', era: 1, tech: 'handwerk', size: [6, 6], cost: { geld: 50, holz: 20, stein: 5 }, time: 18, workers: 3, upkeep: 0.5, recipes: [{ in: { holz: 6 }, out: { bretter: 5 } }], color: '#8b5a2b', desc: 'Sägt Holz zu Brettern.' },
  steinmetz: { name: 'Steinmetz', cat: 'handwerk', era: 1, tech: 'handwerk', size: [6, 6], cost: { geld: 50, holz: 20, stein: 10 }, time: 18, workers: 3, upkeep: 0.5, recipes: [{ in: { stein: 6 }, out: { werkstein: 4 } }], color: '#9a9a90', desc: 'Behaut Stein zu Werkstein.' },
  ziegelei: { name: 'Ziegelei', cat: 'handwerk', era: 2, tech: 'stadtrecht', size: [7, 6], cost: { geld: 60, holz: 15, stein: 15 }, time: 24, workers: 3, upkeep: 0.6, recipes: [{ in: { lehm: 8, holz: 2 }, out: { ziegel: 6 } }], color: '#b04a2a', desc: 'Brennt Lehm zu Ziegeln.' },
  weberei: { name: 'Weberei', cat: 'handwerk', era: 1, tech: 'viehzucht', size: [6, 6], cost: { geld: 55, holz: 15, stein: 5 }, time: 20, workers: 3, upkeep: 0.5, recipes: [{ in: { wolle: 6 }, out: { stoff: 4 } }], color: '#8a7ab0', desc: 'Webt Wolle zu Stoff.' },
  schneider: { name: 'Schneiderei', cat: 'handwerk', era: 2, tech: 'zuenfte', size: [6, 5], cost: { geld: 70, bretter: 10, werkstein: 5 }, time: 22, workers: 2, upkeep: 0.6, recipes: [{ in: { stoff: 4 }, out: { kleidung: 3 } }], color: '#6a5a9a', desc: 'Näht Kleidung aus Stoff.' },
  huette: { name: 'Schmelzhütte', cat: 'handwerk', era: 2, tech: 'bergbau', size: [7, 7], cost: { geld: 100, stein: 20, werkstein: 10 }, time: 36, workers: 4, upkeep: 1.2, recipes: [
    { in: { eisenerz: 6, kohle: 3 }, out: { eisen: 4 } },
    { in: { kupfererz: 6, kohle: 3 }, out: { kupfer: 4 } },
    { in: { zinnerz: 6, kohle: 3 }, out: { zinn: 4 } },
    { in: { kupfer: 3, zinn: 1, kohle: 1 }, out: { bronze: 3 } },
  ], color: '#5a3a2a', desc: 'Schmilzt Erze mit Kohle zu Metall. Rezept wählbar.' },
  schmiede: { name: 'Schmiede', cat: 'handwerk', era: 2, tech: 'schmiedekunst', size: [6, 6], cost: { geld: 90, werkstein: 10, bretter: 10 }, time: 30, workers: 3, upkeep: 0.9, recipes: [{ in: { eisen: 3, holz: 2 }, out: { werkzeug: 3 } }], color: '#3a3a3a', desc: 'Schmiedet Werkzeug.' },
  glashuette: { name: 'Glashütte', cat: 'handwerk', era: 2, tech: 'glasblaeserei', size: [7, 6], cost: { geld: 100, werkstein: 15, ziegel: 10 }, time: 30, workers: 3, upkeep: 1, recipes: [{ in: { sand: 6, holz: 4 }, out: { glas: 3 } }], color: '#7ab0c0', desc: 'Bläst Glas aus Quarzsand.' },

  // --- Manufakturen (Qualität einstellbar)
  moebel: { name: 'Möbelmanufaktur', cat: 'manufaktur', era: 3, tech: 'manufaktur', size: [9, 8], cost: { geld: 250, werkstein: 20, bretter: 25, werkzeug: 5 }, time: 48, workers: 6, upkeep: 2, quality: true, recipes: [{ in: { bretter: 6, stoff: 1 }, out: { moebel: 2 } }], color: '#6a3a1a', desc: 'Fertigt Möbel. Qualität einstellbar.' },
  goldschmied: { name: 'Goldschmiede', cat: 'manufaktur', era: 3, tech: 'goldschmiedekunst', size: [6, 6], cost: { geld: 300, werkstein: 20, glas: 5 }, time: 48, workers: 3, upkeep: 2, quality: true, recipes: [
    { in: { golderz: 3 }, out: { schmuck: 1 } },
    { in: { golderz: 2, edelsteine: 1 }, out: { schmuck: 2 } },
    { in: { bronze: 3 }, out: { schmuck: 1 } },
  ], color: '#c9a227', desc: 'Fertigt Schmuck aus Gold, Edelsteinen oder Bronze.' },
  waffenschmiede: { name: 'Waffenschmiede', cat: 'manufaktur', era: 3, tech: 'waffenhandwerk', size: [7, 7], cost: { geld: 240, werkstein: 20, bretter: 10, werkzeug: 5 }, time: 48, workers: 5, upkeep: 1.8, quality: true, recipes: [{ in: { eisen: 4, holz: 2 }, out: { waffen: 2 } }], color: '#4a4a5a', desc: 'Schmiedet Waffen. Gefragtes Handelsgut.' },
  wagnerei: { name: 'Wagnerei', cat: 'manufaktur', era: 3, tech: 'fuhrwesen', size: [8, 7], cost: { geld: 200, bretter: 25, werkzeug: 4 }, time: 40, workers: 4, upkeep: 1.5, quality: true, recipes: [{ in: { bretter: 6, eisen: 2 }, out: { wagen: 1 } }], color: '#7a5a3a', desc: 'Baut Wagen. Wertvolles Handelsgut.' },
  textilmanufaktur: { name: 'Textilmanufaktur', cat: 'manufaktur', era: 4, tech: 'verlagswesen', size: [12, 9], cost: { geld: 450, werkstein: 30, ziegel: 30, werkzeug: 10 }, time: 72, workers: 10, upkeep: 3, recipes: [{ in: { wolle: 14 }, out: { stoff: 11 } }, { in: { stoff: 8 }, out: { kleidung: 7 } }], color: '#5a4a8a', desc: 'Verarbeitet große Mengen Wolle oder Stoff.' },
  werkzeugmanufaktur: { name: 'Werkzeugmanufaktur', cat: 'manufaktur', era: 4, tech: 'verlagswesen', size: [10, 8], cost: { geld: 420, werkstein: 30, ziegel: 20, werkzeug: 10 }, time: 72, workers: 8, upkeep: 3, recipes: [{ in: { eisen: 8, holz: 4 }, out: { werkzeug: 10 } }], color: '#3a3a4a', desc: 'Stellt Werkzeug in großen Mengen her.' },
  dampfsaege: { name: 'Dampfsägewerk', cat: 'manufaktur', era: 5, tech: 'dampfkraft', size: [12, 10], cost: { geld: 700, ziegel: 40, eisen: 20, werkzeug: 10 }, time: 96, workers: 8, upkeep: 4, recipes: [{ in: { holz: 22, kohle: 2 }, out: { bretter: 20 } }], color: '#5a4a3a', desc: 'Dampfbetriebene Säge – riesiger Ausstoß an Brettern.' },
  eisenwerk: { name: 'Eisenwerk', cat: 'manufaktur', era: 5, tech: 'dampfkraft', size: [14, 11], cost: { geld: 900, ziegel: 50, werkstein: 30, werkzeug: 15 }, time: 120, workers: 12, upkeep: 5, recipes: [{ in: { eisenerz: 18, kohle: 8 }, out: { eisen: 14 } }], color: '#3a2a2a', desc: 'Großhütte mit Dampfgebläse.' },
  moebelfabrik: { name: 'Möbelfabrik', cat: 'manufaktur', era: 5, tech: 'fabriksystem', size: [14, 11], cost: { geld: 1000, ziegel: 50, glas: 20, eisen: 20, werkzeug: 15 }, time: 120, workers: 14, upkeep: 6, quality: true, recipes: [{ in: { bretter: 18, stoff: 3, kohle: 2 }, out: { moebel: 8 } }], color: '#4a2a1a', desc: 'Massenfertigung von Möbeln.' },

  // --- Handel
  marktplatz: { name: 'Marktplatz', cat: 'handel', era: 1, size: [11, 11], cost: { geld: 60, holz: 20, stein: 10 }, time: 24, workers: 2, upkeep: 0.8, traders: { fuss: 3 }, color: '#d9b36a', desc: 'Ermöglicht Handel mit anderen Städten. Jeder Marktplatz stellt 3 Händler.' },
  fuhrhof: { name: 'Fuhrhof', cat: 'handel', era: 2, tech: 'fuhrwesen', size: [10, 8], cost: { geld: 120, bretter: 20, werkstein: 10 }, time: 36, workers: 3, upkeep: 1.2, traders: { karren: 2 }, color: '#9a7a4a', desc: 'Stellt 2 Karren: tragen 40 Einheiten von bis zu 3 Waren, günstiger pro Einheit.' },
  hafen: { name: 'Hafen', cat: 'handel', era: 2, tech: 'schiffbau', size: [10, 9], cost: { geld: 160, bretter: 40, werkstein: 15 }, time: 48, workers: 4, upkeep: 1.5, loc: 'water', needWater: true, traders: { boot: 2 }, color: '#4a6a9a', desc: 'Stellt 2 Boote. Muss am Wasser stehen. Ermöglicht Fluss-, See- und Fernhandel.' },
  lager: { name: 'Lagerhaus', cat: 'handel', era: 1, size: [8, 6], cost: { geld: 40, holz: 25 }, time: 18, workers: 1, upkeep: 0.4, storage: 400, color: '#8a6a3a', desc: 'Erhöht die Lagerkapazität je Ware um 400.' },

  // --- Öffentlich
  brunnen: { name: 'Brunnen', cat: 'stadt', era: 1, size: [3, 3], cost: { geld: 15, stein: 8 }, time: 8, workers: 0, upkeep: 0.1, clean: 4, prestige: 0.5, color: '#6a8aaa', desc: 'Sauberes Wasser: +Reinheit für die Umgebung.' },
  kapelle: { name: 'Kapelle', cat: 'stadt', era: 1, tech: 'schrift', size: [6, 8], cost: { geld: 80, werkstein: 15, bretter: 10 }, time: 36, workers: 1, upkeep: 0.6, knowledge: 1.5, happy: 0.05, prestige: 2, color: '#d0c8b0', desc: 'Kleine Kirche. Etwas Wissen und Zufriedenheit.' },
  schule: { name: 'Schule', cat: 'stadt', era: 2, tech: 'bildung', size: [7, 6], cost: { geld: 120, werkstein: 15, bretter: 15 }, time: 40, workers: 2, upkeep: 1.2, knowledge: 3, prestige: 1, color: '#c0a070', desc: 'Erzeugt Wissen für die Forschung.' },
  badehaus: { name: 'Badehaus', cat: 'stadt', era: 2, tech: 'stadtrecht', size: [7, 6], cost: { geld: 100, werkstein: 15, ziegel: 10 }, time: 30, workers: 2, upkeep: 1, clean: 10, happy: 0.05, prestige: 1, color: '#7aa0b0', desc: 'Starke Reinheit und Zufriedenheit.' },
  rathaus: { name: 'Rathaus', cat: 'stadt', era: 2, tech: 'stadtrecht', size: [10, 9], cost: { geld: 300, werkstein: 30, ziegel: 20, bretter: 20 }, time: 72, workers: 3, upkeep: 2, prestige: 6, tax: 0.1, provinces: 1, unique: true, color: '#b0804a', desc: '+10 % Steuern, +1 Provinzlimit, viel Prestige. Nur einmal baubar.' },
  bibliothek: { name: 'Bibliothek', cat: 'stadt', era: 3, tech: 'buchdruck', size: [9, 8], cost: { geld: 260, werkstein: 30, glas: 8 }, time: 60, workers: 3, upkeep: 2, knowledge: 7, prestige: 2, color: '#a07a5a', desc: 'Viel Wissen.' },
  dom: { name: 'Dom', cat: 'stadt', era: 3, tech: 'buergertum', size: [12, 16], cost: { geld: 800, werkstein: 80, glas: 20, ziegel: 30 }, time: 240, workers: 4, upkeep: 3, knowledge: 3, happy: 0.12, prestige: 15, unique: true, color: '#e0d8c0', desc: 'Prachtbau: viel Prestige und Zufriedenheit. Nur einmal baubar.' },
  universitaet: { name: 'Universität', cat: 'stadt', era: 4, tech: 'aufklaerung', size: [14, 11], cost: { geld: 900, werkstein: 60, glas: 30, moebel: 5 }, time: 160, workers: 6, upkeep: 5, knowledge: 16, prestige: 6, unique: true, color: '#8a6a4a', desc: 'Sehr viel Wissen.' },
  park: { name: 'Stadtpark', cat: 'stadt', era: 3, tech: 'buergertum', size: [12, 12], cost: { geld: 150, holz: 10 }, time: 24, workers: 1, upkeep: 0.8, clean: 6, happy: 0.06, prestige: 3, color: '#5a8a4a', desc: 'Grünfläche: Reinheit, Zufriedenheit, Prestige.' },

  // --- Wege (Sonderfälle)
  bruecke: { name: 'Brücke', cat: 'wege', era: 1, tech: 'brueckenbau', size: [8, 4], cost: { geld: 60, bretter: 15, stein: 15 }, time: 30, workers: 0, upkeep: 0.3, bridge: true, color: '#8a6a4a', desc: 'Auf einen Fluss setzen: Händler müssen keinen Umweg mehr laufen.' },
};

// Straße: wird gezogen, Kosten pro 10 Einheiten Länge
export const ROAD = { costPer10: { geld: 2, stein: 1 }, bonusDist: 9, prod: 0.04, prestigePer100: 0.6, cleanPer100: 0.8 };
export const BUILDING_IDS = Object.keys(BUILDINGS);

// ------------------------------------------------------------ Forschung
// cost: Wissenspunkte, era: Zeitalter, req: Voraussetzungen, effect: Boni
export const TECHS = {
  // Zeitalter 1
  ackerbau: { name: 'Ackerbau', era: 1, cost: 15, req: [], desc: 'Schaltet den Bauernhof frei.' },
  handwerk: { name: 'Handwerk', era: 1, cost: 20, req: [], desc: 'Schaltet Schreinerei und Steinmetz frei.' },
  viehzucht: { name: 'Viehzucht', era: 1, cost: 20, req: ['ackerbau'], desc: 'Schaltet Schäferei und Weberei frei.' },
  muehlenbau: { name: 'Mühlenbau', era: 1, cost: 30, req: ['ackerbau', 'handwerk'], desc: 'Schaltet Mühle und Bäckerei frei.' },
  schrift: { name: 'Schrift', era: 1, cost: 25, req: ['handwerk'], desc: 'Schaltet die Kapelle frei.' },
  brueckenbau: { name: 'Brückenbau', era: 1, cost: 25, req: ['handwerk'], desc: 'Schaltet Brücken frei.' },
  // Zeitalter 2
  stadtrecht: { name: 'Stadtrecht', era: 2, cost: 240, req: ['schrift', 'muehlenbau'], desc: 'Mehrfamilienhaus, Ziegelei, Badehaus, Rathaus.' },
  bergbau: { name: 'Bergbau', era: 2, cost: 240, req: ['handwerk'], desc: 'Bergwerk und Schmelzhütte.' },
  zuenfte: { name: 'Zünfte', era: 2, cost: 280, req: ['stadtrecht'], desc: 'Schneiderei. +5 % Produktion im Handwerk.', effect: { cat: 'handwerk', prod: 0.05 } },
  braukunst: { name: 'Braukunst', era: 2, cost: 220, req: ['muehlenbau'], desc: 'Brauerei.' },
  salzgewinnung: { name: 'Salzgewinnung', era: 2, cost: 200, req: ['handwerk'], desc: 'Salzsiederei.' },
  schmiedekunst: { name: 'Schmiedekunst', era: 2, cost: 320, req: ['bergbau'], desc: 'Schmiede.' },
  glasblaeserei: { name: 'Glasbläserei', era: 2, cost: 320, req: ['stadtrecht'], desc: 'Sandgrube und Glashütte.' },
  bildung: { name: 'Bildung', era: 2, cost: 280, req: ['stadtrecht'], desc: 'Schule.' },
  fuhrwesen: { name: 'Fuhrwesen', era: 2, cost: 300, req: ['stadtrecht'], desc: 'Fuhrhof (Karren) und später die Wagnerei.' },
  schiffbau: { name: 'Schiffbau', era: 2, cost: 360, req: ['brueckenbau', 'stadtrecht'], desc: 'Hafen: Boote für Fluss-, See- und Fernhandel.' },
  dreifelder: { name: 'Dreifelderwirtschaft', era: 2, cost: 360, req: ['stadtrecht'], desc: '+20 % Ertrag bei Bauernhöfen.', effect: { building: 'bauernhof', prod: 0.2 } },
  // Zeitalter 3
  buergertum: { name: 'Bürgertum', era: 3, cost: 1920, req: ['zuenfte', 'bildung'], desc: 'Bürgerhaus, Stadtpark, Dom.' },
  manufaktur: { name: 'Manufakturwesen', era: 3, cost: 2160, req: ['zuenfte', 'schmiedekunst'], desc: 'Möbelmanufaktur.' },
  goldschmiedekunst: { name: 'Goldschmiedekunst', era: 3, cost: 2040, req: ['schmiedekunst'], desc: 'Goldschmiede.' },
  waffenhandwerk: { name: 'Waffenhandwerk', era: 3, cost: 2040, req: ['schmiedekunst'], desc: 'Waffenschmiede.' },
  buchdruck: { name: 'Buchdruck', era: 3, cost: 2400, req: ['bildung'], desc: 'Bibliothek.' },
  handelskompanie: { name: 'Handelskompanie', era: 3, cost: 2280, req: ['schiffbau'], desc: '−20 % Transportkosten, Fernhandel bringt bessere Preise.', effect: { transport: -0.2 } },
  // Zeitalter 4
  patriziat: { name: 'Patriziat', era: 4, cost: 8750, req: ['buergertum', 'goldschmiedekunst'], desc: 'Patrizierhaus.' },
  verlagswesen: { name: 'Verlagswesen', era: 4, cost: 9500, req: ['manufaktur'], desc: 'Textil- und Werkzeugmanufaktur.' },
  aufklaerung: { name: 'Aufklärung', era: 4, cost: 10000, req: ['buchdruck'], desc: 'Universität. +10 % Wissen.', effect: { knowledge: 0.1 } },
  kanalbau: { name: 'Kanal- und Straßenbau', era: 4, cost: 9000, req: ['handelskompanie'], desc: 'Straßen wirken doppelt so stark auf die Reisezeit.', effect: { road: 1 } },
  // Zeitalter 5
  dampfkraft: { name: 'Dampfkraft', era: 5, cost: 28000, req: ['verlagswesen', 'aufklaerung'], desc: 'Dampfsägewerk und Eisenwerk.' },
  fabriksystem: { name: 'Fabriksystem', era: 5, cost: 32000, req: ['dampfkraft'], desc: 'Möbelfabrik. +10 % Produktion in Manufakturen.', effect: { cat: 'manufaktur', prod: 0.1 } },
};
export const TECH_IDS = Object.keys(TECHS);
// Ein Zeitalter beginnt, sobald 4 Techniken des vorherigen erforscht sind
export const ERA_THRESHOLD = 4;

// ------------------------------------------------------------ Transport
export const TRANSPORT = {
  fuss: { name: 'Händler zu Fuß', cap: 10, goods: 1, speed: 1, costPerUnitHour: 0.05, icon: '🚶' },
  karren: { name: 'Karren', cap: 40, goods: 3, speed: 1.15, costPerUnitHour: 0.02, icon: '🛒' },
  boot: { name: 'Boot', cap: 150, goods: 4, speed: 1, costPerUnitHour: 0.008, icon: '⛵' },
};
// Stunden pro Kachel zu Fuß (1 Kachel ≈ 1 km)
export const MOVE_COST = { 1: 0.25, 2: 0.4, 3: 0.45, 4: 0.65, 5: 0.4, 7: 0.6 };
export const RIVER_CROSS = 2.5;   // Stunden für eine Flussquerung ohne Furt/Brücke (Fähre)
export const FORD_CROSS = 0.3;
export const BOAT_HOURS = 0.12;   // Stunden pro Wasserkachel

// ------------------------------------------------------------ Fernhandelsstädte (außerhalb der Karte)
export const FOREIGN = [
  { id: 'f1', name: 'Velmora', hours: 60, cheap: ['wolle', 'stoff', 'salz', 'fisch'], dear: ['werkzeug', 'glas', 'moebel'] },
  { id: 'f2', name: 'Port Askel', hours: 80, cheap: ['eisen', 'kohle', 'eisenerz', 'holz'], dear: ['schmuck', 'bier', 'kleidung'] },
  { id: 'f3', name: 'Sarinth', hours: 110, cheap: ['edelsteine', 'golderz', 'glas'], dear: ['waffen', 'wagen', 'brot', 'werkstein'] },
];

// ------------------------------------------------------------ Start
export const START = { geld: 500, holz: 80, stein: 40, beeren: 40, fisch: 10 };
export const DIFFICULTY = {
  leicht: { name: 'Leicht', ai: 0.8, player: 1.2 },
  normal: { name: 'Normal', ai: 1.0, player: 1.0 },
  schwer: { name: 'Schwer', ai: 1.25, player: 0.85 },
};
export const CITY_COLORS = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#7d3c98', '#117a65', '#a04000', '#2e4053', '#922b21', '#1a5276', '#7e5109', '#6c3483', '#0e6655', '#873600', '#5b2c6f', '#145a32', '#78281f', '#154360', '#4d5656', '#6e2c00', '#b03a2e'];
export const START_YEAR = 1450;
export const END_YEAR = 1500;
