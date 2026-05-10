// Catalog of WTC-eligible 40k factions for V1. The id is what the engine
// receives as ArmyId; logoPath is served by Vite from /public.

export type FactionId = string;

export interface Faction {
  readonly id: FactionId;
  readonly displayName: string;
  readonly logoPath: string;
}

// Sorted alphabetically by displayName. Logo files live in /public/logos/
// with the original whitespace/punctuation; the browser handles URL
// encoding. Slug ids are stable and survive renames or display tweaks.
export const FACTIONS: readonly Faction[] = [
  { id: 'adeptus-custodes',    displayName: 'Adeptus Custodes',    logoPath: '/logos/Adeptus Custodes.png' },
  { id: 'adeptus-mechanicus',  displayName: 'Adeptus Mechanicus',  logoPath: '/logos/Adeptus Mechanicus.png' },
  { id: 'asuryani',            displayName: 'Asuryani',            logoPath: '/logos/Asuryani.png' },
  { id: 'chaos-daemons',       displayName: 'Chaos Daemons',       logoPath: '/logos/Chaos Daemons.png' },
  { id: 'chaos-knights',       displayName: 'Chaos Knights',       logoPath: '/logos/Chaos Knights.png' },
  { id: 'chaos-space-marines', displayName: 'Chaos Space Marines', logoPath: '/logos/Chaos Space Marines.png' },
  { id: 'death-guard',         displayName: 'Death Guard',         logoPath: '/logos/Death Guard.png' },
  { id: 'drukhari',            displayName: 'Drukhari',            logoPath: '/logos/Drukhari.png' },
  { id: 'emperors-children',   displayName: "Emperor's Children",  logoPath: "/logos/Emperor's Children.png" },
  { id: 'genestealer-cults',   displayName: 'Genestealer Cults',   logoPath: '/logos/Genestealer Cults.png' },
  { id: 'grey-knights',        displayName: 'Grey Knights',        logoPath: '/logos/Grey Knights.png' },
  { id: 'imperial-agents',     displayName: 'Imperial Agents',     logoPath: '/logos/Imperial Agents.png' },
  { id: 'imperial-guard',      displayName: 'Imperial Guard',      logoPath: '/logos/Imperial Guard.png' },
  { id: 'imperial-knights',    displayName: 'Imperial Knights',    logoPath: '/logos/Imperial Knights.png' },
  { id: 'leagues-of-votann',   displayName: 'Leagues of Votann',   logoPath: '/logos/Leagues of Votann.png' },
  { id: 'necrons',             displayName: 'Necrons',             logoPath: '/logos/Necrons.png' },
  { id: 'orks',                displayName: 'Orks',                logoPath: '/logos/Orks.png' },
  { id: 'sisters-of-battle',   displayName: 'Sisters of Battle',   logoPath: '/logos/Sisters of Battle.png' },
  { id: 'space-marines',       displayName: 'Space Marines',       logoPath: '/logos/Space Marines.png' },
  { id: 'tau-empire',          displayName: "T'au Empire",         logoPath: "/logos/T'au Empire.png" },
  { id: 'thousand-sons',       displayName: 'Thousand Sons',       logoPath: '/logos/Thousand Sons.png' },
  { id: 'tyranids',            displayName: 'Tyranids',            logoPath: '/logos/Tyranids.png' },
  { id: 'world-eaters',        displayName: 'World Eaters',        logoPath: '/logos/World Eaters.png' },
];

const FACTION_BY_ID: Map<FactionId, Faction> = new Map(FACTIONS.map(f => [f.id, f]));

export function findFaction(id: FactionId): Faction | undefined {
  return FACTION_BY_ID.get(id);
}
