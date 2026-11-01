/**
 * Death record (DESIGN.md Appendix B, T06A).
 *
 * Written at every death from the MVP onward. Heirloom restoration always reads
 * `genes[]` from the owner's own latest record — a bought or traded heirloom
 * seed is a blank vessel and never imports another player's build.
 */
export interface DeathRecord {
  plant_id: string;
  parent_seed_id: string | null;
  genes: string[];
  season: number;
  owner_id: string;
}
