# Plant Legacy — Master Build Plan v5.3.1
## Merged, Standalone, Error-Corrected

**Revision note (v5.3.1).** v5.3.1 is v5.3 with the thirteen reviewed corrections applied: the checkpoint table is rebuilt so no gap exceeds four weeks; Gate 3 gets an explicit playtest week and corrected arithmetic; the T25/T26 and T14/T43 cut-list conflicts are resolved; the Root Sight shader is owned by T02 and merely reused by C03; H01 is decoupled from the real-money switch; every stale `A…` cross-reference is replaced with a real section or task reference; T15 no longer contradicts T51; the vocabulary rows for heirloom seeds and gene items match the built systems; the dependency matrix is completed (`C03`, `C05`, `C02b`, `T14`, `T20`, `T43`, `H01`); the duplicated Part 8.2 heading and its merge artifact are removed; RULE_16's checkpoint weeks match the checkpoint table (W67, not W65); and heirloom-seed planting is separated from T53 offspring seeds. Nothing else changes; where v5.3.1 and v5.3 conflict, **v5.3.1 wins**.

**Core thesis unchanged.** Build systems, not outcomes. Build possibilities, not features. Build the sandbox; the players build the castles.

---

# Part 1 — What This Game Is

## 1.1 The Core
You are a plant. Not a character controlling a plant — you are the organism. You begin as a seed on a persistent planet. You germinate. You split attention between roots underground seeking water and minerals, and canopy above seeking light and space. You grow, mutate, compete, ally, betray, die, and feed the soil another plant grows from. The planet remembers.

This is not a game about growing the biggest plant. It is about being a particular plant in a world larger and older than you, full of other players who want what you want.

## 1.2 The Two Worlds
**Multiplayer** is a shared planet. Ten thousand players per World is a design target, not an MVP acceptance test. One season defaults to thirty-six real days, tunable. Your plant persists across sessions. Logging out is not safety: the world simulates offline and you can die while offline.

**Death and inheritance.** When your plant dies, you have three paths:
1. New seed, no inherited mutations.
2. Heirloom seed, genes from inventory: spend one heirloom seed and the gene items matching your previous plant's mutation set. You start as a descendant carrying that full set.
3. Heirloom seed, genes retrieved with Spores: for each gene not in inventory, pay Spores to retrieve it. Cost scales with number of genes retrieved. Paths 2 and 3 can be mixed per gene.

**Inheritance honesty rules.**
- The heirloom seed is a **blank vessel**. It carries no mutations. The mutation set restored always comes from the owner's own latest death record (`genes[]`). A bought or traded seed never imports someone else's build.
- Gene items are inheritance tokens keyed by mutation ID. They can only restore mutations present in the owner's latest death record. A gene bought on the marketplace cannot add a mutation you never carried.
- Path 3 retrieves the immediate previous life only. Bloodline tracing is v2.

Heirloom is a descendant, not a continuation. The old plant is dead. The descendant is a new plant carrying the inherited mutation set, ancestor's name, and compressed edit history. Account, prestige, achievements, guild affiliation, reputation, and mail persist. The specific plant does not.

**Campaign** is a separate planet: story-driven, solo or small co-op, with NPCs. It is post-MVP and funded by multiplayer.

## 1.3 The 30-Second Loop
You are a plant with a body you built. You read local light, moisture, minerals, weather forecast, nearby roots, nearby players. You decide: grow a node, prune, apply a timed booster, root toward a resource, parasitize, press a rival's roots, shed a mutation, or spend biomass on defense. The world pushes back: weather, roots, herbivores, scarcity, players. Your shape changes. Nearby players can see something happened. You read the new state and decide again.

Gate 1 contains the full read-decide-grow-compete-be-damaged loop. Parasitism, boosters, and mutation-gene minting arrive at Gate 2.

## 1.4 Central Design Belief
The game's soul is in what players do to each other using the systems provided. A game is a space of possibilities. Make it deep enough that ten thousand people can live in it for years without running out of discovery. The AI builds the space; players decide what happens inside.

## 1.5 Humor
The best comedy will not be written. A physics system doing its job, and players reacting, is not a gag. The game never announces "this is funny." It allows ridiculous things and trusts players to notice. Same for cruelty, kindness, legend, and history.

---

# Part 2 — Non-Negotiable Rules for Every AI Session

Feed this section before any system spec. These override everything else.

```text
RULE_1: Player IS the plant. Never "character controls a plant."

RULE_2: Multiplayer has no intelligent NPCs. Players are the only minds
        in the shared world. Campaign may have NPCs, but they belong to
        a separate space. Companions (T11) are tamed wild beasts: no
        speech, no quests, not intelligent agents. Scripted herbivore
        events (T06) are ambient events, not persistent agents. If a
        proposed entity can converse or pursue goals, it belongs to the
        campaign.

RULE_3: No hardcoded values. Every tunable lives in config/*.json with
        a range and a default. Config supports arrays, schemas, enums,
        colors, matrices, and item definitions.

RULE_4: Server is authoritative for all state that affects other
        players: growth, mutation, economy, combat, movement, death,
        inventory, gene items, boosters, heirlooms, profiles, guilds,
        reputation, mail, achievements, prestige, and all item/gene
        mutations.

RULE_5: Every named thing carries an edit and ownership history.
        Entries may be erased. Erasure removes content but leaves a
        public tombstone (who erased it, when). Nothing is silently
        deleted.

RULE_6: No general moderation of player-authored content in multiplayer.
        Exception: a five-line illegal-content-only policy required to
        keep payment rails and hosting alive. It covers only CSAM,
        credible threats, doxxing, and illegal material, across chat,
        profiles, trade listings, DMs, guild names and mottos, mail, and
        reviews. Offensive, weird, political, and toxic content remains
        unmoderated. This is a compliance floor, not censorship.

RULE_7: BUILD SYSTEMS, NOT OUTCOMES. Do not create specific emergent
        forms. Build general capabilities. If a proposed feature has a
        proper noun or marketable name, reject it and build the general
        capability instead. Never build a named culture tool.

RULE_8: The planet is one continuous world across seasons. Between
        seasons, deep time passes and the same planet transforms. It is
        never regenerated from scratch.

RULE_9: Everything should produce social possibility. If a system could
        not, in principle, produce a moment someone tells their friend
        about, reconsider it.

RULE_10: Underdog paths always exist. Any power gap must be surmountable
         by skill, patience, creativity, or alliance, not only money.

RULE_11: The world simulates offline. Logging out is not a pause button.

RULE_12: Free-speech-absolutist design. No general moderation, subject
         only to RULE_6's infrastructure-compliance exception.

RULE_13: The MULTIPLAYER game does not explain its own depth. Players
         discover it. MVP ships minimal onboarding only: a 3-line first-
         spawn hint card and contextual tooltips on the resource readout
         (T00A). This does not explain depth, strategy, or emergent
         outcomes.

RULE_14 (amended [V5.3]): Build for 50-100 detailed plants; design for
         10k per World. One World is one server process plus one
         Postgres. Running many Worlds is allowed and is the scaling
         path to very large player counts. A World process may use
         internal worker threads for encoding or offline simulation only
         if profiling shows a need (needs approval); no Redis, no
         external queue, no microservices by default.

RULE_15: Data files first, code second, for boosters, genes, and all
         content. Schemas land before implementation.

RULE_16 (amended [V5.3], needs approval): Gates stay fixed once set,
         but the dates are re-baselined to weeks 24 / 52 / 80 because
         v5.2's arithmetic left out all client work, accounts, hosting
         and UI. Weeks 13, 36 and 67 become checkpoints (see Part 4).
         If you prefer to keep 13/26/52, use the Compressed Plan in
         Part 4 section B6 and accept the larger cuts listed there.

RULE_17: All item and gene mutations are server-authoritative
         transactions. Never client-side decrement. Row-level locking
         in Postgres. In-memory inventories are forbidden.

RULE_18: No in-game livestream integration. Opt-in spectating only.
         The camera is an independent entity from day one.

RULE_19: Companions are tamed wild beasts, not intelligent NPCs. They
         have needs, loyalty, and directives, but do not converse,
         pursue story goals, or exercise judgment.

RULE_20: The game does not surface item or gene rarity. Any schema field
         named "rarity" is a bug.

RULE_21: Booster grades are POTENCY GRADES, not rarity. A grade is
         deterministic: it comes from a known earn source or crafting.
         No grade is a random drop tier. Inferior and common are
         purchasable and tradeable. Standard and above are account-bound
         and earn-only.

RULE_22: Every unit of damage passes through one damage pipeline with
         four source types: weather, roots, tools (v2), herbivores. No
         system may apply damage outside it.

RULE_23: Item behavior is expressed only by four explicit flags:
         tradeable, mailable, listable, account_bound. account_bound=true
         forces the other three to false. Prose such as "non-tradeable"
         must be backed by these flags. Every system that moves items
         (T14, T45, T08A gift bundles, T29) validates flags server-side.

RULE_24 (amended [V5.3]): Every task spec lists its dependencies. A
         task may not be built before everything it depends on. If a
         dependency is intentionally stubbed, the stub interface is
         named in the spec. [V5.3] reordering removes two stubs (T16
         before T15; T07 before T06).

RULE_25: PLATFORM ORDER. Browser first, then desktop app, then mobile
         app. One shared client codebase. Desktop and mobile apps are
         thin wrappers. Mobile browsers must work but are not optimized
         for. The game is 3D only.

RULE_26: PERFORMANCE FIRST. Target 60 fps on target devices, low battery
         drain, and no visible lag from other players or offline
         simulation. The client renders at most the configured number of
         detailed plants; everything else uses lower detail levels.
         Quality scales automatically; the player never has to fix a
         slow game by hand.

RULE_27: CLIENT RENDERING IS NEVER AUTHORITATIVE. Meshes, animation,
         camera, and effects are derived from server state. If the client
         and server disagree, the server wins and the client corrects
         without drama. IK and procedural animation are cosmetic unless a
         server system explicitly owns the result.

RULE_28: WHOLE-NUMBER SCHEDULING. All estimates are integer weeks. Every
         schedule includes explicit playtest and buffer weeks. Visible
         checkpoints occur at least every 4 weeks so progress is always
         demonstrable.

RULE_29: REPORTING IS UNIVERSAL. Every player-authored surface has a
         report control and a block control. Reports store the context
         needed to judge them. Only RULE_6 categories are acted on.

RULE_30: PROVENANCE. Every gene item and fragment records where it came
         from (source plant, source owner, how it was obtained) in its
         ledger. A gene or fragment is created by exactly one transaction
         and consumed by exactly one transaction. No duplication paths.

RULE_31: FREE-FIRST OPS. Choose free hosting and free assets first, and
         keep everything portable (containers, plain Postgres, standard
         formats) so a free tier changing its terms never traps the
         project.
```

---

# Part 3 — Vocabulary

| Term | Meaning |
|---|---|
| World | One persistent multiplayer planet instance (~10,000 players design target; 50-player playtest uses lower config). One World process plus one Postgres. |
| Plant | A player-controlled organism. The only mind in a World. |
| Seed | Starting form. Spawn, germinate, grow. |
| Node | One unit of plant body. Node types: root, stem, leaf, flower, spore_sac, vine. Only leaf nodes photosynthesize. All canopy nodes cast shade. |
| Root layer | Underground: water, minerals, anchoring, detection, tunneling. |
| Canopy layer | Aboveground: stem, leaves, vines, flowers, spore sacs, height. |
| Root Sight | Toggleable view mode revealing underground geometry. A camera system, not a plant power. Camera moves and zooms; a rooted plant does not move. |
| Biomass | Primary growth currency. Gained from photosynthesis and consumption. Spent on growth and upkeep. |
| Light / Moisture / Minerals | Per-tile values 0–100 supplied by T00A. |
| Photosynthesis | Conversion of light, moisture, minerals into biomass by leaf nodes at config rate. |
| Mutation | Persistent biological change. No cap; every mutation has maintenance cost. |
| Archetype | Starting template. Base stats and biases. Not a class. |
| Symbiosis | Declared root-link sharing resources. Post-MVP. |
| Parasitism | Attaching to another plant to drain resources. MVP at Gate 2. |
| Companion | Tamed wild beast. Not intelligent NPC. Post-MVP. |
| Spore | Currency. Earned by play, purchasable with real money. No artificial earn cap. Consumed in-game currency, not stored value. |
| Spore sac | Canopy organ renamed to avoid collision with currency. |
| Dung | World item dropped by herbivore events and plant death. Two uses: consume for Spores, or apply to soil for minerals. |
| Fertilizer | Spore-sink item. Deposits minerals and/or boosts growth briefly. |
| Gene stabilization | Spore-sink item. Temporarily reduces mutation maintenance cost. |
| Essence | Earn-only, account-bound crafting material. Required to craft standard-grade boosters. Never purchasable. |
| Marketplace | UI panel for listing and buying items. UI-only; physical markets are player-run and emergent. |
| Ledger | Edit and ownership history attached to any named thing. |
| Tombstone | Public record left when a ledger entry is erased: who erased it and when. |
| Season | Tunable default of thirty-six real days. |
| Season-end calamity | Inter-season deep-time transformation (T20). Every plant dies in it. Only lineage carries over through a queued heirloom seed. |
| Season Relic | Tradeable stylized model of planet at season end. Post-MVP. |
| Deep time | Millions of years between seasons. |
| Heirloom seed | Blank-vessel inventory item. Produced by seed production from a mature flower (T06A) or a mid-season death grant (T06A). Spending it starts a descendant whose mutation set comes from the owner's latest death record. Tradeable and mailable per flags. |
| Gene item | Inventory item keyed by mutation ID. Minted on mutation acquisition (T15) and by gene extraction (T51). Used to restore the owner's previous plant set or graft onto a living plant. No rarity field. |
| Bloodline tracing | Retrieval of genes from any ancestor plus gene dropping. v2. |
| Booster | Consumable affecting growth speed, mutation chance, or healing. Graded by potency, typed, conditional. |
| Potency grade | Booster tier: inferior → common → standard → refined → greater → superior → mythical → legendary → planetary. Deterministic, not rarity. MVP uses first three. |
| Account-bound | Flag meaning item cannot be traded, mailed, listed, or attached. |
| Starter Pack | Newbie pack granted on account creation. System-grant only, account-bound. The only newbie-grant item. |
| Gift Bundle | Player-assembled container of tradeable items. Tradeable, mailable, listable. Contents may not include account-bound items. |
| Inventory | Server-authoritative container for items, boosters, genes, heirloom seeds, bundles, packs, mail attachments, and spore_balance. |
| Tumbling state | rooted → uprooted → tumbling → re-rooting → rooted. |
| Damage pipeline | One pipeline for weather, roots, tools, herbivores. |
| Event bus | Small in-process server publish/subscribe for named game events. Defined in T03. |
| Prestige | Integer counter on account, incremented by configured events. No mechanical power. |
| Achievements | Config-defined milestone IDs with triggers and display names. No mechanical power. |
| Kill | Death where one player source dealt most damage within last kill_credit_window seconds. Weather/herbivore deaths credit no one. |
| Exploration | First visit by an account to a world chunk in a season; yields Spores once per chunk per season. |
| Reputation | 1–5 star rating plus optional review. Not a hidden score. |
| Status/Rank | Visible standing derived from reputation, age, guild role, achievements. Not a power stat. |
| Guild | Player-formed organization; voluntary; no mechanical buffs. |
| Mail | In-game inbox for system messages, player messages, attachments. |
| Profile | Player-authored UGC surface. Post-MVP, architected early. |
| Territory | Claimed region with upkeep. Post-MVP. |
| Globe minimap | Server-aggregated low-frequency planet map. Post-MVP, architected early. |
| Session | Activity block ending after configured duration with end screen. Plant persists. |
| Spectating | Opt-in read-only camera on another player. Post-MVP; camera architected now. |
| Gate | Fixed calendar checkpoint. |
| **[V5.3]** Client | The 3D web app (Three.js). Also what the desktop and mobile wrappers run. |
| **[V5.3]** World process | One server process owning one World. |
| **[V5.3]** Active / Near / Dormant set | Simulation tiers for plants (see Part 13.6). |
| **[V5.3]** Interest area | The set of world cells a client receives updates for. |
| **[V5.3]** Detail level (LOD) | How much geometry/animation a plant gets on a given client: L0 detailed, L1 simplified, L2 impostor, L3 dot/minimap. |
| **[V5.3]** Quality tier | Client graphics preset chosen automatically: Low, Medium, High. |
| **[V5.3]** Fragment | Inventory/world item holding a piece of a plant (branch, leaf, root piece, flower). Records source plant, owner and gene snapshot. |
| **[V5.3]** Remains | The set of fragments left by a dead plant. |
| **[V5.3]** Gene extraction | Turning a fragment (or your own plant) into one gene item. |
| **[V5.3]** Graft | Consuming a gene item to try to acquire that mutation on your living plant. |
| **[V5.3]** Seed production | Converting a mature flower node into one heirloom seed. |
| **[V5.3]** Offspring seed | Beta item produced by cross-pollination; carries a mix of parent genes (T53). |
| **[V5.3]** Report | A player submission about a message, player, listing or other player-authored content, with reason and extra text. |
| **[V5.3]** Checkpoint | A visible, demonstrable progress milestone (not a gate). |

---

# Part 4 — Build Order and Gates **[V5.3]**
*Replaces v5.2 Part 4 (4.1, 4.2, 4.5), Part 7.1 ordering, Appendix D and Appendix G.*

## B1. Planning Assumptions (read first)
- **One week = about 20–30 focused hours from you.** AI writes most of the code; you test, integrate, and make decisions. If you have fewer hours, scale the weeks proportionally and tell me so I can re-run the plan.
- **All numbers are whole weeks** (RULE_28). Each gate has a playtest week and a buffer week.
- **Why the weeks grew compared with v5.2:** v5.2's arithmetic counted server systems only. This plan also counts the browser client, procedural plant renderer, accounts, HUD, menus, audio, hosting, and app packaging, which together add roughly as much work as the original Gate 1 itself.
- **Order rule:** a task starts only when everything in its "Depends on" column is finished. If a dependency slips, the task waits; do not skip ahead (RULE_24).
- **Task size rule (D-20):** one task = one AI session set (several sessions if it spans two or three weeks). Never merge two tasks into one prompt.

## B2. The Exact Build Order

Task IDs: **T** = game system from v5.2, **C** = client task, **O** = operations task, **H** = hardening task. Weeks are inclusive.

### Phase 0 — Foundation (Gate 1 run-up)
| # | Task | Weeks | Depends on | Notes |
|---|---|---|---|---|
| 1 | **T00 + O01** Foundation, repo, config, CI, deploy skeleton | W1 | none | Includes every config file, rarity validator, `CONTEXT.md`, hosting skeleton. |
| 2 | **T03P** Networking gate (Gate 0) | W2 | T00 | Two tabs, server-authoritative cubes. Decides protocol (Part 13.8). **Checkpoint 1.** |

### Phase 1 — The Living Sprout (Gate 1, week 24)
| # | Task | Weeks | Depends on | Notes |
|---|---|---|---|---|
| 3 | **C01** Client foundation | W3–4 | T00, T03P | Renderer, camera rig, input layer, UI shell, asset pipeline, quality tiers. |
| 4 | **T00A** Resource model | W5 | T00 | Includes onboarding hint card and tooltips. **Checkpoint 2 (W5):** browser scene, orbit camera, resource readout. |
| 5 | **T01** Growth | W6–7 | T00A | Root competition, canopy shading, root attack. |
| 6 | **C02** Procedural plant renderer v1 | W8–9 | C01, T01 | **Checkpoint 3 (W9):** a plant grows and renders, light changes under canopy. |
| 7 | **T03** The multiplayer world | W10–11 | T03P, T01 | Persistence, offline tiers (Part 13.6), interest management, event bus. |
| 8 | **T08C** Accounts and sessions | W12 | T03 | Username + password. |
| 9 | **T02** Root Sight | W13 | T01, C01 | **Checkpoint 4 (W13):** log in, two browsers see each other's plants in a shared world, Root Sight works. |
| 10 | **T07** Weather and day/night | W14 | T00A, T03 | Thunderstorm active phase is the first cut if late. |
| 11 | **C03** Environment rendering | W15 | C01, T07, T00A | Sky, light grading, rain, storm, soil tint, cutaway shader. |
| 12 | **T05** Chat, emotes, report/block | W16 | T03, T08C | Proximity + world chat both included (D-12). **Checkpoint 5 (W16).** |
| 13 | **T04** Mutation | W17 | T00A, T01, T03 | Schema + at least 3 simple mutations. |
| 14 | **T06** Uproot, damage, tumbling | W18–19 | T01, T02, T03, T07 | Reroot crawl, root attack, kill credit, fragments and remains drops. **Checkpoint 6 (W19).** |
| 15 | **T08A** Inventory | W20 | T03, T08C | Item flags, bundles, `spore_balance`, duplication audit. |
| 16 | **C04** HUD and controls v1 | W21–22 | C01, T00A, T07, T08A, T05, T06 | Desktop-first. **Checkpoint 7 (W22):** the full loop is playable. |
| — | **Gate 1 playtest** (50 players) | W23 | all above | Real people, real notes. |
| — | **Buffer and fixes** | W24 | | **GATE 1 = end of W24.** |

### Phase 2–3 — Economy, Identity, History, Inheritance (Gate 2, week 52)
| # | Task | Weeks | Depends on | Notes |
|---|---|---|---|---|
| 17 | **T08** Session feedback | W25 | T03, T08A | Stipend to `spore_balance`. Moved from Gate 1. |
| 18 | **T08B** Account progress | W26 | T03, T04, T08A | Prestige, achievements. **Checkpoint 8 (W26):** session feedback and account progress. |
| 19 | **T16** The ledger | W27–28 | T03, T08A | **Built before T15** so no stub is needed. |
| 20 | **T17** Naming | W29 | T16 | |
| 21 | **T15** Genes | W30 | T04, T08A, T16 | **Checkpoint 9 (W30):** ledger, naming, gene items. |
| 22 | **T13** Currency | W31–32 | T08A, T08 | Store UI is a stub; real money later. |
| 23 | **T51** Gene extraction and graft | W33–34 | T15, T13, T06, T16, T08A | New (Part 5, T51). **Checkpoint 10 (W34).** |
| 24 | **T06A** Heirloom-at-death | W35–36 | T06, T08A, T15, T16, T13 | Includes seed production (Part 5, T06A). **Checkpoint 11 (W36).** |
| 25 | **T13A** Boosters MVP | W37–38 | T07, T08A, T13, T15 | Thunderstorm column. |
| 26 | **T14** Marketplace | W39–40 | T08A, T15, T13A, T06A | Stubs: `getSellerReputation`, `giftToGuild`. **Checkpoint 12 (W40).** |
| 27 | **T12** One archetype | W41 | T01, T04 | |
| 28 | **T10** Parasitism | W42 | T01, T06, T08B | First cut if Gate 2 slips. |
| 29 | **T20 partial** Season and deep time | W43–44 | T06A, T07, T16, T13A | Calamity, pre-build, time-lapse. **Checkpoint 13 (W44).** |
| 30 | **C05** Menus and screens | W45–47 | C01, C04, T08A, T16, T06A, T20, T08C, T12 | **Checkpoint 14 (W47).** Spawn, inventory, ledger viewer, death screen, season screen, settings, login. |
| 31 | **C02b** Renderer polish and LOD | W48–49 | C02, T03, T04 | IK moments, LOD L2/L3, 12 mutation signatures. |
| 32 | **O02** Migrations, backups, restore drill | W50 | O01, T03 | |
| — | **Gate 2 playtest** (shortened full season cycle) | W51 | all above | **Checkpoint 15 (W51).** |
| — | **Buffer and fixes** | W52 | | **GATE 2 = end of W52.** |

### Phase 4–6 — Social Economy, Growth, Launch (Gate 3, week 80)
| # | Task | Weeks | Depends on | Notes |
|---|---|---|---|---|
| 33 | **T43** Reputation | W53 | T08B, T16, T14 | |
| 34 | **T44** Guilds | W54 | T08B, T16, T43 | **Checkpoint 16 (W54).** |
| 35 | **T45** Mail and Gift Bundles | W55–56 | T08A, T43 | **Checkpoint 17 (W56).** |
| 36 | **T50** Starter Pack | W57 | T08A, T45 | |
| 37 | **T46** Status/rank | W58 | T08B, T43, T44 | **Checkpoint 18 (W58).** |
| 38 | **T23** Unbounded growth framework | W59 | T01 | |
| 39 | **T24** Mutation table expansion | W60 | T04 | |
| 40 | **T25** Terrain interaction | W61–62 | T01, T00A | **Checkpoint 19 (W61).** First cut if Gate 3 slips. |
| 41 | **T26** Consequence persistence | W63 | T16, T25 | **Checkpoint 20 (W63).** |
| 42 | **T40** Compliance, admin triage, legal pages | W64–65 | T00, T05, T17, T43, T44, T45 | Includes age gate, terms, privacy. |
| 43 | **T41** Anti-cheat | W66 | T03, T08A, T14, T45 | |
| 44 | **T42** Live ops | W67 | T40, T41 | **Checkpoint 21 (W67).** |
| 45 | **C06** Audio | W68 | C01 | |
| 46 | **C09** Touch controls and mobile layout | W69–70 | C04, C05 | **Checkpoint 22 (W70).** |
| 47 | **C07** Desktop and mobile apps | W71–73 | C01–C06, C09, T08C | Desktop first; mobile stores need paid developer accounts (see C07). **Checkpoint 23 (W73).** |
| 48 | **H01** Hardening, load, restore drill | W74–76 | all Gate 3 tasks except the real-money Spore switch | Bots from 50 → 500 → 2,000 clients. |
| 49 | **Real-money Spore switch** | W77 | T13, T40, T41, T42 | Cut and ship "coming soon" if late. **Checkpoint 24 (W77).** |
| — | **Gate 3 playtest** (public-alpha candidate) | W78 | all above except the real-money switch if cut | Explicit playtest week. **Checkpoint 25 (W78).** |
| — | **Buffer and public-alpha launch prep** | W79–80 | | **GATE 3 = end of W80 (public alpha).** |

**Check of the arithmetic.** Gate 1: 22 task-weeks + 1 playtest + 1 buffer = 24. Gate 2: 26 task-weeks + 1 + 1 = 28 (W25–52). Gate 3: 25 task-weeks + 1 playtest + 2 buffer = 28 (W53–80). Total 80 weeks. Task-weeks overall: 22 + 26 + 25 = 73. Gate 1's 22 task-weeks include the 2 weeks of Phase 0 (tasks 1–2).

## B3. Gates, Checkpoints, Cut Lists

### B3.1 Gates (fixed once approved, RULE_16)
- **Gate 0 (end W2):** two-tab server-authoritative cubes; server rejects teleport, speed, out-of-bounds; protocol note; manual checklist. Cut: nothing.
- **Gate 1 (end W24):** 50-player core-loop playtest. The core loop is: read resources, grow, compete, be damaged, be seen, talk.
- **Gate 2 (end W52):** vertical slice with economy floor, history, inheritance, and one shortened season cycle.
- **Gate 3 (end W80):** public alpha; explicit playtest at W78; W79–80 buffer and launch prep.

### B3.2 Checkpoints (demonstrable progress at least every 4 weeks, RULE_28)
| CP | Week | You can show |
|---|---|---|
| 1 | W2 | Two cubes, one server, invalid moves rejected |
| 2 | W5 | 3D scene in a browser, orbit camera, light/moisture/minerals readout |
| 3 | W9 | A plant grows server-side and renders procedurally; canopy shades the ground |
| 4 | W13 | Log in, two browsers see each other's plants, Root Sight works *(the original "week 13" milestone)* |
| 5 | W16 | Day/night, rain, chat, reporting |
| 6 | W19 | Mutations, uproot, tumble, reroot crawl, root attack damage |
| 7 | W22 | Complete playable HUD and controls |
| 8 | W26 | Session feedback and account progress (prestige/achievements) |
| 9 | W30 | Ledger, naming, gene items |
| 10 | W34 | Currency, gene extraction from fragments |
| 11 | W36 | Death, heirloom seed, descendant carrying genes |
| 12 | W40 | Boosters and marketplace |
| 13 | W44 | A season ends, calamity, time-lapse, next season |
| 14 | W47 | Menus and screens for spawn, inventory, ledger, death, season, settings, login |
| 15 | W51 | Gate 2 playtest on a shortened full season cycle |
| 16 | W54 | Reputation and guilds |
| 17 | W56 | Mail and Gift Bundles |
| 18 | W58 | Starter Pack, status/rank, and social standing display |
| 19 | W61 | Terrain interaction core: root tunneling/voids and canopy light-blocking persistence |
| 20 | W63 | Consequence persistence |
| 21 | W67 | Compliance, anti-cheat, live ops |
| 22 | W70 | Touch controls and mobile layout |
| 23 | W73 | Desktop (and mobile) app builds |
| 24 | W77 | Real-money purchase flow |
| 25 | W78 | Gate 3 playtest / public-alpha candidate |

### B3.3 Cut lists (pre-decided; cut features, never gates)
**Gate 1** — Must have: T00+O01, T03P, C01, T00A, T01, C02, T03, T08C, T02, T05 (proximity **and** world chat, plus report/block), T07 day/night, C03, T06, T08A, C04. Cut in this order: (1) T05 emotes (chat stays); (2) T07 thunderstorm active phase; (3) T04 down to schema + 3 mutations; (4) T02 transition polish; (5) C03 weather visuals down to simple particles. **Never cut:** T00A, T01, C02, T02, T03, T08C, T05 chat, T06, T07 day/night, T08A.

**Gate 2** — Must have: all of Gate 1 plus T08, T08B, T16, T17, T15, T13, T51 extraction, T06A, T13A, T12, T20 calamity and pre-build, C05, O02. Cut in this order: (1) T10 parasitism; (2) T14 marketplace UI/auction/preview, but keep the T14 seller/listing data model and the named `getSellerReputation` stub; if T14 UI is cut, schedule the T14 data model + stub at Gate 3 before T43; (3) T13A condition matrix (keep boosters with conditions constant 1.0); (4) T51 graft (keep extraction); (5) T20 time-lapse polish; (6) C02b polish beyond L2. **Never cut:** T16, T06A, T20 calamity, T13, T15, T08B, O02.

**Gate 3** — Must have: all of Gate 2 plus T43, T44, T45, T50, T46, T23, T26, T40, T41, T42, C06, H01. Cut in this order: (1) optional T25 capabilities only; keep the T25 core stub (root tunneling/voids and canopy light-blocking persistence) required by T26; (2) T24; (3) T46; (4) T44 guild-reputation integration; (5) C07 mobile app (ship desktop and PWA); (6) real-money switch ("coming soon"). **Never cut:** T40 before any real-money or public exposure, T41, T42, T23, T26, H01, T16-dependent tombstone behavior.

## B4. New Task Specs

Every task returns: implementation, config file(s), README of tunables (type/range/default/effect), manual test checklist, `CONTEXT.md` update, and `ATTRIBUTION.md` update if any asset was added. No hardcoded values (RULE_3). No `rarity` fields (RULE_20).

### O01 · Repo and Deploy Pipeline — `config/ops.json`
**Depends on:** T00 (built in the same week).
**Must support.** pnpm monorepo (apps/client, apps/server, packages/shared); TypeScript strict; lint/format; unit-test runner; config validator in CI (schema + rarity ban); Dockerfile for the server; docker-compose for local server + Postgres; static client deploy to a free host; staging URL; environment separation; secrets only through environment variables (the secrets file is never committed or shown to AI); `/health` endpoint.
**Acceptance.** Fresh clone runs with one command. Push triggers CI; green CI deploys staging. Server reaches Postgres. `/health` returns OK.
**Config.** Environments, ports, health thresholds.
**AI prompt.** "Build O01: pnpm TypeScript monorepo, CI with config validator and rarity ban, Dockerfile and compose for server + Postgres, free static client deploy, staging URL, health endpoint. Return repo tree, CI file, README. No game logic."

### C01 · Client Foundation — `config/render.json`, `config/controls.json`, `config/ui.json`
**Depends on:** T00, T03P.
**Must support.** Vite + TypeScript + Three.js shell; fixed-step update with interpolated render; **CameraRig** with orbit controller (independent entity); **input abstraction** (named actions, producers for keyboard/mouse/touch, bindings loaded from `controls.json`); **UI shell** (DOM overlay with layers: HUD, menus, modals, toasts; global text-scale CSS variable; theme tokens from Part 19); asset pipeline (glTF, compressed textures, audio loaders, license manifest check); quality-tier detection and dynamic resolution scaling; debug overlay (fps, triangles, draw calls, memory, network KB/s); object pools; pause on hidden tab; friendly disconnect/error screens; platform adapter interface (web, Electron, Capacitor).
**Acceptance.** Empty scene holds 60 fps on target devices. Camera orbits/zooms/pans. Rebinding a key changes behavior. Text scale changes every UI element. Debug overlay shows live metrics. A test confirms no per-frame allocations in the render loop.
**Config.** Quality tiers, resolution floor, fps targets, idle-drop timeout, camera smoothing, default bindings, text scale range 80–150%.
**AI prompt.** "Build C01 client foundation with the listed systems. Strict no-allocation render loop. Input is action-based and driven by controls.json. All values in config."

### T08C · Accounts and Sessions — `config/accounts.json`
**Depends on:** T03.
**Must support.** Sign-up, login, logout; argon2id password hashing; access + refresh tokens; secure storage by platform; rate limits and lockout; display-name changes writing ledger entries once T16 exists (until then an internal log); account roles (player, admin); global `account_id`; `world_id` on all gameplay rows; clear message that there is no password reset until email recovery ships.
**Acceptance.** Create account, log in on two devices, log out one, sessions expire and refresh correctly, brute-force attempts are limited, admin role cannot be created through public sign-up.
**Config.** Token lifetimes, rate limits, password rules, username rules (length, characters).
**AI prompt.** "Build T08C accounts per spec. No email at this stage. Hash with argon2id. Add rate limits and lockout. Admin role created only by CLI/seed script."

### C02 · Procedural Plant Renderer v1 — `config/plant_renderer.json`
**Depends on:** C01, T01.
**Must support.** Part 14.1: Raymarched Signed Distance Fields (SDF) with smooth minimum (`smin`) organism fusion inside local bounding volumes. Fuses modular mathematical primitives (tapered capsule segments for roots/stems/vines, joint spheres, root crown) into one continuous, seamless living organism without floating parts or flat clipping seams. Shared plant material with 3D triplanar noise, vertex wind sway, health tint, L0 and L1 levels, deterministic output from node data (all clients see identical geometry), three mutation visual flags mapped to shader parameters.
**Acceptance.** Plant visibly grows as a continuous, unified organism above and below ground. Branch junctions form smooth organic collars. Adding a node appends to the primitive buffer without rebuilding mesh topology. Fifty L0 plants meet the desktop budget. Two clients render the same plant identically.
**Config.** `config/plant_renderer.json` (blend radius `smin_blend_radius`, raymarch step parameters, leaf parameters, detail distances, quality presets).
**AI prompt.** "Build C02: Raymarched SDF organism renderer with smin primitive fusion, bounding volume evaluation, triplanar noise, wind sway, L0/L1 levels. Fuses primitive parts into one seamless living organism. All tunables in config/plant_renderer.json."

### C02b · Renderer Polish and LOD — `config/render.json`
**Depends on:** C02, T03, T04.
**Must support.** L2 impostors and L3 dots; IK for reroot crawl and tumbling (FABRIK/CCD on tagged root tips only); vine reaching; leaf sun-tracking; **twelve mutation visual signatures** matching the T04 table; wilt/damage visuals; culling; instancing batches; mobile tier tuning.
**Acceptance.** 100 plants on desktop and 40 on phone within budget; 1,000 plants in range handled by LOD without exceeding the bandwidth cap; IK never changes server state (RULE_27).
**AI prompt.** "Build C02b: L2/L3 levels, IK only for tagged moving nodes, mutation signature library, wilt effects, batching. Cosmetic only; server remains authoritative."

### C03 · Environment Rendering — `config/render.json`
**Depends on:** C01, T07, T00A.
**Must support.** Terrain mesh from the T00A grid; soil tint from moisture/minerals; sky, sun and moon arcs from `time_of_day`; light grading by time and weather; fog; rain particles; storm lightning flashes; telegraph/aftermath cues; the Root Sight cutaway shader owned by T02, reused/refined by C03 for general environment cutaways; C03 does not provide the shader used by T02.
**Acceptance.** Day/night is continuous. Clear, rain and storm are visually distinct. Telegraph is readable. Phone budget met.
**AI prompt.** "Build C03 environment rendering driven by T00A/T07 data. Cheap shaders. Phone budget respected. All values in render.json."

### C04 · HUD and Controls v1 — `config/ui.json`, `config/controls.json`
**Depends on:** C01, T00A, T07, T08A, T05, T06.
**Must support.** HUD layout from Part 18; context dock (actions appear only when valid); rebinding screen; text-size slider; resource tooltips; three-line hint card; chat panel with proximity/world tabs; report dialog; notifications; all values read from server data, never written by the client.
**Acceptance.** Every Gate 1 action is reachable with keyboard and mouse. Rebinds persist. Text scale 80–150% works. No editorial text appears anywhere (RULE_13).
**AI prompt.** "Build C04 HUD per Part 18 layout and rules. DOM overlay. Context-sensitive actions. Rebindable keys. Text scale. No editorializing."

### C05 · Menus and Screens — `config/ui.json`
**Depends on:** C01, C04, T08A, T16, T06A, T20, T08C, T12
**Must support.** Login/sign-up, spawn and archetype select, inventory, ledger viewer, death/heirloom path screen, season countdown and time-lapse viewer, settings, reconnect screen, and **empty shells** for marketplace (T14), mail (T45) and guild (T44).
**Acceptance.** Every screen is reachable, keyboard and mouse operable, text-scaled, and uses the shared tokens.

### C06 · Audio — `config/audio.json`
**Depends on:** C01.
**Must support.** Web Audio engine; ambient layers by time/weather/biome; cues for growth, damage, uproot, reroot; UI sounds; distance attenuation; volume sliders; mute when hidden; license manifest check; free assets only.
**Acceptance.** Layers cross-fade by time and weather; volumes persist; no audio plays on hidden tabs.

### C09 · Touch Controls and Mobile Layout — `config/controls.json`, `config/ui.json`
**Depends on:** C04, C05.
**Must support.** Part 17 mobile layout and gestures; context dock; PWA manifest for standalone mode; safe-area handling; portrait and landscape; tier tuning; real-device tests.
**Acceptance.** All Gate 1 actions are reachable by touch. Touch targets meet the minimum size. Verified on at least two real phones.

### C07 · Desktop and Mobile Apps
**Depends on:** C01–C06, C09, T08C.
**Must support.** Electron wrapper (Windows, macOS, Linux); Capacitor wrapper (iOS, Android); secure token storage; haptics; safe areas; auto-update plan for desktop; store checklist (age rating, privacy declarations).
**Cost note.** Distributing on iOS requires a paid Apple developer account, and Google Play requires a one-time fee (amounts as of my last knowledge: about $99/year and a one-time ~$25; confirm). This conflicts with "all free." Desktop builds can be distributed free, and the PWA covers phones until revenue exists.
**Acceptance.** Builds run and log in on each target platform; performance verified on real devices.

### O02 · Migrations, Backups, Restore Drill — `config/ops.json`
**Depends on:** O01, T03.
**Must support.** SQL migration tooling; scheduled `pg_dump` to free storage; a restore drill script; health checks; tick-budget dashboard (Part 13.6).
**Acceptance.** Restore to a clean database from yesterday's backup and the game starts. Migrations roll forward on staging without data loss.

### T51 · Gene Extraction and Graft — `config/fragments.json`, `config/extraction.json`
**Depends on:** T15, T13, T06, T16, T08A.
**Must support.** Part 5, T51: fragments (sources, pickup, decay, flags), extraction from fragment or own plant, provenance ledger entries, graft with chance/cooldown/limits, duplication audit, events.
**Acceptance.** One fragment yields exactly one gene. Concurrent extraction attempts on the same fragment cannot both succeed. Mint limits enforced. Graft applies T04 maintenance. Ledger shows provenance. No rarity field.
**Config.** Fragment lifetime, pickup radius, drop chances, extraction cost, self-extract mode/limits, graft chance/cooldown/limit, mint limit.
**AI prompt.** "Build T51 per Part 5, T51. Every transaction row-locked. One fragment, one gene. Provenance ledger entries. Duplication-audit test required."

### H01 · Hardening and Load
**Depends on:** every Gate 3 task except the real-money Spore switch.
**Must support.** Bot clients scaling 50 → 500 → 2,000; tick-budget verification under offline load; 24-hour soak for leaks; chaos disconnects; restore drill; basic security review (auth, rate limits, input validation).
**Acceptance.** Active-tier tick time stays under budget; no memory growth over 24 h; restore drill passes.

## B5. Dependency Matrix (replaces Appendix D)
| Task | Depends on |
|---|---|
| T00, O01 | none |
| T03P | T00 |
| C01 | T00, T03P |
| T00A | T00 |
| T01 | T00A |
| C02 | C01, T01 |
| T03 | T03P, T01 |
| T08C | T03 |
| T02 | T01, C01 |
| T07 | T00A, T03 |
| C03 | C01, T07, T00A |
| T05 | T03, T08C |
| T04 | T00A, T01, T03 |
| T06 | T01, T02, T03, T07 |
| T08A | T03, T08C |
| C04 | C01, T00A, T07, T08A, T05, T06 |
| T08 | T03, T08A |
| T08B | T03, T04, T08A |
| T16 | T03, T08A |
| T17 | T16 |
| T15 | T04, T08A, T16 |
| T13 | T08A, T08 |
| T51 | T15, T13, T06, T16, T08A |
| T06A | T06, T08A, T15, T16, T13 |
| T13A | T07, T08A, T13, T15 |
| T14 | T08A, T15, T13A, T06A (stubs: `getSellerReputation`, `giftToGuild`) |
| T12 | T01, T04 |
| T10 | T01, T06, T08B |
| T20 | T06A, T07, T16, T13A |
| C05 | C01, C04, T08A, T16, T06A, T20, T08C, T12 |
| C02b | C02, T03, T04 |
| O02 | O01, T03 |
| T43 | T08B, T16, T14 (T14 may be deferred; T14 seller/listing stub required if T14 UI is cut) |
| T44 | T08B, T16, T43 |
| T45 | T08A, T43 |
| T50 | T08A, T45 |
| T46 | T08B, T43, T44 |
| T23 | T01 |
| T24 | T04 |
| T25 | T01, T00A |
| T26 | T16, T25 |
| T40 | T00, T05, T17, T43, T44, T45 |
| T41 | T03, T08A, T14, T45 |
| T42 | T40, T41 |
| C06 | C01 |
| C09 | C04, C05 |
| C07 | C01–C06, C09, T08C |
| H01 | all Gate 3 tasks except the real-money Spore switch |
| Real-money switch | T13, T40, T41, T42 |

## B6. Why 13 / 26 / 52 Does Not Hold, and What a 13-Week Gate Could Hold
With client work counted, the work needed just to reach the original "week 13" milestone (foundation, networking gate, client foundation, resource model, growth, procedural renderer, world server, accounts, Root Sight) is **exactly 13 weeks with no playtest and no buffer**. That is why it is Checkpoint 4, not Gate 1.

**Compressed Plan (if you insist on 13/26/52):**
- Gate 1 (W13) would be a *growing-plants-and-Root-Sight* slice with no weather, chat, damage, mutations or inventory. It would not test the core loop.
- Gate 2 (W26) would add the Gate 1 core loop (weather, chat, damage, mutation, inventory, HUD) and nothing from the economy.
- Gate 3 (W52) would have to drop most of the Gate 2 economy and history systems or ship them half-finished.
I recommend against it, because it moves the feeling of failure to week 13 instead of removing it. If you choose it anyway, apply the Gate 1 cut list plus cut T04 entirely and tell me, and I will re-run the arithmetic.

## B7. Post-Alpha (Beta) Order — unscheduled
Recommended order, dependencies respected: T47, T48, T30, T34, T36, T35, T09, T11, T13B, T22, T18, T19, T21, T27, T28, T29, T37, T38, T39, T31, T49, **T53**, T32, T33. Re-run the weeks arithmetic before scheduling any of them.

## B8. Repo File System

```text
plant-legacy/
├─ DESIGN.md                      # this plan (v5.3.1)
├─ CONTEXT.md                     # engine/stack version, file tree, interfaces, locked decisions
├─ README.md
├─ ATTRIBUTION.md                 # every free asset: source, license, link
├─ package.json  pnpm-workspace.yaml  tsconfig.base.json  .editorconfig
├─ .github/workflows/ci.yml  deploy-staging.yml
├─ config/                        # one file per system; extended _meta format
│  ├─ _meta/                      # schemas, validator rules, rarity ban
│  ├─ growth.json  root_sight.json  net_proto.json  network.json  world.json
│  ├─ resources.json  daynight.json  weather.json  mutations.json  chat.json  emotes.json
│  ├─ uproot.json  damage.json  tumbling.json  session.json
│  ├─ inventory.json  item_flags.json  fragments.json  extraction.json
│  ├─ account_progress.json  achievements.json  prestige.json  accounts.json  reports.json
│  ├─ archetypes.json  parasitism.json  spores.json  genes.json  boosters.json
│  ├─ marketplace.json  ledger.json  naming.json  heirlooms.json  deep_time.json
│  ├─ reputation.json  guilds.json  mail.json  gift_packs.json  gift_bundles.json  status.json
│  ├─ growth_scale.json  terrain.json  persistence.json
│  ├─ compliance.json  anticheat.json  liveops.json  ops.json
│  ├─ controls.json  ui.json  render.json  audio.json
│  └─ (Beta, empty until built) symbiosis.json  companions.json  relics.json  annotations.json
│     paid_spawn.json  minimap.json  messaging.json  observation.json  gifts.json
│     spectating.json  spectator.json  spectating_ui.json  water.json  campaign.json
│     tutorial.json  territory.json  clips.json  epoch_map.json  leaderboards.json
│     climate_memory.json  profiles.json  reproduction.json
├─ docs/
│  ├─ protocol.md  partitioning-lod.md  tick-budget.md  data-model.md
│  ├─ compliance-policy.md  what-spores-are.md  what-works-now.md
│  ├─ art-bible.md  controls.md  hosting.md  decisions.md
│  ├─ tasks/                      # one markdown file per task (spec, README, checklist, status)
│  └─ checklists/                 # manual tests, gate playtest forms
├─ packages/
│  └─ shared/src/
│     ├─ protocol/                # message definitions, codec, quantization
│     ├─ schemas/                 # config + item + death-record schemas
│     ├─ events/                  # event names and payload types (Appendix E)
│     ├─ config/                  # loader + validator (used by client and server)
│     └─ math/  ids/  constants/
├─ apps/
│  ├─ server/src/
│  │  ├─ main.ts
│  │  ├─ core/                    # tick loop, tier scheduler, event bus, config
│  │  ├─ net/                     # websocket, interest areas, rate limits, protocol handlers
│  │  ├─ sim/
│  │  │  ├─ resources/  growth/  damage/  weather/  mutation/  uproot/
│  │  │  ├─ parasitism/  seasons/  fragments/  tiers/ (active, near, dormant)
│  │  ├─ economy/                 # inventory, spores, genes, extraction, boosters, marketplace, mail
│  │  ├─ social/                  # chat, reports, reputation, guilds, status
│  │  ├─ identity/                # accounts, sessions, account progress, achievements
│  │  ├─ history/                 # ledger, naming, tombstones, death records, heirlooms
│  │  ├─ persistence/             # db access, migrations/, snapshots, event log
│  │  ├─ admin/                   # triage page (T40)
│  │  ├─ ops/                     # health, metrics, tick-budget dashboard
│  │  └─ tests/                   # unit, concurrency (duplication audit), bot clients
│  ├─ client/src/
│  │  ├─ main.ts
│  │  ├─ app/                     # state, session, scenes
│  │  ├─ render/
│  │  │  ├─ camera/ (rig, orbit, rootsight, spectator, map, timelapse)
│  │  │  ├─ plants/ (graph, tubes, leaves, flowers, lod, ik, material)
│  │  │  ├─ environment/ (terrain, sky, weather, cutaway)
│  │  │  └─ shaders/  pools/  quality/
│  │  ├─ input/                   # actions, bindings, keyboard, mouse, touch, context rules
│  │  ├─ ui/
│  │  │  ├─ tokens/ (colors, type, spacing, motion)
│  │  │  ├─ hud/  menus/  dialogs/ (report, naming, trade)  components/
│  │  │  └─ i18n/
│  │  ├─ net/                     # client socket, codec, prediction (camera only)
│  │  ├─ audio/
│  │  └─ platform/                # web, electron, capacitor adapters
│  ├─ desktop/                    # Electron wrapper
│  └─ mobile/                     # Capacitor wrapper
├─ assets/
│  ├─ source/                     # Blender files, raw audio (free/CC0 only)
│  ├─ licenses/                   # license text per source
│  └─ build/                      # compressed outputs
├─ tools/
│  ├─ config-validator/  sim-bots/  load-test/  seed-data/  backup/
└─ ops/
   ├─ docker/  compose.yml  deploy/  backup-scripts/
```
Not in the repo: `secrets.md` (see Part 9).

## B9. Definition of Done (every task)
1. Implementation matches the spec; nothing extra.
2. All tunables in `config/*.json` with range and default; validator passes; no `rarity`.
3. README of tunables returned.
4. Manual test checklist returned and run.
5. Acceptance criteria all pass, including concurrency tests for item/gene/Spore transactions.
6. `CONTEXT.md` updated (interfaces, decisions). `ATTRIBUTION.md` updated for any asset.
7. Performance check against Part 13.4 for client tasks; tick-budget check for server tasks.
8. Task marked `[x]` in `docs/tasks/`, then stop. Next session starts at the next unchecked task.

---

# Part 5 — System Specs

Each spec is a block. Feed one to the AI at a time. Every AI session returns implementation, config file, README explaining tunables, and manual test checklist.

## Phase 0 — Foundation

### T00 · Foundation — `config/_meta`, `config/*.json`
**Depends on:** nothing.

**Must support.** Repo skeleton. `DESIGN.md` (this document). `CONTEXT.md` with engine version, file tree, every interface, and locked decisions "camera is an independent entity" and "all item/gene mutations are server transactions." A `config/` folder in extended `_meta` format. One empty config file for every file in Part 6.2, including v5.3 additions: `profiles.json`, `controls.json`, `ui.json`, `render.json`, `audio.json`, `accounts.json`, `reports.json`, `fragments.json`, `extraction.json`, `reproduction.json`, `network.json`, `ops.json`. Draft five-line illegal-content-only policy in `config/compliance.json`. **Add the monorepo scaffold and CI (O01).** **Add `docs/art-bible.md` and `ATTRIBUTION.md` stubs.** No game logic values hardcoded.

**Acceptance.** Config loads. No values in code. Repo tree documented. `CONTEXT.md` current. Compliance policy drafted. Every config file named in any task exists. Startup check fails if any schema contains a `rarity` field. Art bible stub and attribution stub exist.

**Config.** `_meta` format; empty configs for every system.

**AI prompt.** "Build T00 foundation. Return repo tree, extended-schema sample config, `CONTEXT.md` skeleton, five-line compliance draft, README. Strict modules; single process, single Postgres, no Redis, no queue. Create every config file in Part 6.2 and a validator that rejects rarity fields. Include monorepo scaffold, CI, art-bible stub, attribution stub."

### T03P · Networking Gate — `config/net_proto.json`
**Depends on:** T00. Build immediately after T00.

**Must support.** Two clients, one server, one cube each. Client sends intent; server validates and broadcasts state. Invalid moves (teleport, speed hack, out-of-bounds) rejected and logged. **[V5.3] Decides the protocol (Part 13.8).**

**Acceptance.** Two tabs, two cubes, one server. Server rejection demonstrated; clean console is not the test.

**Config.** Tick rate 10–60 Hz. Max players 2–8. Validation rules.

**AI prompt.** "Build a two-tab server-authoritative prototype with server-side move validation. Return server, client, protocol note, manual test checklist."

## Phase 1 — The Living Sprout

### C01 · Client Foundation — `config/render.json`, `config/controls.json`, `config/ui.json`
*(See Part 4, B4 for full spec. Depends on T00, T03P.)*

### T00A · World Resource Model — `config/resources.json`, `config/daynight.json`
**Depends on:** T00. Hooks: T07 supplies `time_of_day`; until then use constant.

**Must support.**
- Tile grid with per-tile light, moisture, minerals (0–100).
- Light: sun base, reduced by canopy nodes, multiplied by day/night curve.
- Moisture: raised by rain, lowered by evaporation and root absorption.
- Minerals: absorbed by roots; replenished by dead roots, dead plants, dung, fertilizer.
- Photosynthesis: biomass/tick = Σ leaf nodes of `(light/100) × moisture_factor × mineral_factor × rate`. Factors are config piecewise-linear curves. No leaf nodes = no photosynthesis biomass. Only leaf nodes photosynthesize; all canopy nodes cast shade.
- Root absorption: root nodes absorb moisture/minerals within radius, depleting tile.
- Soil deposits: dead roots/plants deposit minerals.
- **Consumption triggers replace "mineral node."** No mineral-node entity. T04 consumption trigger fires when (a) plant absorbs minerals from tile at/above `tile_mineral_threshold`, or (b) plant consumes/applies dung or fertilizer. T04 mineral modifiers read local tile value.
- Readout: client queries local light/moisture/minerals for own plant and neighboring tiles.
- Minimal onboarding: dismissible 3-line first-spawn hint card and contextual tooltips on light, moisture, minerals, time_of_day. No depth explanation.
- Server-authoritative; changes broadcast to nearby players on world tick. T00A consumes `time_of_day`; does not own cycle.

**Acceptance.** Tile values change from sun, rain, evaporation, absorption, deposits. Photosynthesis follows formula. Roots deplete; dead matter replenishes. Client can read local values. Tooltips/hint card present and dismissible. Consumption triggers fire from tile data. No client-side resource writes. No hardcoded values.

**Config.** Tile size 0.5–10. Light base 0–100; day/night curve array. Moisture base 0–100; rain gain 0–5/s; evaporation 0–1/s. Minerals base 0–100; absorption 0–5/s; dead-root deposit 0–50 per node; dung/fertilizer deposit 0–50. Photosynthesis rate 0–1.0. Absorption radius 1–50. Factor curves. `consumption_trigger: {tile_mineral_threshold: 0–100 default 20, dung_item: true, fertilizer_item: true}`.

**AI prompt.** "Build T00A resource model with formula, factor curves, absorption, deposits, readout, onboarding hint card/tooltips, consumption-trigger hooks. No mineral-node entity. Server-authoritative; all values in config."

### T01 · Growth — `config/growth.json`
**Depends on:** T00A.

**Must support.** Plant is collection of typed nodes (root, stem, leaf, flower, spore_sac, vine) on two layers. Each node has position, biomass cost, stat modifiers, resource draw, upkeep. Growth directional, continuous, interruptible, server-authoritative, broadcast. Growth costs biomass and time. Root overlap competition: rival root nodes in overlapping space apply pressure damage at config rate. Plant can direct growth to press rival's roots (root attack). Root attack feeds T06 damage pipeline; no separate combat system. Canopy shading: each canopy node lowers light on tiles below via T00A.

**Acceptance.** Plant visibly grows in both layers. Growth requires biomass and interrupted by damage. Two nearby plants affect each other: root overlap damages, canopy reduces light. Root attack works and registers in T06. No hardcoded values.

**Config.** Root/canopy growth speed 0.1–10 units/s. Node cost 1–100. Max nodes 200–200,000 server-safety ceiling. Growth cooldown 0–1 s. Root overlap pressure 0–20 HP/s. Light blocking per node 1–25. Node-type definitions.

**AI prompt.** "Build server-authoritative typed-node growth with root overlap pressure, root attack as directed growth action, canopy shading through T00A. All tunables in `growth.json`."

### C02 · Procedural Plant Renderer v1 — `config/render.json`
*(See Part 4, B4 for full spec. Depends on C01, T01.)*

### T03 · The Multiplayer World — `config/world.json`, `config/network.json`
**Depends on:** T03P must pass; T01.

**Must support.** Server owns state of every plant. Clients send intent and receive updates. Client prediction for camera/self-movement only, never growth/combat. Plants persist through disconnect and simulate at lower offline tick. Reconnect window. Chat channels carried here (T05 builds them). Single process, single Postgres, no Redis, no queue; inventory/gene transactions row-locked. Written partitioning/LOD strategy for 10k target. Event bus: small in-process publish/subscribe with named events; subscribers register at startup; handlers must not block tick. **[V5.3] Replace offline-simulation wording with Part 13.6 (Active / Near / Dormant tiers). Add interest management (Part 13.7). Add tick-budget metrics (Part 13.6).** Binary protocol per Part 13.8. Plant node graph stored as compact binary snapshot plus append-only event log (Part 13.9). Snapshots time-sliced; never spike a tick.

**Acceptance.** State persists across disconnect. Offline plants grow, take damage, die at reduced tier. Server authoritative everywhere. Row-locked transactions. Partitioning/LOD document exists. 10k is design target, not pass/fail. Event bus delivers events to at least two test subscribers. Tick-budget metrics logged each second. Interest areas restrict updates to subscribed cells. Snapshot + event-log persistence works; periodic compaction runs.

**Config.** Tick rate 10–60 Hz. Max players per World 10–50,000 default 10,000 (playtest 50). Reconnect 1–60 min. Offline tick tiers per Part 13.6. Detailed-plant budget 50–100. `offline_damage_multiplier` 0–1.0 default 1.0. Cell size default 64×64 world units. Interest ring radius. Per-client entity cap. Snapshot interval; event-log compaction threshold.

**AI prompt.** "Build persistent server-authoritative World with Part 13.6 tiers (Active/Near/Dormant), Part 13.7 interest management, Part 13.8 binary protocol, Part 13.9 binary snapshot + event log, reconnect, event bus, tick-budget metrics, partitioning/LOD design note. Single process, single Postgres. 10k design target only."

### T08C · Accounts and Sessions — `config/accounts.json`
*(See Part 4, B4 for full spec. Depends on T03.)*

### T02 · Root Sight — `config/root_sight.json`
**Depends on:** T01, **C01**.

**Must support.** Toggle surface/underground. Underground is volumetric cutaway: soil semi-transparent near plant, reveals own and nearby rival roots. Full camera control (orbit, zoom, pan) both modes. Smooth transition. Camera independent entity with target reference default own plant. Camera moves, not plant. Other players cannot tell when you are in Root Sight. Substrate movement multiplier applies to uprooted reroot crawl whether Root Sight on or not. **[V5.3] Camera controller from C01 CameraRig.**

**Shader ownership (v5.3.1).** T02 implements the Root Sight cutaway shader. C03 reuses/refines it for general environment cutaways.

**Acceptance.** Toggle instant/free. Own roots high-contrast, rival roots distinct. Rooted plant never moves. Reroot crawl slowed by substrate multiplier. Others see nothing different.

**Config.** Cutaway radius 5–500. Transition 0–3000 ms. Soil opacity 0–0.9. Highlight colors. Substrate multiplier 0.1–1.0. Camera target default `own_plant`.

**AI prompt.** "Build two-mode camera with cutaway sphere, independent camera entity from C01, and substrate multiplier as physics property for T06 crawl. All values in config."

### T07 · Weather and Day/Night — `config/weather.json`, `config/daynight.json`
**Depends on:** T00A, T03.

**Must support.** Day/night cycle: global `time_of_day` in [0,1). Length default 30 min, day fraction default 0.66. Feeds T00A light and T13A conditions. Weather states: clear, rain, thunderstorm. Each event has telegraph, active, aftermath. Rain adds moisture; clear adds light; storms add wind/lightning damage plus rain. Aftermath reshapes environment. Condition mapping: clear → sun, rain → rain, thunderstorm → storm; `time_of_day` maps to day/night by day fraction. Mapping in `daynight.json`. Forecast readout within forecast window. Biome modifier constant 1.0 in MVP. **[V5.3] Thunderstorm is first class (D-08); see T13A booster matrix.**

**Acceptance.** Day/night runs and feeds T00A/T13A. All three states exist; thunderstorm has three phases. Telegraphs clear. Prepared plants survive better. Forecast exists. Condition mapping exists.

**Config.** Cycle length 10–120 min. Day fraction 0.4–0.8. Telegraph 10–300 s; active 10–300 s; aftermath 30–600 s. Lightning rate/magnitude. Wind damage threshold. Rain moisture 0–5/s. Storm frequency 0–10 per session. Forecast window 30–600 s. Biome modifier 1.0. Condition mapping.

**AI prompt.** "Build day/night cycle and clear/rain/thunderstorm state machine with forecast and condition-mapping table. Biome modifier constant."

### C03 · Environment Rendering — `config/render.json`
*(See Part 4, B4 for full spec. Depends on C01, T07, T00A.)*

### T05 · Communication — `config/chat.json`, `config/emotes.json`, `config/reports.json`
**Depends on:** T03, **T08C**.

**Must support.** Proximity text chat range-limited and world chat global, both in MVP, configured independently. Data-driven emote wheel: body animations, particle effects, system effects; some require mutations. Whisper/group/DM post-MVP. **Report and block controls on every player-authored surface (Part 5, T05 report/block and T40 admin triage).** No general moderation; five-line policy applies.

**Report feature (new [V5.3]):**
- **Entry points:** long-press / right-click a chat message, a nearby player's name tag, a marketplace listing, a profile, a guild name, a mail message, or a review.
- **Report dialog fields:** (1) What are you reporting? (pre-filled; shows the exact message/player/listing); (2) Reason (dropdown, config-defined; starting list matches RULE_6: child safety, credible threat, doxxing/personal information, other illegal activity, other; offensive/weird/political/toxic is not an actionable category); (3) Additional info (free text, config max length); (4) Block this player checkbox (default checked after submitting).
- **Server behavior:** stores reporter ID, target ID, surface, reason, free text, timestamp, and a snapshot of the surrounding context (for chat: the last N lines of that channel, config default 20; for listings: the listing text at that moment). Rate limit per reporter to prevent report spam; duplicates merged. Plain confirmation shown. Game never tells the reporter what action was taken.
- **Block:** hides the blocked player's chat and mail from the blocker; does not alter the world simulation.

**Acceptance.** Proximity range-limited; world global and rate-limited. Emotes data-driven. Chat log persists per session. Report dialog present on all listed surfaces; server stores context snapshot; rate limit works; block hides chat and mail.

**Config.** Proximity range 5–500. World rate 1–60 msg/min. Emote range 5–200. Emote definitions array. Log size 100–10,000. Report reasons list; context line count; free-text max; report rate limit.

**AI prompt.** "Build proximity chat, world chat, data-driven emote wheel with six example emotes, and the Roblox-style report/block flow per Part 5, T05 report/block and T40 admin triage. Illegal-content-only policy applies; no other moderation. Server stores context snapshot. All values in config."

### T04 · Mutation — `config/mutations.json`
**Depends on:** T00A, T01, T03.

**Must support.** Data-driven mutations: trigger (chance, environment, consumption, action), effect (stat, ability, cosmetic, structural, expressive), maintenance cost, visual signature. Unbounded table; no cap on stacked mutations; every mutation costs upkeep; too many for environment kills plant. Plant can shed mutation for short penalty. No rarity field; no rarity UI. Movement block schema `{translocate, parts, drift, rerootSpeed}`. If simple MVP mutation sets `movement.rerootSpeed`, it multiplies MVP reroot crawl speed (T06). Full locomotion post-MVP reads same block. Environment triggers read light, moisture, minerals, weather state, time of day, biome modifier (constant 1.0 in MVP). Consumption triggers use T00A definition. Discovered and traded gene records share one schema and one ID space. Emits `mutation_acquired`, `mutation_shed` (T15 and T08B subscribe).

**Acceptance.** Mutations config-only to add. Maintenance scales and can kill. Shedding works with cooldown/penalty. Cosmetic, structural, expressive variants exist. Triggers fire from T00A/T07 data. Movement block exists and crawl modifier works.

**Config.** Chance per growth event 0–0.5. Weight tables. Maintenance 0–100 biomass/s. Shed cooldown 0–10 min; penalty 0–60 s. Gene ID space. Mutation schema with movement block.

**AI prompt.** "Build data-driven mutation system with triggers reading T00A/T07 data, maintenance, shedding, movement block whose `rerootSpeed` modifies MVP crawl, events on acquire/shed. No rarity field. Return example table of at least 12 mutations."

### T06 · Uprooted, Damage, Tumbling — `config/uproot.json`, `config/damage.json`, `config/tumbling.json`, `config/fragments.json`
**Depends on:** T01, T02, T03, **T07** (no weather stub needed; build T07 first).

**Must support.** State machine rooted → uprooted → tumbling → re-rooting → rooted with biomass/growth cost per transition. Uprooting by structural damage, weather, prolonged starvation. Uprooted roots visible, biomass drains fast, plant tumbles per local physics, nearby players notified. MVP reroot crawl: uprooted player steers slow crawl toward valid soil within reroot window. Success grants short desperation buff; failure death. Speed = `reroot_crawl_speed × substrate_multiplier × movement.rerootSpeed` default 1.0. One damage pipeline, four sources: weather, roots (root attack and overlap from T01), tools (accepted, unused MVP), herbivores (scripted ambient events: swarm passes region on timer, applies damage, does not pathfind). Kill credit: every damage record keeps source plant IDs; on death, credit goes to player source with most damage within `kill_credit_window`. Weather/herbivore deaths credit no one. Emits `plant_died`, `plant_uprooted`, `kill_credited`. Dung drops from herbivore events and plant death. No editorializing UI. **[V5.3] Fragment drops and remains per Part 5, T51: a node destroyed by the damage pipeline drops a fragment with a configured chance; a dead plant leaves remains (a configured number of fragments in the world).**

**Acceptance.** Uprooting visible/broadcast. Reroot stressful but possible via crawl. Failure death. All damage uses pipeline; root attack live; tool source accepted. Herbivores scripted events, not agents. Fragment drops and remains work; fragments expire per config.

**Config.** Uproot threshold 1–10,000 HP. Reroot window 3–120 s. Reroot soil minimum 0–100. Crawl speed 0.1–2.0 default 1.0. Desperation buff 0–60 s, 0–100%. Uprooted drain 0–100/s. Tumble physics. Damage source weights. Herbivore schedule/damage. `kill_credit_window` 5–300 s. Fragment drop chance; remains count; `fragment_lifetime`.

**AI prompt.** "Build uproot/tumble/damage with MVP reroot crawl, one damage pipeline for all four sources, kill credit, dung drops, fragment drops and remains, events. All values in config."

### T08A · Inventory — `config/inventory.json`, `config/item_flags.json`
**Depends on:** T03, **T08C**.

**Must support.** Server-authoritative inventory per player per World. Every mutation is a transaction with Postgres row-level locking. No in-memory inventories. UI reads; never writes counts. Item types in MVP: boosters, gene items, heirloom seeds, Starter Packs, Gift Bundles, essence, dung, fertilizer, gene stabilization, mail attachments, **[V5.3] fragments, offspring seeds**. `spore_balance` first-class and transaction-safe. Item flags (RULE_23) on every item definition: `tradeable`, `mailable`, `listable`, `account_bound`. Central validator enforces; T14, T45, T29 call it. Gift Bundle operations: `bundle_create(items[])` consumes tradeable source items and creates one Gift Bundle item recording contents; `bundle_open(bundle)` consumes bundle and grants contents. Both transactions. Contents may not include Starter Packs or any account-bound item. No rarity field. Duplication-audit test: two concurrent requests for same item cannot both succeed.

**Acceptance.** All above, plus flag validator rejects account-bound item in bundle, listing, or attachment.

**Config.** Starting item set. Stack limits 1–10,000. Transaction timeout 1–30 s. Row-lock strategy documented. Item definitions with flags.

**AI prompt.** "Build row-locked inventory with `spore_balance`, item flags and central validator, bundle create/open transactions, fragment and offspring seed categories. Include duplication-audit test. No rarity field."

### C04 · HUD and Controls v1 — `config/ui.json`, `config/controls.json`
*(See Part 4, B4 for full spec. Depends on C01, T00A, T07, T08A, T05, T06.)*

## Phase 2–3 — Economy, Identity, History, Inheritance

### T08 · Session Feedback — `config/session.json`
**Depends on:** T03, T08A. **Moved from Gate 1 to Gate 2 [V5.3].**

**Must support.** Session ends after configured duration. No last-plant-standing condition. End screen shows biomass, mutations, kills, drains, tracked stats, guild affiliation once T44 exists. Spore stipend writes to `spore_balance`; T13 later owns full economy. No permanent unlock. Plants persist regardless of session end.

**Acceptance.** Sessions end after duration. Stats meaningful. Stipend credited transactionally. No permanent unlock.

**Config.** Duration 5–120 min. Score weights. Stipend 0–1,000 Spores.

**AI prompt.** "Build session-end feedback with stipend written to T08A `spore_balance`. No permanent unlock; no last-plant-standing end."

### T08B · Account Progress — `config/account_progress.json`, `config/achievements.json`, `config/prestige.json`
**Depends on:** T03, T04 events, T08A. Hooks: T06/T10/T20 emit events later.

**Must support.**
- Account-level progress separate from the plant.
- **Prestige:** integer counter on account, incremented by configured events. No mechanical power. Only non-consensual drains count for parasitism prestige (T10). Weather/herbivore deaths credit no one.
- **Achievements:** config-defined milestone IDs with triggers and display names. No mechanical power.
- Subscribes to event bus: `mutation_acquired`, `plant_died`, `kill_credited`, `drain_completed`, `season_ended`, etc.
- Persists across plants and sessions.
- T46 only displays status; T08B owns the data.

**Acceptance.** Prestige and achievements persist at account level. Configured events increment correctly. No mechanical power. Event bus subscriptions work. T46 can read status.

**Config.** `account_progress.json` schema. `achievements.json` definitions. `prestige.json` event weights/thresholds. No rarity field.

**AI prompt.** "Build account progress per T08B: prestige integer, config-defined achievements, event-bus subscriptions, account persistence, no mechanical power. T46 only displays status. All config in named files."

### T16 · The Ledger — `config/ledger.json`
**Depends on:** T03, T08A.

**Must support.** Every object that can be named carries ledger. Entry: timestamp, editor, text, duration active, owner at time. Public and one-click accessible. Filterable by player, date, keyword. Entries may be erased; erasure removes content but leaves public tombstone recording who erased and when. Nothing silently deleted. Persists across sessions/seasons. Full ownership chain for tradables. Community curation by downvote-to-hide, not delete. Archive old rows to cold storage; keep tombstones hot. Gene removals, heirloom traces, reputation review edits/erasures write ledger entries automatically. **[V5.3] Fragment and gene provenance entries per RULE_30.**

**Acceptance.** Every named object has ledger. Public/filterable. Erasure produces visible tombstone. Persists across seasons. Ownership chains visible. Downvote-to-hide exists. Cold storage archive exists. Gene removals/heirloom traces write entries. Review edits/erasures write entries. Fragment and gene provenance written.

**Config.** Ledger per-object size infinite. View page size. Filter options. Erasure behavior. Downvote thresholds. Cold storage policy.

**AI prompt.** "Build permanent edit/ownership ledger attached to any named object. Entry has timestamp, editor, text, duration active, owner at time. Public/filterable. Erasure removes content but leaves public tombstone. Nothing silently deleted. Persists across seasons. Ownership chains for tradables. Downvote-to-hide. Cold storage; tombstones hot. Gene removals, heirloom traces, fragment/gene provenance, review edits/erasures write entries automatically."

### T17 · Naming — `config/naming.json`
**Depends on:** T16.

**Must support.** Every applicable object has naming UI: species, companions, genes, marketplace listings, guild names/mottos, satellite plants, modified environmental features, consumables, all named items. Names appear in tooltips, inspection, marketplace, chat tags. Names persist in ledger after changing unless erased. No general moderation; five-line policy applies.

**Acceptance.** All applicable objects nameable. Names appear everywhere. Ledger preserves history including tombstones. No general moderation; compliance policy applies.

**Config.** Name max length. Description max length. Compliance policy reference.

**AI prompt.** "Build player naming on all applicable objects. Names appear in tooltips, inspection, marketplace, chat tags. Names persist in ledger unless erased. No general moderation; illegal-content-only policy applies."

### T15 · Genes — `config/genes.json`
**Depends on:** T04, T08A, **T16** (no ledger stub needed; build T16 first).

**Must support.** MVP: genes are inventory items; one schema, one ID space for discovered and traded genes; gene removal writes ledger entry. T06A/Gate 2 reads genes; death record captures gene sets. Gene extraction and graft are owned by T51; marketplace listing by T14; bloodline tracing by T22. T15 owns the gene schema, shared ID space, and mint-on-acquisition. No rarity field. **[V5.3] Gene extraction (T51) and seed production (T06A) use this ID space; per-plant-mutation mint limit `mints_per_plant_mutation` enforced across acquisition and self-extraction.**

**Acceptance.** Gene items exist in inventory. One schema, one ID space. Gene removal writes ledger entry. T06A heirloom check reads gene items later. T51 extraction uses same ID space and respects mint limit. No rarity field.

**Config.** Gene item schema. Gene ID space. History retention with tombstones. Description max length. `mints_per_plant_mutation` default 1.

**AI prompt.** "Build MVP gene items. Genes are inventory items. One schema, one ID space for discovered and traded genes. Gene removal writes ledger entry. T06A and T51 use the same ID space and mint limit. No rarity field."

### T13 · Currency — `config/spores.json`
**Depends on:** T08A, T08.

**Must support.** Spores earned by session participation, territory control (dormant until T49), mutation acquisition, kills, exploration, dung consumption, seasonal rewards. Spores spent on fertilizer, gene stabilization, companion care (dormant), cosmetics, market fees, territory upkeep (dormant). In-game store for Spore purchases in MVP; store UI exists; real-money integration later. No artificial earn caps. Real-money bundle prices proposed: $5=500, $20=2500, $50=8000, $100=25000. Early-access monetization honestly labeled with visible "what's working now" list. **P2W line:** MVP ladder inferior → common → standard. Inferior and common purchasable and tradeable. Standard and above account-bound and earn-only. Standard crafting requires earn-only Essence. Spores are consumed in-game currency, not stored value.

**Acceptance.** Spores earned from all configured sources. Spent on all configured sinks. Store UI exists; real-money purchase is later switch. No artificial earn cap. "What spores are" plain-language answer exists. "What's working now" list exists. Records from day one. P2W line concretely defined.

**Config.** Earn rates per source. Sink prices. Bundle prices. No daily cap. Early-access labeling. P2W cap definition.

**AI prompt.** "Build Spore currency with configurable earn sources and sink prices. Real-money bundles: $5=500, $20=2500, $50=8000, $100=25000. Store UI exists; real-money integration later. No artificial caps. Purchasable booster tiers capped at common; standard+ earn-only and account-bound. Standard crafting requires earn-only Essence. Include early-access labeling and 'what's working now' list. Spores are consumed currency, not stored value. All rates/prices in config."

### T51 · Gene Extraction and Graft — `config/fragments.json`, `config/extraction.json`
*(See Part 4, B4 for full spec. Depends on T15, T13, T06, T16, T08A.)*

**Full spec.** Part 5, T51:
- **Fragments:** category `fragment`; fields `source_plant_id`, `source_owner_id`, `node_type`, `source_genes[]`, `created_at`, `expires_at`. Sources: pruning own plant; node destroyed by damage pipeline (chance); dead plant leaves remains; later, tools. Pickup by proximity or action. Decay after `fragment_lifetime`. Flags: tradeable, mailable, listable true; not account-bound. No rarity field.
- **Gene extraction:** `extract_gene(source, mutation_id)`. From fragment: consume fragment, pay Spore cost, receive one gene item for one mutation ID chosen from `source_genes[]`. One fragment, one gene. From own living plant: creates one gene item (copy mode; plant keeps mutation) for Spore + biomass cost, cooldown, per-life limit (`self_extract_limit_per_life`); config can set `self_extract_mode: "consume"`. From own remains: treated like fragments. Provenance ledger entry `{gene_id, extracted_from_plant, source_owner, extracted_by, method}`. Per-plant-mutation mint limit enforced.
- **Graft:** `graft_gene(gene_item)` consumes gene item and rolls configured chance to acquire that mutation on living plant, applying T04 rules (maintenance cost, shedding, kill-by-upkeep). Limits: `graft_cooldown`, `max_grafts_per_life`, optional `graft_requires_prior_carry` default false.
- **Events:** `fragment_dropped`, `fragment_collected`, `gene_extracted`, `gene_grafted`, `seed_produced`.

**Acceptance.** One fragment yields exactly one gene. Concurrent extraction attempts on the same fragment cannot both succeed. Mint limits enforced. Graft applies T04 maintenance. Ledger shows provenance. No rarity field.

**Config.** Fragment lifetime, pickup radius, drop chances, extraction cost, self-extract mode/limits, graft chance/cooldown/limit, mint limit.

**AI prompt.** "Build T51 per Part 5, T51. Every transaction row-locked. One fragment, one gene. Provenance ledger entries. Duplication-audit test required."

### T06A · Heirloom-at-Death MVP — `config/heirlooms.json`
**Depends on:** T06, T08A, T15, T16, T13.

**Must support.**
- On mid-season death, player has three paths: new seed no mutations; heirloom seed with genes from inventory; heirloom seed with genes retrieved via Spores. Paths 2/3 mixable per gene.
- **Heirloom seed is blank vessel.** Carries no mutations. Restored set always from owner's own latest death record (`genes[]`). Bought/traded seed never imports someone else's build.
- Gene items keyed by mutation ID; can only restore mutations present in owner's latest death record.
- Path 3 retrieves immediate previous life only; bloodline tracing v2.
- Gene check server-authoritative transaction. Gene consumption vs copy per config. Ledger entries on retrieval and gene removal.
- Spore payment server-authoritative; cost scales with gene count; supertax past threshold recommended.
- Descendant is new plant entity carrying inherited mutation set, ancestor name, compressed edit history.
- Death record written at every death: `{plant_id, parent_seed_id, genes[], season, owner_id}`.
- Pre-build supported: players can queue next seed during life or between seasons; queued seed spawns when season opens.
- Heirloom seeds tradable/mailable per flags. Duplication surface audited before trading opens.
- No bloodline tracing in MVP. No rarity field.
- **[V5.3] Seed production (in life) [Part 5, T06A]:** a mature flower node can be converted into one heirloom seed (item) by spending biomass and the flower node. Limits and cooldown are config (`max_seeds_per_life` start 3, `seed_biomass_cost`, `flower_min_age`, `seed_cooldown`). Server transaction.
- **[V5.3] Death grant (mid-season) [Part 5, T06A]:** when a plant dies mid-season, it grants one heirloom seed to its owner (config `death_grant_seed`, default true). Guarantees no one is locked out of lineage by accident.
- **[V5.3] Season-end calamity [Part 5, T06A]:** `calamity_grant_seed` defaults to **false**. Lineage survives the calamity only through a seed you produced and queued earlier. A player with no queued seed starts the next season on Path 1 (new seed, no mutations), which is never a punishment against the account. *(Needs approval, Part 16, item 1.)*
- **[V5.3] Heirloom seed remains a blank vessel [Part 5, T06A].** Restored mutations always come from the owner's own latest death record. A bought or traded heirloom seed never imports another player's build.
- **[V5.3] First-ever seed [Part 5, T06A].** A new account spawns on Path 1 (no item needed).
- **[V5.3/v5.3.1] Planting a held heirloom seed (post-MVP) [T06A planting bullet / T22].** A held heirloom seed may be placed in soil to mark where your descendant will spawn. A planted seed is a world entity that the damage pipeline can affect. It is not controlled while you are alive (RULE_1: you are one plant). This is owned by T22 (or a separate post-MVP seed-planting task), not T53. T53 covers offspring seeds from cross-pollination only.

**Acceptance.** Three paths work. Gene check and Spore retrieval server-authoritative. Cost scales. Ledger entries written. Death record written. Descendant carries ancestor name/history. Pre-build works and queues next seed. Seed production from mature flower works. Death grant works. Calamity default respects config. No bloodline tracing MVP. Duplication audited. No rarity.

**Config.** Gene cost curve. Spore retrieval cost curve. Gene consumption rule consumed vs copied. Heirloom seed flags. Pre-build on. Death record schema. Name/history compression. `max_seeds_per_life`, `seed_biomass_cost`, `flower_min_age`, `seed_cooldown`, `death_grant_seed`, `calamity_grant_seed`.

**AI prompt.** "Build T06A heirloom-at-death. Three paths: new seed; heirloom with inventory genes; heirloom with Spore-retrieved genes; paths mixable per gene. Heirloom seed is blank vessel; restored set only from owner's latest death record. Gene items keyed by mutation ID. Server-authoritative gene check and Spore payment. Write death record `{plant_id, parent_seed_id, genes[], season, owner_id}`. Write ledger entries. Pre-build queues next seed. Seed production from mature flower with config limits and cooldown. Death grant. `calamity_grant_seed` default false. Heirloom seeds tradable/mailable per flags; audit duplication. No bloodline tracing. No rarity."

### T13A · Booster System, MVP — `config/boosters.json`
**Depends on:** T07, T08A, T13, T15.

**Must support.**
- 3 tiers in MVP: inferior, common, standard. Full ladder documented: inferior → common → standard → refined → greater → superior → mythical → legendary → planetary.
- 3 types: growth speed, mutation chance, healing specific plant parts.
- Conditions in MVP: day/night, rain/sun, **[V5.3] thunderstorm**. Boosts never wasted; conditions only determine best effect. Minimum effect floor `min_effect` (start 0.5).
- **[V5.3] Booster condition matrix per Part 6.1:**
  ```json
  "condition_matrix": {
    "type": "matrix",
    "rows": ["day", "night"],
    "cols": ["sun", "rain", "storm"],
    "value": [[1.0, 1.2, 0.9], [1.1, 1.0, 0.9]],
    "notes": "Never wasted: minimum effect floor in boosters.json (min_effect, start 0.5). T07 condition mapping: clear->sun, rain->rain, thunderstorm->storm."
  }
  ```
- Weather forecast dependency live.
- Visible active conditions state on plant UI.
- Data-driven from `boosters.json`; no hardcoded numbers.
- Durations/charges per type: growth-speed duration; mutation-chance charges; healing instant or short-duration.
- Stacking supported; default one active per type; alternate config allows multiple with diminishing returns.
- **P2W and crafting:** inferior/common purchasable and tradeable; standard and above account-bound and earn-only. Standard crafting requires earn-only Essence. No money-to-standard loophole.
- Every use is server transaction against inventory.
- Healing boosts interface with T06 damage/tumbling pipeline.

**Acceptance.** Three tiers, three types, conditions active including thunderstorm. Data-driven. Forecast live; active-conditions UI visible. Boosts never wasted. Mutation-chance charges; growth duration. Purchasable capped at common; standard+ account-bound/earn-only. Every use server transaction. Healing interfaces damage pipeline. Stacking supported.

**Config.** Tier definitions/prices. Type definitions. Duration vs charge. Condition modifiers including thunderstorm column. Active-condition visibility. Stacking rules. P2W cap. Essence crafting. Inventory integration. `min_effect`.

**AI prompt.** "Build T13A MVP boosters. Three tiers (inferior, common, standard), three types, conditional effectiveness including thunderstorm. Conditions in `boosters.json` per Part 6.1. Forecast live. Active-conditions UI. Boosts never wasted. Growth-speed duration; mutation-chance charges. One active per type default; stacking supported. Inferior/common purchasable; standard+ account-bound and earn-only; standard crafting requires earn-only Essence. Every use server transaction. Healing boosts interface T06. All values in config."

### T14 · Marketplace — `config/marketplace.json`
**Depends on:** T08A, T15, T13A, T06A. Build after T15. Enforces item flags server-side.

**Must support.** UI marketplace accessible anywhere. Lists items for buyout or auction. Filters by category, biome, type, seller. Shows 3D previews. Shows seller reputation. Supports trade and gift-to-guild if T44 present; otherwise disabled. Premium tab clearly separated for real-money Spore bundles. Handles boosters, gene items, heirloom seeds, Gift Bundles, **[V5.3] fragments, offspring seeds (if approved as tradeable), future item types**. Heirloom seeds tradable. Starter Packs not tradable. No rarity filter. No NPC vendors or game-built physical marketplace. Trade listings/DMs are UGC; illegal-content-only policy applies; report/block controls. Minimal trade UI: trade window, listing, search. **Enforce RULE_23 flags server-side: account-bound items cannot be listed, traded, mailed, or attached.**
- **[V5.3] Stub interfaces named:** `getSellerReputation(sellerId)` (returns null until T43) and `giftToGuild()` (disabled until T44).

**Acceptance.** UI marketplace works with categories/filters, no rarity filter. Items not just spores. Premium tab separate. UGC policy applies. Minimal trade UI. No NPC vendors/physical market. Heirloom seeds tradable. Starter Packs not. Heirloom trading schema-supported and activates when T06A ships. Flags enforced server-side. Stubs named.

**Config.** Listing fee. Auction durations. Commission. Premium bundle prices. Trade listing UGC policy. Item flags validation.

**AI prompt.** "Build UI-only marketplace: buyout, auction, filters by category/biome/type/seller (no rarity), 3D previews, seller reputation, trade, gift-to-guild if T44 present. Items include boosters, genes, heirloom seeds, fragments, Gift Bundles. Heirloom seeds tradable; Starter Packs not. Enforce item flags server-side. Premium Spore bundles separate. Minimal trade UI. Use `getSellerReputation(sellerId)` and `giftToGuild()`. No NPC vendors/physical market. All values in config."

### T12 · Archetypes — `config/archetypes.json`
**Depends on:** T01, T04.

**Must support.** At spawn, player selects archetype. MVP ships one default. Archetype sets base stats, starting mutations or mutation biases, growth curve character. Visible to nearby players. Data-driven, expandable to five or more later.

**Acceptance.** One default archetype in MVP. Selection works. Base stats apply. Config-driven. Expansion path documented.

**Config.** Archetype schema. One default definition. Placeholder schema for five future archetypes.

**AI prompt.** "Build archetype selection at spawn. MVP ships one default. Schema config-driven and expandable. Selection UI at spawn. Archetypes visible via inspection."

### T10 · Parasitism — `config/parasitism.json`
**Depends on:** T01, T06, T08B.

**Must support.** Plant can attempt attach to another plant. Attachment requires attacker substantially more biomass than target (config ratio) or target consent. Attached parasite drains biomass over time. Host can shake off at biomass cost. Attachment public: host and nearby players notified. If parasite drains host to death, parasite gains prestige stat. Multiple parasites can attach to one host. **Prestige farming closed: only non-consensual drains count. Consensual drains do not count for prestige.**

**Acceptance.** Attachment requires ratio or consent. Draining works. Shaking works and costs biomass. Attach is public. Prestige tracked only for non-consensual drains. Multiple parasites supported.

**Config.** Drain rate. Shake cost. Biomass ratio required. Prestige thresholds. Consent flag behavior.

**AI prompt.** "Build parasitism. Attacker must have higher biomass ratio or target consent. Attachment public. Parasite drains per tick. Host can shake off at cost. Drain-to-death grants prestige only if non-consensual. Multiple parasites allowed. All values in config."

### T20 · Deep Time / Season — `config/deep_time.json`
**Depends on:** T06A, T07, T16, T13A.

**Must support.**
- Same planet persists across seasons; never regenerated.
- Between seasons, rule-based deep-time transformation: continental drift, erosion, volcanism, sea level, biome distribution, climate.
- Player-created scars fossilize and may reappear as landmarks, mineral deposits, faint mutation traces.
- Season length tunable default 36 real days. Inter-season event scheduled, replayable god-view time-lapse with countdown. Players can pre-build/queue next seed during event.
- **Season-end calamity:** every plant dies. T20 runs T06A death pipeline for every plant. Lineage survives only through queued heirloom seed. No plant survives directly. **[V5.3] `calamity_grant_seed=false` default (Part 5, T06A).**
- Season reward for standard+ boosters defined here: configured reward grants standard+ booster(s) or crafting currency per season participation. No money-to-standard loophole.
- No relic drop in MVP; relic T18 post-MVP.
- No pre-build decision left open; pre-build supported.

**Acceptance.** Same planet across seasons. Transformation works. Scars can fossilize/reappear. Replayable time-lapse. Event scheduled/replayable. Players can pre-build/queue next seed. Season length tunable. Calamity kills every plant via T06A pipeline. Lineage via queued heirloom only. Season reward for standard+ boosters works. No relic drop MVP.

**Config.** Season length default 36 days tunable. Years/sec time-lapse. Fossilization chance. Transformation parameters. Event schedule. Calamity death pipeline. Season reward table.

**AI prompt.** "Build T20 partial deep time/season. Same planet across seasons. Rule-based transformation. Scars fossilize. Replayable time-lapse. Season length tunable default 36 days. Season-end calamity kills every plant by running T06A death pipeline for every plant; `calamity_grant_seed` default false. Lineage survives only through queued heirloom seed. Season reward for standard+ boosters. No relic drop MVP. All config in `deep_time.json`."

### C05 · Menus and Screens — `config/ui.json`
*(See Part 4, B4 for full spec. Depends on C01, C04, T08A, T16, T06A, T20, T08C, T12.)*

### C02b · Renderer Polish and LOD — `config/render.json`
*(See Part 4, B4 for full spec. Depends on C02, T03, T04.)*

### O02 · Migrations, Backups, Restore Drill — `config/ops.json`
*(See Part 4, B4 for full spec. Depends on O01, T03.)*

## Phase 4–6 — Social Economy, Growth, Launch

### T43 · Reputation — `config/reputation.json`
**Depends on:** T08B, T16, T14. T14 may be deferred, but T43 requires the T14 seller/listing data model and the named `getSellerReputation` stub. If T14 UI is cut, schedule the T14 data model + stub at Gate 3 before T43.

**Must support.** Consumer-style reviews. Any player can rate any seller, player, guild, or annotation 1–5 stars with optional written review. Reviews visible on rated entity's profile/listing. UGC; illegal-content-only policy applies; report/block controls. Reviewer can edit/erase own review; erasure leaves tombstone. Rated entity can respond once per review. Aggregation transparent: average, count, recent reviews, verified-transaction flag. Used by T14, T19, T28. No hidden score.

**Acceptance.** 1–5 star rating plus optional text. Works on sellers, players, guilds, annotations. Reviews visible/editable; erasure tombstone. Entity can respond once. Aggregation transparent/config-defined. Used by T14/T19/T28. No hidden score. UGC policy applies.

**Config.** Star scale 1–5. Review max length. Response max length. Aggregation formula visible. Verified-transaction rules. Report/block policy.

**AI prompt.** "Build consumer-style reputation. Rate sellers/players/guilds/annotations 1–5 stars plus optional review. Reviews visible/editable; erasure leaves tombstone. Entity responds once. Aggregation transparent, no hidden score. Used by T14/T19/T28. UGC policy applies. All config in `reputation.json`."

### T44 · Guilds — `config/guilds.json`
**Depends on:** T08B, T16, T43.

**Must support.** Any player can create guild for configurable Spore cost. Guilds have name, motto, roster. Senior members assign config-defined roles. Guild affiliation shown on member-authored annotations/profiles post-MVP. Guilds can claim official annotations on own structures post-MVP. Guilds have reputation (T43) aggregate. Leader can disband; disband leaves tombstone. Membership visible; no hidden guild. No mechanical buffs.

**Acceptance.** Any player can create guild. Name/motto/roster. Roles assigned. MVP includes creation, roles, roster, guild reputation, disband tombstone, no buffs. Post-MVP only annotation/profile attribution and official claims. Guild reputation exists. Disband tombstone. No mechanical buffs. Names/mottos UGC policy.

**Config.** Creation cost. Role definitions. Max members. Name/motto max lengths. Disband tombstone behavior.

**AI prompt.** "Build guilds. Any player creates for Spore cost. Name, motto, roster. Senior members assign config-defined roles. Guild reputation via T43. Leader can disband with tombstone. No mechanical buffs. Names/mottos UGC policy. MVP excludes annotation/profile attribution and official claims."

### T45 · In-Game Mail — `config/mail.json`, `config/gift_bundles.json`
**Depends on:** T08A, T43. Enforces item flags server-side.

**Must support.** Every player has inbox. System mail: updates, events, rewards, freebies, compensation. Player mail: one player to another; UGC policy; report/block. Attachments: system/player mail can carry boosters, gene items, tradeable Gift Bundles. Starter Packs are system-mail grants only and cannot be attached to player mail. Attachments claimed via T08A inventory transaction. Mail expiry per category; expired attachments return to sender for player mail or removed for system mail per config. Server-authoritative; sending/claiming transactions. UI searchable/filterable. **Gift Bundle spec:** player-assembled container of tradeable items; tradeable, mailable, listable; contents may not include Starter Packs or account-bound items. `bundle_create` consumes tradeable source items; `bundle_open` consumes bundle and grants contents. Enforce flags.

**Acceptance.** Inbox exists. System mail works. Player mail works. Attachments via inventory transactions. Starter Packs system-mail only, not player-mail attachable. Expiry per category. Server-authoritative. UI searchable/filterable. Player mail UGC policy. Starter Pack delivered by mail. Gift Bundles enforce flags.

**Config.** Mail categories/expiry. Attachment rules. Max inbox size. Max message length. Gift Bundle schema/flags. Report/block policy.

**AI prompt.** "Build mail with system/player messages and attachments. Attachments via T08A transactions. Starter Packs system-mail only, not player-mail attachable. Gift Bundles are tradeable/mailable/listable containers of tradeable items; no account-bound contents. Expiry per category. Server-authoritative. UGC policy. All config in `mail.json` and `gift_bundles.json`."

### T50 · Starter Pack — `config/gift_packs.json`
**Depends on:** T08A, T45.

**Must support.** On account creation, player receives Starter Pack. Contents configurable: small Spore stipend, one/two inferior boosters, starter gene item(s). Pack is account-bound and non-tradeable: cannot be listed, player-gifted, or player-mailed. Delivered by system mail (T45). Granted once per account, not per character. Claiming server-authoritative inventory transaction. The only newbie-grant item.

**Acceptance.** Pack granted on account creation. Delivered by mail. Contents configurable. Account-bound; not player-listable/giftable/mailable. System mail delivery. Once per account. Server-authoritative claiming.

**Config.** Pack contents. Grant timing. Account-bound flag fixed. Claim expiry.

**AI prompt.** "Build Starter Pack. On account creation grant account-bound pack delivered by system mail. Contents configurable: Spore stipend, inferior boosters, starter gene items. Cannot be listed, player-gifted, or player-mailed. Once per account. Claiming is inventory transaction."

### T46 · Status/Rank — `config/status.json`
**Depends on:** T08B, T43, T44.

**Must support.** Visible social standing derived from reputation, age, guild role, achievements. Used by T28 and culture systems. Visible on profiles/inspection. Transparent aggregation formula, no hidden score. No effect on growth, combat, economy, item power. **T46 only displays status; T08B owns account progress data.**

**Acceptance.** Status derives from configured inputs. Visible. T28 can read. No hidden score. No mechanical power. Displays T08B data only.

**Config.** Input weights. Status bands/tiers. Visibility rules. Aggregation formula.

**AI prompt.** "Build status/rank display from reputation, age, guild role, achievements. Transparent formula, no hidden score. Used by T28. No mechanical power. T46 displays; T08B owns data."

### T23 · Unbounded Growth Framework — `config/growth_scale.json`
**Depends on:** T01.

**Must support.** Growth unbounded in principle. Player can grow any direction/scale, spending increasing biomass/time. Node ceiling only server safety, set high; not design target or progression goal. No directional/scale restriction beyond biomass, time, physical constraints. General capability; no named large forms.

**Acceptance.** Ceiling high/configurable. No design-target language. Growth general/directional. No named emergent form.

**Config.** `max_nodes_per_plant` high safety ceiling. `growth_scale_cost_curve`. `growth_scale_time_curve`.

**AI prompt.** "Build unbounded growth framework. Growth unbounded in principle. Node ceiling only server safety; not design target. No directional/scale restriction beyond biomass/time. No named emergent form."

### T24 · Mutation Table Expansion — `config/mutations.json`
**Depends on:** T04.

**Must support.** Expand mutation table with cosmetic, structural, environmental variety. No rare/legendary/endgame/proper-noun labels. No `rarity` field. Combinations open; maintenance only brake. Discovered/traded gene records share schema/ID space. Simple mutations MVP; locomotion post-MVP; movement block schema exists.

**Acceptance.** Table expanded. No rarity labels/fields. Combinations open. Maintenance enforced. Schema/ID space unchanged.

**Config.** Mutation arrays. Weight tables. Maintenance curves. Visual signatures. Movement block schema-only until locomotion.

**AI prompt.** "Expand mutation table with cosmetic, structural, environmental variety. No rarity labels/fields. Combinations open. Maintenance only brake. No proper nouns. All config in `mutations.json`."

### T25 · Terrain Interaction — `config/terrain.json`
**Depends on:** T01, T00A.

**Must support.** General capability to alter terrain: soil displacement by roots, root tunneling creating voids, canopy light blocking, vines transporting material. No named outcome/culture tool/proper-noun mechanic. The T25 core stub required by T26 — root tunneling/voids and canopy light-blocking persistence — is not cuttable.

**Acceptance.** Each capability works generally. No named outcome. Terrain changes persist and feed T26.

**Config.** Soil displacement. Void/tunneling. Light blocking. Vine transport.

**AI prompt.** "Build general terrain interaction: soil displacement by roots, root tunneling voids, canopy light blocking, vines transporting material. General capabilities only. All config in `terrain.json`."

### T26 · Consequence Persistence — `config/persistence.json`
**Depends on:** T16, T25.

**Must support.** Every action leaves persistent trace. Dead roots become organic matter. Compressed soil stays compressed. Blocked light stays blocked until blocker changes. Traces persist across sessions and feed T20. No auto-clean. No editorializing UI.

**Acceptance.** Traces persist. Feed T20. No auto-clean. No editorializing UI.

**Config.** Trace retention. Organic conversion. Soil compression persistence. Light-blocking persistence. Deep-time hooks.

**AI prompt.** "Build consequence persistence. Every action leaves trace. Dead roots become organic matter. Compressed soil stays compressed. Blocked light stays blocked. Traces persist and feed T20. No auto-clean."

### T40 · Compliance Layer — `config/compliance.json`, `config/reports.json`
**Depends on:** T00, T05, T17, T43, T44, T45.

**Must support.** Five-line illegal-content-only policy for payment/hosting. Covers CSAM, credible threats, doxxing, illegal material. Covers chat, profiles, trade listings, DMs, guild names/mottos, mail, reviews. Storefront compliance only if storefront attempted. Compliance floor, not general moderation. **[V5.3] Add admin triage per Part 5, T05 report/block and T40 admin triage: minimal admin-only page listing reports by reason with context snapshots; actions limited to RULE_6 outcomes (remove content with tombstone, suspend account); every admin action writes a ledger entry; admin accounts use a separate role and are never created through public sign-up. Add age gate, terms of service, privacy policy, and parental rules tasks required before public alpha.**

**Acceptance.** Policy exists and enforced on covered surfaces. Report/block controls exist. No general moderation. Admin triage page works with context snapshots; ledger entries written; admin role isolated. Age gate, terms, privacy pages exist before public alpha.

**Config.** Policy text. Covered surfaces. Report/block rules. Admin role. Age gate threshold. Legal page text.

**AI prompt.** "Build compliance layer. Five-line illegal-content-only policy across chat, profiles, listings, DMs, guild names/mottos, mail, reviews. Report/block controls. Admin triage page with context snapshots and ledger entries. Admin role isolated. Add age gate, terms, privacy before public alpha. No general moderation."

### T41 · Anti-Cheat — `config/anticheat.json`
**Depends on:** T03, T08A, T14, T45.

**Must support.** Server authority is anti-cheat. Rate-limit and sanity checks. Browser has no native anti-cheat. Inventory/gene transactions server-authoritative with row-level locking.

**Acceptance.** Server rejects invalid moves/actions. Rate limits work. Sanity checks work. No client-side item decrement.

**Config.** Rate limits. Sanity thresholds. Validation rules.

**AI prompt.** "Build anti-cheat: server authority, rate limits, sanity checks, row-locked inventory/gene transactions. Browser has no native anti-cheat."

### T42 · Live Ops — `config/liveops.json`
**Depends on:** T40, T41.

**Must support.** Early-access cadence. Honest "what works now" list. No feature promises. Season cadence and event scheduling. Balance patches.

**Acceptance.** Live ops schedule exists. "What works now" list exists. No feature promises. Season/event scheduling works.

**Config.** Cadence. Event schedule. Patch notes schema. Early-access labeling.

**AI prompt.** "Build live ops: early-access cadence, honest 'what works now' list, no feature promises, season cadence, event scheduling, balance patches."

### C06 · Audio — `config/audio.json`
*(See Part 4, B4 for full spec. Depends on C01.)*

### C09 · Touch Controls and Mobile Layout — `config/controls.json`, `config/ui.json`
*(See Part 4, B4 for full spec. Depends on C04, C05.)*

### C07 · Desktop and Mobile Apps
*(See Part 4, B4 for full spec. Depends on C01–C06, C09, T08C.)*

### H01 · Hardening and Load
*(See Part 4, B4 for full spec. Depends on every Gate 3 task except the real-money Spore switch.)*

### Real-Money Spore Purchase Switch
**Depends on:** T13, T40, T41, T42.

**Must support.** Enable real-money Spore bundles after compliance/anti-cheat/live ops. Prices $5=500, $20=2500, $50=8000, $100=25000. Purchases grant Spores only. No direct standard+ booster purchase. No money-to-standard loophole. Spores are consumed in-game currency, not stored value. If cut, ship store as "coming soon."

**Acceptance.** Purchase flow works; grants Spores transactionally; no pay-to-win bypass; compliance/labeling present.

---

# Part 6 — Configuration

## 6.1 Extended `_meta` schema
All configurable values live in `config/*.json`. Every system has its own file. No value hardcoded. No `rarity` field permitted anywhere.

```json
{
  "_meta": {
    "system": "boosters",
    "version": "2.0",
    "schema": "extended-1"
  },
  "values": {
    "tier_order": {
      "type": "array",
      "value": ["inferior", "common", "standard", "refined", "greater", "superior", "mythical", "legendary", "planetary"],
      "notes": "Fixed tier order. MVP uses first three."
    },
    "tier_definitions": {
      "type": "schema_array",
      "schema": {
        "id": "string",
        "name": "string",
        "price": "number",
        "purchasable": "boolean",
        "account_bound": "boolean"
      },
      "value": [
        { "id": "inferior", "name": "Inferior", "price": 10, "purchasable": true, "account_bound": false }
      ]
    },
    "condition_matrix": {
      "type": "matrix",
      "rows": ["day", "night"],
      "cols": ["sun", "rain", "storm"],
      "value": [[1.0, 1.2, 0.9], [1.1, 1.0, 0.9]],
      "notes": "Conditions only determine best effect; boosts are never wasted. Minimum effect floor min_effect (start 0.5). T07 condition mapping: clear->sun, rain->rain, thunderstorm->storm."
    },
    "item_definitions": {
      "type": "schema_array",
      "schema": {
        "id": "string",
        "category": "enum",
        "enum": ["booster", "gene", "heirloom_seed", "offspring_seed", "starter_pack", "gift_bundle", "essence", "dung", "fertilizer", "gene_stabilization", "mail_attachment", "fragment"],
        "stack_limit": "number",
        "tradeable": "boolean",
        "mailable": "boolean",
        "listable": "boolean",
        "account_bound": "boolean"
      },
      "value": [],
      "notes": "No rarity field. Schema validation rejects rarity."
    }
  }
}
```

## 6.2 Config file list
Every config file named in any task exists in `config/`.

`_meta`, `growth.json`, `root_sight.json`, `net_proto.json`, `network.json`, `world.json`, `resources.json`, `daynight.json`, `mutations.json`, `chat.json`, `emotes.json`, `uproot.json`, `damage.json`, `tumbling.json`, `weather.json`, `session.json`, `inventory.json`, `item_flags.json`, `fragments.json`, `extraction.json`, `account_progress.json`, `achievements.json`, `prestige.json`, `accounts.json`, `reports.json`, `symbiosis.json`, `parasitism.json`, `companions.json`, `archetypes.json`, `spores.json`, `boosters.json`, `marketplace.json`, `genes.json`, `reputation.json`, `guilds.json`, `mail.json`, `gift_packs.json`, `gift_bundles.json`, `ledger.json`, `naming.json`, `heirlooms.json`, `relics.json`, `annotations.json`, `deep_time.json`, `paid_spawn.json`, `minimap.json`, `growth_scale.json`, `terrain.json`, `persistence.json`, `messaging.json`, `status.json`, `observation.json`, `gifts.json`, `spectating.json`, `spectator.json`, `spectating_ui.json`, `water.json`, `campaign.json`, `tutorial.json`, `territory.json`, `clips.json`, `epoch_map.json`, `leaderboards.json`, `climate_memory.json`, `compliance.json`, `anticheat.json`, `liveops.json`, `ops.json`, `controls.json`, `ui.json`, `render.json`, `audio.json`, `profiles.json`, `reproduction.json`.

**Consistency notes.** Spores have no artificial earn cap. Ledger supports erasure with tombstones. Water has no special aquatic mutation categories. Item and gene rarity removed entirely. Booster tier naming fixed. T30/T34/T36 use distinct config files. Standard+ boosters and Essence are account-bound. Starter Packs are account-bound. Gift Bundles are tradeable/mailable/listable but cannot contain account-bound items. **[V5.3] Item enum now includes `fragment` and `offspring_seed`. Fragment flags: tradeable, mailable, listable true; not account-bound. Offspring seed default: account-bound until planted (pending Part 16 item 3).**

## 6.3 Item-flag table (Appendix C update) **[V5.3]**
| Item type | tradeable | mailable | listable | account_bound |
|---|---|---|---|---|
| Starter Pack | false | false | false | true |
| Essence | false | false | false | true |
| Standard+ booster | false | false | false | true |
| Inferior/common booster | true | true | true | false |
| Gene item | true | true | true | false |
| Heirloom seed | true | true | true | false |
| Gift Bundle | true | true | true | false |
| Dung / fertilizer / gene stabilization | true | true | true | false |
| Fragment | true | true | true | false |
| Offspring seed (default, pending Part 16 item 3) | false | false | false | true |
| Mail attachment | follows item | follows item | follows item | follows item |

Rule: `account_bound=true` forces other three false. Gift Bundle contents may not include Starter Packs or any account-bound item. T14, T45, T29, T08A validate server-side.

---

# Part 7 — How to Run an AI Session

## 7.1 Checklist protocol
1. Read Part 2 constraints and Part 3 terms.
2. Find first unchecked task in the build order (Part 4, B2).
3. Build only that task. Do not combine tasks. Do not skip ahead.
4. Return implementation, config file, README of tunables (type/range/default/effect), manual test checklist.
5. Run acceptance. If passes, mark `[x]`. Stop.
6. Next session continue from next unchecked task.
7. If proposing a named feature or proper-noun system, reject and build general capability.

**Dependency order is canonical per Part 4, B5.** Build T08A before T08. Build T03P immediately after T00. Build T16 before T15. Build T15 and T16 before T06A. Build T06A before T20. Build T16 before T43/T44. Build T43 before T44. Build T08B before T46. Build T46 before T28. Build T30 before T34/T36. Build T16 before T17. Build T07 before T13A and T06. Build C01 before T02. Build T08C before T05 and T08A.

## 7.2 Phase 0 Kickoff Checklist
1. Write the 30-second loop in one paragraph, including booster timing.
2. Build two-tab networking prototype (Gate 0).
3. Cut MVP to v5.3 MVP list and write task list.
4. Create `CONTEXT.md` with engine version, file tree, interfaces, locked decisions.
5. Read itch.io/processor rules; write five-line illegal-content policy; write "what spores are" answer.
6. Prototype season time-lapse on 512×512 grid; draft inter-season schedule.
7. Draft `boosters.json` and `genes.json` schemas first. Fix tier naming. Include MVP condition modifiers including thunderstorm.
8. Write death record spec: `{plant_id, parent_seed_id, genes[], season, owner_id}`.
9. Calendar 24/52/80-week gates (or 13/26/52 compressed). If missed: cut features, not gates.

**Never.** Ask AI to build multiple systems at once. Let AI add features not in spec. Accept hardcoded values. Let AI design specific emergent outcomes. Feed secrets file to AI. Let AI build microservices for scale not reached.

---

# Part 8 — Open Questions and Locked Decisions

## 8.1 Open Questions
- Multiplayer 10k scale: LOD, partitioning, or both. Test at Phase 1. Build for 50–100, design for 10k.
- Session vs season: sessions are activity blocks; seasons are tunable intervals.
- Poly symbionts configurable default 3, post-MVP.
- Swarm parasitism multiple parasites MVP.
- Storefront reality: platform compliance layer required if submission attempted.
- Real-money paid spawn: Spores-only first; real-money Phase 9.
- Deep-time simulation rule-based; player-viewable time-lapse stretch goal.
- Underwater physics may need dedicated tuning; T31 remains biome + proximity trigger.
- Campaign story details TBD; environmental narration first.
- Relic rendering stylized LOD sphere, one mesh per World.
- Booster stacking curve: stacking supported; inefficiency tuning property.
- Heirloom gene consumption: consumed vs copied config decision.
- Heirloom cost curve: linear vs supertaxed; recommend supertaxed.
- Spectator caps per target/server.
- Minimap aggregation frequency low-frequency, recommend 5–15 min.
- Profile fields curated highlights only.
- Territory contest/transfer rules post-MVP.
- Guild territory ownership recommend yes post-MVP depends T49.

## 8.2 Locked Decisions
- No in-game livestream integration. Opt-in spectating only. T30 discovery, T34 mode, T36 UI.
- No forced clustering. Geography creates hubs.
- Both world chat and proximity chat in MVP. No global mutation feed.
- No NPC vendors, no game-built market stalls. UI market + emergent player markets.
- No campaign in v1. Post-multiplayer.
- Globe minimap in scope. Server-side aggregation, not renderer.
- Profiles in scope. Cosmetics display + visibility incentive + trade discovery.
- Season length tunable default 36 real days. First number to test.
- Two death types: mid-season death vs season-end death.
- Heirloom is descendant, not continuation. Old plant dead. Descendant carries inherited mutations, ancestor name, compressed history. Gated by inventory genes or Spore retrieval.
- No full revival without genes. Pay Spores to retrieve genes or start new character.
- Heirloom seeds tradable/mailable per flags. Starter Packs are the only newbie-grant item and are account-bound.
- Pre-build supported. Players queue next seed during life or between seasons.
- Movement mutation-gated. Schema supports translocate/parts/drift. Locomotion post-MVP. Movement genes speed re-rooting.
- Tumbling is involuntary unrooting by external force, followed by wind/water-driven tumbling.
- Damage sources weather, roots, tools, herbivores through one pipeline. Tools v2; pipeline accepts `tool` source now.
- Boosters tiered, typed, conditional in MVP, never wasted. Inferior/common purchasable; standard+ account-bound and earn-only. Standard crafting requires earn-only Essence.
- Inventory core system. All item/gene mutations server-authoritative transactions.
- Marketplace UI-only. No physical built market.
- Relics stylized LOD spheres. Personalization ledger, not geometry.
- No general moderation. Illegal-content-only policy is compliance exception.
- No item or gene rarity. Any `rarity` field is bug.
- Companions tamed wild beasts, not intelligent NPCs.
- Territory and symbiosis post-MVP.
- Bloom Opportunity removed.
- Reputation 1–5 star reviews plus optional text.
- Guilds player-formed; anyone can create; roles by senior members; no mechanical buffs.
- Mail for system messages, player mail, Gift Bundle delivery.
- Spore store UI MVP; real-money integration later.
- No permanent unlock from session end. No battle-royale session end.
- Season-end calamity kills every plant; lineage via queued heirloom seed.
- Prestige only from non-consensual drains; weather/herbivore kills credit no one.

**V5.3 / V5.3.1 locked decisions.**

- Platform order: browser first, then desktop app, then mobile app. One shared client codebase. 3D only.
- Client = TypeScript + Three.js. Server = Node.js + TypeScript + Postgres. Desktop/mobile apps are thin wrappers.
- Accounts use username + password at Gate 1; email recovery later.
- Reports are Roblox-style: reason dropdown + free text + context snapshot. Admin triage in T40. Only RULE_6 categories acted on.
- Everything free-first: free static hosting, one free VM for server + Postgres, free assets. Docker-based for portability.
- Heirloom seeds are produced from the player's own plant (flower → seed), plus a mid-season death grant. Season-end calamity does not grant a seed by default.
- Genes can be extracted from fragments, remains, or the player's own living plant, then sold, traded, or grafted.
- Whole-number weeks only. Gates re-baselined to weeks 24 / 52 / 80 (pending approval); week 13 becomes a checkpoint.
- Proximity chat and world chat are both MVP. The Gate 1 cut list no longer lists world chat.
- Scale model: many Worlds, each with a 10,000-player design target; account service is global.
- Performance target: 60 fps on target devices, low battery drain, adaptive quality.
- Controls are context-sensitive. Growth direction is chosen by clicking/tapping the plant part and the target area.
- No gamepad. Remappable keys and text size are MVP. Cheap accessibility extras (never-color-alone, reduced motion) are recommended but not committed.
- Art direction: stylized naturalism.
- All assets free (CC0 / permissive licenses), tracked in `ATTRIBUTION.md`.
- AI-only build. Tasks sized to one AI session each.
- *(v5.3.1)* The Root Sight cutaway shader is implemented by **T02**; **C03** reuses and refines it for general environment cutaways. C03 never provides the shader used by T02.
- *(v5.3.1)* H01 depends on every Gate 3 task **except** the real-money Spore switch.
- *(v5.3.1)* T43 may run against a deferred T14 *UI*, but it requires the T14 seller/listing data model and the named `getSellerReputation` stub. If T14 UI is cut at Gate 2, T14 (or its data model + stub) must land at Gate 3 before T43.
- *(v5.3.1)* The T25 cut order keeps the **T25 core stub** (root tunneling/voids and canopy light-blocking persistence) required by T26; only optional T25 capabilities are cut.
- *(v5.3.1)* Planting a held heirloom seed is owned by **T22** (or a separate post-MVP seed-planting task), **not** T53. T53 covers offspring seeds from cross-pollination only.

---

# Part 9 — Secrets

These are not part of this document. They live in `secrets.md` and are not fed to AI sessions.

The secrets file contains:

- Specific mutation combinations that produce recognizable emergent outcomes.
- Specific environmental pressures that, combined with specific mutations, produce expressive or structural variety.
- Specific conditions under which a plant's growth scale can become enormous.
- Specific interactions between terrain modification and player constructions that produce durable structures and other emergent forms.
- Specific fragment/gene market dynamics that produce interesting player economies (the fragment and gene extraction systems create supply/demand surfaces that must be discovered, not designed).
- Specific cross-pollination gene recombination patterns that produce desirable offspring (T53 is a general capability; the secrets file holds the combinations that matter).

The AI builds the mechanism. The human defines the secrets. The players discover the outcomes. If AI sees secrets, it will design toward them and the game becomes scripted.

---

# Part 10 — Sign-Off

This document replaces v5.3 and all earlier versions as the working master plan. It is written in the spirit of the core belief: build systems, not outcomes; build possibilities, not features; build the sandbox; the players build the castles.

Final rules:

- If a system spec names a specific emergent outcome, rewrite it as general capability.
- If AI proposes a named feature, reject it. Ask for general capability.
- If UI tells players what to do with freedom, remove it. The game does not explain its own depth.
- If UI tells players what is funny, remove it. The game does not tell jokes.
- If UI tells players what is important, remove it. The game does not editorialize.
- If ledger entry is erased, tombstone stays. The world remembers.
- If a gate slips, cut features — never cut the gate.
- If a system requires blind AI acceptance, build weekend prototype first.
- If a system touches items or genes, it is a server transaction.
- If a schema field is named `rarity`, it is a bug.
- If v5.3.1 and an older plan conflict, v5.3.1 wins.
- Client rendering is never authoritative. The server wins; the client corrects without drama.
- Every player-authored surface has a report control and a block control.
- Every gene and fragment records provenance in its ledger. One transaction in, one transaction out.
- Free-first ops. Everything portable.
- **v5.3.1 checkpoint arithmetic:** every checkpoint gap is ≤ 4 weeks. Gate 3 has an explicit playtest week (W78), and Gate 3 arithmetic is **25 task-weeks + 1 playtest + 2 buffer = 28 weeks (W53–80)**.

The best moments will not be designed. They will be discovered. Build the possibility space large enough that there are still new discoveries ten thousand players and ten years in.

**Ready for Phase 0.**

---

# Part 11 — Restored Full Beta Bucket Specs

**Status:** Post-alpha, no gate. These are restored from v4 in full detail, corrected by v5.2/v5.3/v5.3.1 rules: no rarity, item flags, standard+ account-bound, no NPC vendors, no livestream integration, no named emergent outcomes. T53 added per V5.3 and clarified in v5.3.1.

---

## T09 · Symbiosis — `config/symbiosis.json`

**Depends on:** T01, T03, T05, T08A.

**Must support.** Two players can declare a symbiotic root-link. Linked players share a configurable fraction of nutrients. Linked players gain shared vision and shared emote capabilities. Link is public and visible on map/inspection. Either player can sever at any time. Severing costs the severer biomass and publicly notifies the severed party. A plant can link with multiple partners up to configurable maximum.

**Acceptance.** Players can form/break links. Sharing works. Shared vision works. Severing has cost and public notification. Multiple partners supported up to max. No mechanical guild-style buffs.

**Config.** Share rate. Joint vision range. Sever damage. Link formation duration. Maximum partners. Public visibility rules.

**AI prompt.** "Build symbiosis with declared links, resource sharing, shared vision, joint emotes, severing with cost/public notice, multiple partners up to config max. All values in `symbiosis.json`."

---

## T11 · Companion Creatures — `config/companions.json`

**Depends on:** T01, T03, T06, T08A.

**Must support.** Companions are tamed wild beasts/animals, not intelligent NPCs. They attach to a plant and have health, hunger, loyalty. They can be directed to eat pests, pollinate, patrol, harvest, defend, or attack another plant. Hungry companions feed on owner biomass, unclaimed plants, or directed targets. Ignored companions lose loyalty and eventually leave or die. Types are data-driven (worms, insects, birds, small mammals). No dialogue, no quests, no story goals, no judgment.

**Acceptance.** Companions attach, act, and can be lost. Needs must be met. Directable to targets. Multiple types configurable. Hunger/loyalty work. No intelligent-NPC behavior.

**Config.** Damage per tick. Loyalty decay. Hunger decay. Recall cooldown. Max health. Owner feed cost. Companion type schema.

**AI prompt.** "Build companion system with data-driven types. Companions are tamed wild beasts, not intelligent NPCs. They have health, hunger, loyalty, directives. Hungry companions feed on owner biomass/unclaimed plants; ignored companions lose loyalty and leave/die. No dialogue or quests. All config in `companions.json`."

---

## T13B · Full Booster Matrix — `config/boosters.json`

**Depends on:** T13A, T07, T08A, T15.

**Must support.** Full 9-tier ladder: inferior → common → standard → refined → greater → superior → mythical → legendary → planetary. Typed boosts: growth speed, mutation chance, healing specific plant parts, plus future types. Full condition modifier set: day/night, rain/sun/storm (thunderstorm column added in MVP per V5.3), biome modifiers, seasonal windows, additional configured conditions. Boosts are never wasted; conditions only determine best effect; minimum effect floor `min_effect` (start 0.5). Weather forecast dependency live. Visible active-conditions UI. Data-driven. P2W line: inferior/common purchasable and tradeable; standard and above account-bound, earn-only. Standard crafting requires earn-only Essence. Every use is a server transaction against inventory. Healing boosts interface with T06 damage/tumbling pipeline.

**Acceptance.** Full 9-tier ladder. Typed boosts. Full conditional effectiveness with visible active conditions. Forecast live. Purchasable capped at common; standard+ account-bound/earn-only. Data-driven. Never wasted. No rarity field.

**Config.** All nine tiers/prices. All types and duration/charge rules. Full condition modifiers including storm column. Active-condition visibility. P2W cap. Essence crafting. Stacking rules. `min_effect`.

**AI prompt.** "Build full booster matrix per T13B. Nine tiers, typed boosts, full conditional effectiveness including thunderstorm. Conditions in `boosters.json`. Forecast live. Visible active conditions. Inferior/common purchasable/tradeable; standard+ account-bound and earn-only; standard crafting requires earn-only Essence. Never wasted. All values in config."

---

## T18 · Season Relics — `config/relics.json`

**Depends on:** T20, T16, T17.

**Must support.** At season end, capture planet state. Convert to stylized low-fidelity miniature: pre-baked texture on a sphere, one mesh per World. Every human player who played during season receives one personal copy. One relic per human player per season; multiple characters do not earn extra. Relics tradeable per item flags. Relics annotatable when T19 ships. Relics are permanent historical records. Personalization is the ledger, not geometry.

**Acceptance.** Season end produces relic. Every human player in season gets one. Tradeable. Captures major features as stylized LOD sphere. One mesh per World. Post-MVP.

**Config.** Snapshot frequency end-of-season only. Relic rendering resolution tier. LOD threshold. Item flags.

**AI prompt.** "At season end snapshot planet state and convert to stylized LOD globe, one mesh per World. Every human player in season receives one personal copy. Tradeable per flags. Personalization via ledger. All config in `relics.json`."

---

## T19 · Annotation — `config/annotations.json`

**Depends on:** T18, T16, T17, T43, T44.

**Must support.** Players pin annotations to specific relic locations. Text, timestamp, optional media, optional external links. Layered: short public summary + longer detail. Voting weights annotations; community-approved versions rise; vandalism sinks by voting, not moderation. Guilds and notable players can claim official annotations on their own structures. Guild affiliation shown on member-authored annotations. Reputation feeds official-claim threshold. Every annotation has its own ledger of edits. Annotations can be superseded or erased with public tombstone. Never silently deleted. No Bloom Opportunity reference.

**Acceptance.** Annotations pin/edit. Voting weights visibility. Ledgers preserved. Official claims by guilds. Guild affiliation shown. Reputation threshold works. Erasure tombstone. Post-MVP.

**Config.** Annotation max length. Voting window. Reputation threshold for official claims. Guild affiliation display toggle. Compliance policy reference.

**AI prompt.** "Build relic annotation system. Pin notes to locations with text, timestamp, media links. Layered summary/detail. Voting weights visibility. Full edit history per annotation. Guilds with reputation can claim official annotations on own structures. Guild affiliation shown. Reputation feeds threshold. Erasure leaves tombstone. All config in `annotations.json`."

---

## T21 · Paid Spawn — `config/paid_spawn.json`

**Depends on:** T12, T13, T20.

**Must support.** Three tiers: soft biome preference, strong region preference, exact coordinate lock. Purchasable with Spores first; real-money Spore bundles later. Density caps prevent one zone from being bought out. Exact-coordinate locks limited per season per World. No direct power guarantee; spawn location is convenience/agency.

**Acceptance.** Three tiers available. Density caps enforced. Exact locks limited per season/World. Spores-only path ships first.

**Config.** Tier prices. Density caps. Exact lock limits. Season window.

**AI prompt.** "Build paid spawn with three tiers: biome preference, region preference, exact coordinate lock. Spores first; real-money later. Density caps. Exact locks limited per season/World. All config in `paid_spawn.json`."

---

## T22 · Heirloom Seeds, Full / Bloodline — `config/heirlooms.json`

**Depends on:** T06A, T16, T20, T15.

**Must support.** At season end, players can preserve a genetic snapshot. Next season, start as descendant of heirloom's plant with faint visual traits and small bonus. Descendant is new character; old plant died in season-end calamity. Lineage tracked across seasons with visible family trees. Descendant carries ancestor name and compressed edit history. Death records written from MVP onward: `{plant_id, parent_seed_id, genes[], season, owner_id}`. Bloodline tracing is v2: missing genes retrievable by spending Spores to trace bloodline; tracing also lets players drop unwanted genes. Cost scales with gene count; recommend supertax past threshold. Gene removals write ledger entries. Heirloom seeds tradeable/mailable per flags; pre-build on. No rarity field. V5.3: seed production from mature flowers (T06A) is the primary supply; calamity grant defaults false.

**Must also cover (v5.3.1 clarification).** Planting a held heirloom seed is owned here (or by a separate post-MVP seed-planting task). A held heirloom seed may be placed in soil to mark where the descendant will spawn; a planted seed is a world entity the damage pipeline can affect and is not controlled while the player is alive (RULE_1). This is **not** T53.

**Acceptance.** Preservation works. Descendant starts next season with faint traits/small bonus. Lineage visible. Ancestor name/history carried. Death records written. Bloodline tracing works v2. Gene removal ledger entries. Flags enforced. Planting a held seed works as a world entity (or is explicitly deferred with the separate seed-planting task named in the T22 spec).

**Config.** Preservation cost. Bonus magnitude. Visual trait fidelity. Death record schema. Bloodline tracing cost curve. Gene consumption rule. Heirloom seed flags. Pre-build rule. Planting rules.

**AI prompt.** "Build full heirloom/bloodline. Season-end preservation; next-season descendant with faint traits/small bonus/lineage/family tree/ancestor name/history. Death records `{plant_id, parent_seed_id, genes[], season, owner_id}`. Bloodline tracing v2: Spore retrieval and gene dropping; cost scales, supertax threshold. Gene removals write ledger entries. Heirloom seeds tradeable/mailable per flags. Pre-build on. Also own planting a held heirloom seed as a world entity (or name the separate post-MVP seed-planting task). No rarity."
---

## T27 · Persistent Visual Messaging — `config/messaging.json`

**Depends on:** T01, T05, T16.

**Must support.** Players can leave visible marks on world that others see: grown patterns, carved bark, emitted clouds, other general marks. Content player-authored and unmoderated subject to illegal-content-only policy. No preset message types. No named culture tool.

**Acceptance.** Marks persist. Visible to others. UGC policy applies. No named tooling.

**Config.** Mark persistence rules. Visibility radius. Mark type schema. Compliance policy reference.

**AI prompt.** "Build persistent visual messaging. Players leave visible marks: grown patterns, carved bark, emitted clouds. Content UGC subject to illegal-content-only policy. No preset message types. No named culture tool. All config in `messaging.json`."

---

## T28 · One-Way Observation — `config/observation.json`

**Depends on:** T46, T05, T03.

**Must support.** Higher-status player can force lower-status player into temporary shared view for configured duration. Uses T46 status/rank. General capability; no named use case. No editorializing UI. Opt-out/block behavior per config.

**Acceptance.** Works. Duration configurable. Status gate works. No editorializing UI. Block/opt-out respected if configured.

**Config.** Duration. Status gap required. Cooldowns. Opt-out/block behavior.

**AI prompt.** "Build one-way observation. Higher-status player forces lower-status into temporary shared view for configured duration. Uses T46 status. General capability; no named use case. No editorializing UI. All config in `observation.json`."

---

## T29 · Gifting with Hidden Attributes — `config/gifts.json`

**Depends on:** T08A, T14, T45.

**Must support.** Items may carry hidden attributes defined by schema. Hidden attributes activate on receipt. Giver chooses what to send; receiver chooses what to accept. No named trap types. Uses server-authoritative inventory transactions. Enforces item flags. Starter Pack remains T50 and account-bound; not giftable. V5.3: fragments and offspring seeds (if tradeable per **Part 16 item 3**) may carry hidden attributes; Starter Packs and standard+ boosters may not.

**Acceptance.** Schema works. Hidden attributes activate on receipt. Giver/receiver choices respected. Transactions server-authoritative. Flags enforced. No named trap types.

**Config.** Hidden attribute schema. Activation rules. Gift transaction rules. Compliance policy reference. Item flags validation.

**AI prompt.** "Build gifting with hidden attributes. Items may carry hidden attributes activating on receipt. Giver chooses send; receiver chooses accept. No named trap types. Server-authoritative inventory transactions. Enforce item flags. All config in `gifts.json`."

---

## T30 · Opt-In Spectating Discovery — `config/spectating.json`

**Depends on:** T03, T47.

**Must support.** Players opt in to being discoverable as spectating targets. Opt-in setting lives in settings. Builds opt-in list, privacy rules, discoverability metadata. Does not build spectator mode (T34) or spectator UI (T36). No in-game livestream integration.

**Acceptance.** Opt-in list works. Privacy rules work. Discoverability metadata exists. No mode/UI built here. No livestream integration.

**Config.** Opt-in default. Discoverability visibility rules. Target metadata fields. Block/report references.

**AI prompt.** "Build opt-in spectating discovery. Players opt in as discoverable targets. Build opt-in list, privacy rules, discoverability metadata only. Do not build spectator mode or UI. No livestream. All config in `spectating.json`."

---

## T34 · Opt-In Spectator Mode — `config/spectator.json`

**Depends on:** T30, T02, T03.

**Must support.** Read-only state subscription at lower tick rate. Camera targets another player using independent camera entity from T02. Spectators are not players in spatial cells and do not count against 50–100 detailed-plant budget on target's client. Bandwidth capped per target and per server. Uses T30 opt-in list. No livestream integration.

**Acceptance.** Read-only spectator mode works. Camera targets another player. Lower tick rate. Spectators not in spatial cells. Bandwidth capped.

**Config.** Spectator cap per target. Spectator cap per server. Tick rate for spectators. Bandwidth caps.

**AI prompt.** "Build opt-in spectator mode. Read-only state subscription at lower tick. Camera targets another player using independent camera. Spectators not in spatial cells. Bandwidth capped per target/server. Uses T30 opt-in. No livestream. All config in `spectator.json`."

---

## T35 · Clip Recording — `config/clips.json`

**Depends on:** T03, T34.

**Must support.** One-button recording. Auto-highlight detection. Easy export. No in-game livestream integration.

**Acceptance.** Recording works. Highlights detected. Export works. No livestream.

**Config.** Clip length. Highlight thresholds. Export formats.

**AI prompt.** "Build clip recording: one-button recording, auto-highlight detection, easy export. No livestream integration. All config in `clips.json`."

---

## T36 · Opt-In Spectating UI — `config/spectating_ui.json`

**Depends on:** T30, T34.

**Must support.** UI surfaces opt-in spectating targets from T30. UI lets player watch target via T34. No named UI product. No streamer discovery UI as originally specified. No livestream integration. Bandwidth/cap feedback shown.

**Acceptance.** Target browsing works. Watching works via T34. No livestream. No named product.

**Config.** Browse page size. Sort/filter options. Bandwidth display rules.

**AI prompt.** "Build opt-in spectating UI. Surface T30 targets and let player watch via T34. No named UI product. No livestream. All config in `spectating_ui.json`."

---

## T37 · Public Epoch Map — `config/epoch_map.json`

**Depends on:** T48, T16, T20.

**Must support.** Zoomable planet history with layered past seasons. Uses server-aggregated map data from T48 when available. Read-only historical surface.

**Acceptance.** Epoch layers work. Zoom works. Past seasons visible. Read-only.

**Config.** Layer count. Zoom levels. Aggregation source.

**AI prompt.** "Build public epoch map. Zoomable planet history with layered past seasons. Read-only. Uses T48 aggregation when available. All config in `epoch_map.json`."

---

## T38 · Deep-Time Leaderboards — `config/leaderboards.json`

**Depends on:** T08B, T16, T20.

**Must support.** Cross-season records. Config-defined categories. No pay-to-win ranking. No mechanical power.

**Acceptance.** Leaderboards work. Cross-season records persist. Categories config-defined. No P2W ranking.

**Config.** Categories. Scoring formulas. Season windows.

**AI prompt.** "Build deep-time leaderboards. Cross-season records with config categories/scoring. No pay-to-win ranking. All config in `leaderboards.json`."

---

## T39 · Seasonal Climate Memory — `config/climate_memory.json`

**Depends on:** T20, T26.

**Must support.** Previous seasons' damage affects future seasons. Climate memory feeds T20 deep-time transformation. No named outcome.

**Acceptance.** Memory persists. Feeds T20. No named outcome.

**Config.** Memory retention. Effect weights. Transformation hooks.

**AI prompt.** "Build seasonal climate memory. Previous seasons' damage affects future seasons and feeds T20. No named outcome. All config in `climate_memory.json`."

---

## T47 · Profiles — `config/profiles.json`

**Depends on:** T08B, T16, T43, T44, T46.

**Must support.** Player-authored profile with configurable sections. Shows cosmetics, needs, trade wants, curated inventory/gene highlights, guild affiliation, reputation summary, status/rank. Curated highlights only, not full inventory exposure. Visibility switches: location visible, profile visible. Profile content UGC; illegal-content-only policy applies; report/block controls. No item/gene rarity. Guild affiliation shown. Profile is a reportable surface per RULE_29.

**Acceptance.** Profile edits work. Curated highlights work. Visibility switches work. Guild affiliation/reputation shown. UGC policy applies. No rarity fields.

**Config.** Profile section schema. Max lengths. Visibility defaults. Curated highlight limits. Compliance policy reference.

**AI prompt.** "Build player profiles. Show cosmetics, needs, trade wants, curated highlights, guild affiliation, reputation, status/rank. Curated only, not full inventory. Visibility switches location/profile. UGC policy. No rarity. All config in `profiles.json`."

---

## T48 · Globe Minimap — `config/minimap.json`

**Depends on:** T00A, T03, T20.

**Must support.** Server-side aggregation produces low-frequency planet texture summarizing terrain, biome, major structures, territorial claims when territory ships. Client renders texture as globe minimap. Aggregation low-frequency, not per-tick; must not dominate CPU. Minimap shows player location if visibility toggle allows. Shared map; does not reveal individual positions unless opted in. Feeds T20 time-lapse and T18 relic view. Architecture hook exists from Phase 1; UI ships post-MVP.

**Acceptance.** Server aggregation works low-frequency. Client renders globe. Player location respects toggles. Aggregation CPU bounded. Architecture hook exists. UI post-MVP.

**Config.** Aggregation frequency. Texture resolution tier. Visibility rules. CPU budget.

**AI prompt.** "Build server-aggregated globe minimap. Low-frequency planet texture summarizes terrain/biome/structures/territory. Client renders globe. Respect visibility toggles. Low-frequency CPU budget. Architecture hook early; UI post-MVP. All config in `minimap.json`."

---

## T31 · Water Biome — `config/water.json`

**Depends on:** T00A, T01, T04, T06, T07.

**Must support.** Full water biome with own geography, resources, ambient scripted hazards. No special adaptation mechanics. No special mutation categories. Proximity to water adds environmental pressure to existing T04 mutation trigger tables. Shedding uses existing T04 rules. Water-associated mutations discovered through same general paths. Water predators are scripted ambient events, like T06 herbivore swarms; not persistent intelligent agents.

**Acceptance.** Water biome exists with geography/resources/scripted hazards. Proximity feeds T04 triggers. No new mutation categories/adaptation mechanics. Shedding uses T04. Predators scripted ambient events.

**Config.** Biome geography. Resource distribution. Scripted hazard schedule/parameters. Proximity pressure weights. No aquatic mutation categories.

**AI prompt.** "Build water biome. Full water biome with geography/resources/scripted ambient hazards. No special adaptation mechanics or mutation categories. Proximity to water feeds T04 trigger tables. Shedding uses T04. Predators scripted ambient events. All config in `water.json`."

---

## T49 · Territory — `config/territory.json`

**Depends on:** T13, T44, T48, T20.

**Must support.** Players or guilds can claim a region. Claiming costs Spores and has upkeep. Upkeep is Spore sink. Territory control contributes to Spore earning via configured sources. Claims visible on globe minimap when T48 ships. Territory can be contested/transferred per config. Guilds can own territory. No mechanical buffs that create insurmountable power gaps. Territory economic/social, not combat stat. T13 already includes dormant sink/source.

**Acceptance.** Claiming works. Upkeep works. Earn/sink flows work. Minimap visibility when T48 exists. Guild ownership supported. No insurmountable mechanical buffs. No NPC vendors/physical markets.

**Config.** Claim cost. Upkeep cost. Territory earn rates. Contest/transfer rules. Guild ownership rules. Minimap visibility rules.

**AI prompt.** "Build territory. Players/guilds claim regions with Spore cost/upkeep. Earn source and Spore sink. Visible on minimap when T48 exists. Guilds may own. No insurmountable buffs. No NPC vendors/physical markets. All config in `territory.json`."

---

## T32 · Campaign — `config/campaign.json`

**Depends on:** Post-MVP only; requires T01–T08A and core systems stable.

**Must support.** Campaign on separate planet from multiplayer; no shared World/world state. Narrative with NPC plants/humans/aliens allowed in campaign only. Missions have clear goals/victory conditions. Solo and co-op 2–4. Campaign progress unlocks multiplayer content: archetypes, gene hints, cosmetics. Speedrun-friendly with leaderboards.

**Acceptance.** Separate planet. NPCs exist in campaign. Missions have clear victory conditions. Solo/co-op supported. Progress unlocks multiplayer content. Speedrun leaderboards.

**Config.** Campaign mission schema. Co-op player count. Tutorial mission ID. Unlock mapping.

**AI prompt.** "Build campaign mode on separate planet. Missions clear victory conditions, solo/co-op 2–4, NPCs allowed. Progress unlocks multiplayer archetypes/gene hints/cosmetics. Speedrun leaderboards. All config in `campaign.json`."

---

## T33 · Tutorial — `config/tutorial.json`

**Depends on:** T32, T00A, T01, T02, T04, T05, T14.

**Must support.** First hour integrated into first campaign mission. Minutes 0–15: awakening, germination, dual-layer growth, Root Sight, first defense. 15–30: first competition for light/space, first weather event, first forecast read. 30–45: first mutation, first social prompt, marketplace introduction. 45–60: first campaign objective, unlock next mission. Skippable; auto-triggers on new accounts. No Bloom Opportunity reference. No undefined territory reference; use "competition for light/space."

**Acceptance.** Covers four teaching blocks. Integrated into first campaign mission. Skippable. Auto-triggers for new accounts. No Bloom Opportunity. No undefined territory.

**Config.** Total duration. Skip allowed. Auto-trigger. Teaching block checkpoints.

**AI prompt.** "Build 60-minute tutorial integrated into first campaign mission. Teach dual-layer growth, Root Sight, mutation, social prompts, marketplace in four blocks. Skippable, auto-triggers on new accounts. No Bloom Opportunity or undefined territory. All config in `tutorial.json`."

---

## T53 · Reproduction and Offspring Seeds (Beta, V5.3 new; v5.3.1 clarification) — `config/reproduction.json`

**Depends on:** T51, T06A, T09 optional.

**Must support.** Cross-pollination: two plants with open flower nodes within range can exchange pollen if both players accept (a consent prompt). Result: each side may produce an **offspring seed**. Offspring seed carries a **blueprint** made by recombining a configured number of genes from both parents. It is a different item from the heirloom seed. Planted offspring seeds become a new plant for the planting account, per the same spawn flow as heirloom seeds. Planted seeds are world entities the damage pipeline can affect. No named features.

**v5.3.1 clarification.** T53 covers offspring seeds produced by cross-pollination only. It does not cover planting a held heirloom seed; that is owned by T22 (or a separate post-MVP seed-planting task).

**Conflict to resolve (Part 16 item 3).** v5.2 forbids a bought seed from importing someone else's build. An offspring seed does exactly that by design. Safe defaults: `account_bound = true` until planted, or tradeable but with a small capped gene count. Pick one before building T53.

**Acceptance.** Consent required; blueprint size capped; planted seeds affected by the damage pipeline; no named features. Flags per approved Part 16 item 3 decision.

**Config.** Pollination range. Consent prompt behavior. Recombination gene count cap. Offspring seed flags. Planted-seed lifecycle.

**AI prompt.** "Build T53 reproduction: cross-pollination with consent, offspring seeds with recombined blueprint (capped), planted seeds as world entities affected by the damage pipeline. T53 covers offspring seeds only, not planting a held heirloom seed. Flags per approved Part 16 item 3 decision. No named features. All config in `reproduction.json`."

---

# Part 12 — V5.3 / V5.3.1 Decision Log

Each row is a decision made (or that follows directly from answers). "Needs approval" rows are listed again in Part 16.

| ID | Decision | Source |
|---|---|---|
| D-01 | Launch order: browser first, then desktop app, then mobile app. Mobile browsers remain playable but are not optimized for. | User answer |
| D-02 | Client = TypeScript + Three.js. Server = Node.js + TypeScript + Postgres. Desktop/mobile apps are wrappers around the same web client. | User answer + recommendation |
| D-03 | Add client rendering tasks (renderer, camera rig, procedural plants, environment, HUD, menus, audio, packaging). | Gap closed |
| D-04 | Add accounts (T08C). Username + password at Gate 1; email recovery later. | User answer |
| D-05 | Add a Roblox-style report flow (reason + extra text, attached chat context) in T05; admin triage in T40. | User answer |
| D-06 | Everything free: free static hosting for the client, one free VM for server + Postgres, free assets. | User answer |
| D-07 | Add `profiles.json` (and other new config files) to the config list. | Gap closed |
| D-08 | Add a thunderstorm column to the booster condition matrix. | Gap closed |
| D-09 | Heirloom seeds are produced from the player's own plant (flower → seed), plus a death grant. | User answer |
| D-10 | Genes can be extracted from anything in inventory (fragments of plants, remains, own plant), then sold, traded, or grafted. New task T51. | User answer |
| D-11 | Whole-number weeks only. Schedule re-run with client work included; gates re-baselined to weeks 24 / 52 / 80 (needs approval). Week 13 becomes a visible checkpoint. | User answer |
| D-12 | Proximity chat and world chat are both MVP. The Gate 1 cut list no longer lists world chat. | User answer |
| D-13 | Scale model: many Worlds, each with a 10,000-player design target; account service is global. Online players must not feel offline simulation. | User answer + design |
| D-14 | Performance target: 60 fps on target devices, low battery drain, adaptive quality. | User answer |
| D-15 | Controls are context-sensitive (e.g. reroot controls appear only when uprooted). Growth direction is chosen by clicking/tapping the plant part and the target area. | User answer |
| D-16 | No gamepad. Remappable keys and text size are in the MVP. Other accessibility options are not required, but cheap ones are recommended in Part 19. | User answer |
| D-17 | 3D only. | User answer |
| D-18 | Art direction: blend of stylized and realistic ("stylized naturalism"). | User answer |
| D-19 | All assets free (CC0 / permissive licenses, tracked in an attribution file). | User answer |
| D-20 | AI-only build. Tasks sized to one AI session each, and the user is the final decision-maker. | User answer |

**v5.3.1 correction rows.**

| ID | Decision | Source |
|---|---|---|
| D-21 | Checkpoint table rebuilt so every gap ≤ 4 weeks; final sign-off claim made true. | Review #1 |
| D-22 | Gate 3 gets an explicit playtest week (W78) and corrected arithmetic (25 task-weeks + 1 playtest + 2 buffer = 28 weeks; W53–80). | Review #2 |
| D-23 | Gate 3 cut list keeps the T25 core stub required by T26; only optional T25 capabilities are cut. | Review #3 |
| D-24 | Gate 2 cut list keeps the T14 seller/listing data model and `getSellerReputation` stub if T14 UI is cut; T43 cannot start without seller/listing identity. | Review #4 |
| D-25 | T02 owns the Root Sight cutaway shader; C03 reuses/refines it. C03 gains T00A in its dependency row. | Review #5 |
| D-26 | H01 depends on all Gate 3 tasks except the real-money Spore switch. | Review #6 |
| D-27 | Stale `A…` references replaced with real Part/Task references (see Appendix F). | Review #7 |
| D-28 | T15 no longer defers extraction to post-MVP; T51 owns extraction/graft, T14 owns gene listing, T22 owns bloodline. | Review #8 |
| D-29 | Vocabulary rows for heirloom seeds and gene items updated to match built systems. | Review #9 |
| D-30 | Dependency matrix completed: `C03`, `C05`, `C02b`, `T14`, `T20`, `T43`, `H01`. | Review #10 |
| D-31 | Duplicate Part 8.2 heading and merge artifact removed. | Review #11 |
| D-32 | RULE_16 checkpoint weeks corrected to W13 / W36 / W67. | Review #12 |
| D-33 | Heirloom-seed planting separated from T53 offspring seeds; owned by T22 (or a separate post-MVP task). | Review #13 |

---

# Part 13 — Platform, Tech Stack and Scale

## 13.1 Recommendation (D-02)

**TypeScript everywhere. Three.js client. Node.js server. Postgres.**

| Layer | Choice | Why |
|---|---|---|
| Client renderer | Three.js (WebGL2; optional WebGPU renderer later) | Runs in every browser with no install, smallest download, best AI-assistance coverage, and full control over procedural meshes and custom shaders. |
| Client UI | HTML/CSS overlay (Preact or plain TS components) | Text scaling, key remapping, chat, inventory and menus are far easier in DOM than in canvas, and they stay crisp on every device. |
| Client build | Vite + TypeScript | Fast iteration, easy static hosting. |
| Network | WebSocket now (binary messages). WebTransport later if needed. | Works in all browsers. |
| Server | Node.js (current LTS) + TypeScript | Shares types and config schema with the client. Same language means one AI context. |
| Simulation data | Typed arrays / structure-of-arrays, spatial hash grid | Avoids garbage-collection pauses at scale. |
| Database | Postgres (self-hosted on the same free VM) | Matches RULE_14 and RULE_17 (row-level locking). |
| DB access | A typed query builder plus plain SQL migrations | Easy for AI to generate and audit. |
| Desktop app | Electron (consistent Chromium WebGL). Tauri is a lighter alternative but uses each OS's own webview, which makes WebGL performance less predictable. | Consistency matters more than size for a WebGL-heavy game. |
| Mobile app | Capacitor wrapping the same client | One codebase; native haptics, safe areas, full-screen. |
| Packaging for "no browser chrome" on phones | PWA (standalone mode) | Removes browser UI without an app store. |

## 13.2 Why Not Godot or Unity (Honest Comparison)

| | Three.js stack | Godot | Unity |
|---|---|---|---|
| Browser first (D-01) | Native | Web export works but the download is large and threading needs special server headers; mobile-browser support is weakest | WebGL build is heavy and mobile browsers are not an officially supported target |
| Server-authoritative MMO style | Server is the same language as client | Needs a separate server project and a separate language or a headless export | Needs a separate server and C# stack |
| Thousands of plants in one area | You control the data layout and LOD yourself | Possible but you fight the scene tree at that count | Possible with ECS (DOTS) but complex |
| AI-assisted coding | Excellent (huge public coverage) | Good (GDScript docs exist, smaller corpus) | Good, but heavy editor workflow that AI cannot drive |
| Built-in editor, physics, animation | **None.** You assemble everything. | Yes | Yes |
| Downside | More to build (cameras, UI, asset pipeline), manual GC care | Web is its weakest platform | Web and mobile-web are its weakest |

**Verdict:** for a browser-first, server-authoritative, procedurally generated, many-player 3D game built with AI, Three.js is the better fit. The cost is building tools an engine would provide; that cost is paid by the C-series tasks in Part 4, B4. Babylon.js is a reasonable alternative with more built-in tooling (inspector, GUI, physics); the plan does not depend on Three.js specifics beyond C01–C03, so a swap remains possible.

## 13.3 Honest Limits of This Stack

- JavaScript garbage collection can cause hitches. Rule: **no per-frame allocations in hot paths; use object pools and typed arrays** (enforced in code review checklists).
- No built-in physics: tumbling (T06) uses a small custom solver on the server for authority and a cosmetic solver on the client.
- WebGL on mobile browsers has tight memory limits (especially iOS Safari). The mobile budget is deliberately lower.
- Phone browsers cannot hide their own UI without PWA install; recommend "Add to Home Screen" in the first-spawn card on mobile (does not explain game depth, so RULE_13 holds).
- Vibration API is unavailable on iPhone browsers; haptics arrive with the Capacitor app.

## 13.4 Performance Targets (Starting Values — Tune in Playtests)

| Device class | Target | On-screen triangles | Draw calls | Detailed (L0) plants | Texture memory | Downstream bandwidth |
|---|---|---|---|---|---|---|
| Desktop (mid GPU, 2018+) | 60 fps | ≤ 1.5 M | ≤ 400 | up to 100 | ≤ 512 MB | ≤ 60 KB/s |
| Phone (mid-range, 2021+) | 60 fps, adaptive | ≤ 400 K | ≤ 150 | up to 40 | ≤ 192 MB | ≤ 30 KB/s |
| Low-end fallback | 30 fps lock offered | ≤ 150 K | ≤ 80 | up to 15 | ≤ 96 MB | ≤ 20 KB/s |

Battery rules: pause rendering when the tab is hidden; drop to 30 fps automatically when idle (no input for a configured time) and restore on input; dynamic resolution scaling (never below a configured floor) before reducing detail; no always-on full-screen post-processing on phones; offer a player-selectable "battery saver" (30 fps) but default stays 60 fps.

## 13.5 Scale Model (D-13)

- One **World** = one process + one Postgres, design target **10,000 players** (RULE_14). Players do not need to be all awake: most are offline plants.
- "Tens of millions of players" is reached by **running many Worlds** and keeping accounts global. The MVP builds exactly one World, but every table includes `world_id` and the account service never assumes a single World. Cross-World travel is out of scope.
- 10,000 players in one visible area is a **client** limit, not a server limit: no client can show 10,000 detailed plants. Interest management and LOD make a crowded area *look* huge while each client only receives and renders a bounded set.

## 13.6 Simulation Tiers (Offline Simulation Without Lag)

| Tier | Who | Tick | Notes |
|---|---|---|---|
| Active | Online plants + anything touching them | Full tick (config, default 20 Hz) | Full growth, damage, resources. |
| Near | Offline plants within interaction range of an Active plant, or inside a weather/herbivore event | Reduced (config, default 5 Hz) | Needed so offline plants can be damaged by neighbors. |
| Dormant | All other offline plants | Coarse step + event wake-ups | Resource flows computed with closed-form or large time-steps (for example one step per 10–60 s); woken immediately when damage, weather, or a rival root reaches them. |

Rules:

1. A fixed **tick budget** is split between tiers. If the tick runs long, Dormant work is delayed first, then Near. Active work is never delayed by offline work.
2. Dormant plants use **catch-up integration** when they wake (compute elapsed resource gain/upkeep analytically) instead of replaying every missed tick.
3. Offline damage uses `offline_damage_multiplier` (T03).
4. The server records **tick duration, per-tier cost and queue depth** each second, and warns when Active work exceeds a configured share of the budget. This is how "online players don't notice" is proven.

## 13.7 Interest Management and Level of Detail

- Space is split into **cells** (config, default 64×64 world units). A client subscribes to its cell plus a ring of neighbors (config radius).
- Per-client **entity cap** (config; default matches 13.4). If more plants are in range, the server sends L1/L2 summaries for the rest.
- **Distance bands** → detail levels:
  - **L0** (near): full node graph, procedural mesh, IK/animation cosmetics. Updated at network rate.
  - **L1**: simplified graph (trunk + major branches), no leaf instancing detail. Low update rate.
  - **L2**: impostor (billboard or low-poly proxy). Position, size, health bucket only.
  - **L3**: a dot on the globe minimap texture (T48 aggregation, post-MVP).
- Spectators (T34) are never in spatial cells.

## 13.8 Protocol (T03P Decides, T03 Implements)

- Binary frames: `[version:u8][type:u8][payload]`. Hot messages (positions, node growth deltas, resource ticks) are hand-packed with **quantized integers** (positions to 1/64 unit, angles to 16 bits). Cold messages (chat, inventory, menus) may use a generic binary encoder behind the same codec interface.
- Client sends **intents** (grow here, toggle Root Sight, use item). Server replies with state changes and an `ack`/`reject` with reason code. Client prediction only for camera and self-movement.
- **Delta + keyframe:** full state on subscribe, deltas after, a keyframe every N seconds to heal packet loss/desync.
- **Rate limits** per message type (config) from day one; protocol version mismatch gets a friendly "update required" screen.
- Compression: none on the hot path (small quantized packets); optional compression for large cold payloads.

## 13.9 Persistence

- **Do not store one DB row per node.** A plant has up to 200k nodes. Store each plant's node graph as a compact **binary snapshot** (a `bytea` column) plus a short **append-only event log** since the last snapshot; compact periodically. Items, genes, ledger, mail and listings are normal relational rows.
- Snapshots are written on a schedule and on logout/death; the schedule is time-sliced so it never spikes a tick.

---

# Part 14 — Client Rendering

## 14.1 Procedural Plant Rendering (C02) — The Unified Organism Architecture

> **Design Alignment:** Based on the procedural creature architecture demonstrated in *Hatched* by SublimeOrange (`https://www.reddit.com/r/IndieDev/comments/1x9mmly/im_a_solo_dev_building_hatched_a/`, `https://sublimeorange.itch.io/hatched`), adapted for botanical organisms.

### 14.1.1 The Idea: Primitives Fused into a Uniform Organism

The server sends a plant's **node graph** (position, type, radius, parent, age, health, mutation visual flags). The client builds the organism's body from that graph in real time.

**The Golden Principle:** Players and their plants are constructed from modular mathematical primitives (tapered capsules, joint spheres, root crowns, leaf blades), but they **must never look like floating, disconnected, colored primitive parts clipping into each other**. Instead, a specialized **organism fusion shader** blends the primitive components into a single, cohesive, living anatomical membrane with seamless organic junctions.

### 14.1.2 Signed Distance Fields (SDF) and the Smooth Minimum (`smin`) Operator

Rather than generating separate polygonal cylinders with flat end-caps that clip through each other at angles, the primary rendering architecture for L0/L1 plants uses **Raymarched Signed Distance Fields (SDF)** evaluated within a local Bounding Box volume:

1. **Primitive Distance Functions:**
   - **Tapered Capsule / Cone (`sdCapsule`):** Swept segment between parent node $\mathbf{a}$ and child node $\mathbf{b}$ with radii $r_a, r_b$ derived from node biomass:
     $$\text{sdCapsule}(\mathbf{p}, \mathbf{a}, \mathbf{b}, r_a, r_b) = \left\| (\mathbf{p} - \mathbf{a}) - (\mathbf{b} - \mathbf{a}) \cdot h \right\| - \text{mix}(r_a, r_b, h)$$
     where $h = \text{clamp}\left(\frac{(\mathbf{p} - \mathbf{a}) \cdot (\mathbf{b} - \mathbf{a})}{\|\mathbf{b} - \mathbf{a}\|^2}, 0.0, 1.0\right)$.
   - **Joint Spheres (`sdSphere`):** Spherical padding at node junctions and a root crown ellipsoid at $y = 0$ anchoring the plant through the soil boundary:
     $$\text{sdSphere}(\mathbf{p}, \mathbf{c}, r) = \|\mathbf{p} - \mathbf{c}\| - r$$
   - **Parametric Foliage / Leaves:** Flattened teardrop ellipsoids attached seamlessly to branch/stem nodes.

2. **The Fusion Operator — Polynomial Smooth Minimum (`smin`):**
   Neighboring primitives are united using Inigo Quilez's polynomial smooth minimum:
   $$\text{smin}(a, b, k) = \text{mix}(b, a, h) - k \cdot h \cdot (1.0 - h)$$
   $$h = \text{clamp}\left(0.5 + 0.5 \cdot \frac{b - a}{k}, 0.0, 1.0\right)$$
   where $k$ is the tunable organic blend radius (configured in `plant_renderer.json`).
   - **Seamless Property Interpolation:** The fusion operator interpolates not only distance $d$, but also surface type (root vs stem vs leaf), tissue health, and player ownership (`isOwnPlant`), allowing bark, leaf petiole, and taproot colors to melt into each other without harsh seam boundaries.
   - **Branch Junctions:** Where two or more branches fork from a trunk, `smin` automatically synthesizes smooth, organic branch collars/fillets without any mesh topology holes, overlapping z-fighting faces, or visible seams.

3. **Bounding Volume Raymarching & Depth Integration:**
   - The shader executes on an oriented/axis-aligned Bounding Box mesh that tightly encloses all nodes of the plant plus blend padding ($k$). Pixels outside the bounding box are never raymarched, maintaining 60 fps performance.
   - Sphere tracing steps through the distance field. When a ray hits ($\text{dist} < \epsilon$), the true world-space position is transformed to clip space and written directly to `gl_FragDepth`:
     $$\text{clip} = \mathbf{P} \cdot \mathbf{V} \cdot \begin{bmatrix} \mathbf{p}_{\text{hit}} \\ 1 \end{bmatrix}, \quad \text{gl\_FragDepth} = \frac{\text{clip}.z}{\text{clip}.w} \cdot 0.5 + 0.5$$
     This guarantees pixel-perfect depth testing against the ground plane, grid lines, and other scene geometry.
   - Surface normals are evaluated via central differences gradient:
     $$\mathbf{n} = \text{normalize}\left(\begin{bmatrix} d(\mathbf{p} + \epsilon \mathbf{e}_x) - d(\mathbf{p} - \epsilon \mathbf{e}_x) \\ d(\mathbf{p} + \epsilon \mathbf{e}_y) - d(\mathbf{p} - \epsilon \mathbf{e}_y) \\ d(\mathbf{p} + \epsilon \mathbf{e}_z) - d(\mathbf{p} - \epsilon \mathbf{e}_z) \end{bmatrix}\right)$$

### 14.1.3 The "One Shader to Bind Them All" (Material, Noise & Root Sight)

A single shared shader material evaluates the entire organism:

- **Continuous 3D Triplanar Noise:** 4-octave Fractional Brownian Motion (fbm) noise perturbs the surface normal and color in 3D world coordinates. Because coordinates are evaluated in 3D world space rather than UV coordinates, textures flow seamlessly across joints with zero stretching or visible seams.
- **Dynamic Wind Displacement:** Ray query positions $\mathbf{p}$ are displaced prior to distance evaluation using a time-varying coherent wind field. Sway magnitude scales smoothly with height $y$, giving the plant organic, fluid motion with zero CPU animation cost.
- **Continuous Root-to-Canopy Transition & Root Sight (T02):**
  - The subterranean root system ($y < 0$) and the canopy ($y > 0$) form a single, unbroken physical continuum through the soil plane.
  - When **Root Sight** is activated, the ground plane cutaway opens, and the shader illuminates the subterranean root system of the organism:
    - Viewer's own roots highlight in `uOwnRootHighlightColor` (`#4CAF50`).
    - Rival roots highlight in `uRivalRootHighlightColor` (`#FF5722`).
- **Stylized Naturalism Lighting (Part 19):**
  - Sun directional light + hemispheric ambient light.
  - Subsurface scattering approximation (translucent backlight through foliage and tender stems).
  - Subtle rim lighting for silhouette readability.
  - Health tinting (desaturating toward brown/wilted tones as health drops).
  - Three mutation visual signatures (bioluminescent emissive glow, thickened bark, variegated leaf coloration).

### 14.1.4 Where IK Belongs in a Plant Game

Plants mostly do not walk, so IK is used for the **moving moments**, all **cosmetic (RULE_27)**:

- **Reroot crawl and tumbling (T06):** root tentacles that reach, grip and pull. Use a simple chain solver (FABRIK or CCD) per root tip. Gait is driven by the server's crawl direction/speed.
- **Vines and tendrils:** reach toward the growth target; wrap around an object with a spring-chain.
- **Leaf and flower orientation** toward the sun (simple look-at with smoothing, not IK).
- **Companions (T11, later):** the creature locomotion case IK was made for.

Do **not** run IK on every node of every plant; run it only for L0 plants and only for nodes tagged "moving."

### 14.1.5 Level of Detail and Performance Rules

- Ring count, leaf count and curve smoothing scale with distance bands (13.7).
- L1 merges a plant into one buffer; L2 is an impostor refreshed only when the plant's shape changes meaningfully.
- Geometry budgets per plant at L0 are config values (start: 40 K triangles desktop, 12 K phone).
- GPU instancing everywhere possible; one material per detail level; no per-plant materials.
- Update rate for animation scales down with distance.

## 14.2 Cameras

One **CameraRig** with a stack of controllers; the camera is always an independent entity (existing locked decision).

| Camera | Used for | Controls summary |
|---|---|---|
| Orbit | Default, follows own plant | Orbit, zoom, pan; recenter on plant |
| Root Sight | Underground cutaway (T02) | Same controls; cutaway sphere follows camera target |
| Spectator (T34, later) | Watching an opted-in player | Read-only; orbit around target |
| Map / globe (T48, later) | Planet-scale view | Drag to rotate globe, pinch/scroll to zoom |
| Time-lapse (T20) | Season-end replay | Scripted path with free orbit allowed |
| Clip (T35, later) | Recording | Smooth auto-framing |

Rules: switching cameras never changes plant state; camera positions are never sent as plant intents; other players cannot see your camera mode; camera smoothing and collision with terrain are config values.

## 14.3 Root Sight Shader Ownership (v5.3.1 clarification)

The **Root Sight cutaway shader is implemented by T02** and used by T02's camera mode. **C03 reuses and refines** it for general environment cutaways (terrain slicing, spectator cutaways if needed). C03 does not provide the shader used by T02. This ordering matters because T02 is scheduled (W13) before C03 (W15), and because the Root Sight look is defined in Part 19.6 and must be stable before environment polish begins.

---

# Part 15 — Hosting and Ops (All Free First)

Free tiers change often. These were checked in November 2026 and must be re-checked on the day of choice.

| Need | Free option | Caveat |
|---|---|---|
| Client (static files) | GitHub Pages or Cloudflare Pages | Static only. Fine for the whole web client. |
| Game server + Postgres | **One free VM running both** (plan with Docker so you can move) | Oracle's Always Free ARM allowance was reported cut in mid-2026 from 4 OCPU / 24 GB to 2 OCPU / 12 GB, with some conflicting reports; check your console before committing. Idle-instance reclaim policies exist. |
| Managed Postgres | Neon and Supabase have free tiers | Poor fit for an always-simulating world: about 0.5 GB storage, scale-to-zero or auto-pause behavior. Use only for dev/staging. |
| Backups | Daily `pg_dump` pushed to a free object-storage tier | Keep two copies in two places. Test a restore at every gate. |
| Domain and TLS | Free subdomain + free certificates (Let's Encrypt) | A custom domain costs a few dollars/year; optional. |
| CI | GitHub Actions free minutes | Lint, type-check, unit tests, config validation. |
| Error logs/metrics | Self-hosted logs + simple dashboard | Do not add paid monitoring. |

**Honest note:** a free VM is fine for the Gate 1 (50-player) playtest and likely Gate 2. A public alpha with real-money purchases and real players will probably need paid hosting. Plan for it: purchases fund it, and the Docker-based setup (RULE_31) makes the move a one-day job.

**O01 (Gate 0–1):** repo, CI, container build, deploy script, staging URL.
**O02 (Gate 2):** database migrations, scheduled backups, restore test, health checks, tick-budget dashboard.

---

# Part 16 — Open Decisions Needing Approval

1. **Calamity seed rule.** Default: no automatic seed at season end; you must have produced and queued one. Alternative: grant one so nobody loses lineage. Which?
2. **Graft balance.** Genes bought with Spores can be grafted onto living plants. Keep (default, with limits), or restrict grafting to genes the player has personally carried (`graft_requires_prior_carry=true`)?
3. **Offspring seed trading.** Account-bound until planted (default), or tradeable with a capped gene count?
4. **Gate dates.** Accept 24 / 52 / 80, or use the Compressed Plan (13/26/52 with larger cuts)?
5. **Age gate and legal.** Minimum age, terms, privacy policy, and payment provider depend on country and storefront. Decide before public alpha.
6. **`spore_sac` function.** v5.2 renamed it but never says what it does. Suggested default: it emits spores used for cross-pollination range in T53 (Beta). Keep, change, or cut?
7. **Worker threads.** Approve only if profiling shows the single thread cannot hold the tick budget.
8. **Accessibility extras.** Part 19 lists cheap options (non-color cues, reduced motion). They are optional. Opt in or out.

---

# Part 17 — Controls

*All values below are **starting values** to be placed in `controls.json` and tuned in playtests (RULE_3).*

## 17.1 Interface Principles (Binding)

1. **The player is the plant (RULE_1).** The HUD reads like senses and body state, not like a game menu on top of a character.
2. **The UI never editorializes (RULE_13).** No "great job", no "danger!", no tips about strategy, no jokes, no celebratory fanfare. Messages are plain statements of fact ("Plant Fernwick attached to you.").
3. **No rarity display (RULE_20).** Booster potency grades are shown as a plain name plus a numeric grade (for example "Common · grade 2"). Grades are **never** color-coded like rarity tiers.
4. **Context first.** Actions appear only when they are valid (reroot controls only while uprooted; parasitize only near a valid target). Nothing is shown that cannot be used right now.
5. **Server data only.** The HUD displays server-confirmed values. It never decrements or predicts item counts (RULE_17).
6. **Small footprint.** Phones lose a lot of screen to browser chrome, so the HUD stays compact and collapsible; the world stays visible.
7. **Never color alone.** Every color-coded element also has an icon, label, shape or pattern (cheap, and required for Root Sight rival roots).
8. **One shared design language** for desktop, browser and mobile apps, scaled by tokens.

## 17.2 Input Model — Actions, Not Keys

The input layer works on **named actions**. Keyboard, mouse and touch are producers; `controls.json` maps them. Gameplay code never reads raw keys.

| Action ID | Meaning | Available when |
|---|---|---|
| `camera_orbit` / `camera_pan` / `camera_zoom` / `camera_recenter` | Move the camera, not the plant | Always |
| `select_part` | Select a node/tip of your plant | Plant alive |
| `grow_target` | Set the growth target (point or direction) for the selected part | A growable part is selected |
| `grow_cancel` | Cancel current selection or target | Selection or target active |
| `prune` | Remove selected part (confirm if large) | Part selected |
| `root_sight_toggle` | Surface ↔ underground view | Always |
| `reroot_steer` | Steer uprooted plant toward soil | **Only** in uprooted, tumbling or re-rooting states |
| `parasitize` | Attempt attach to a nearby eligible plant | **Only** near an eligible target |
| `shake_off` | Shake off a parasite | **Only** while hosting one |
| `use_booster_1..5` / `booster_panel` | Use booster slot / open panel | Booster owned |
| `mutations_panel` | View mutations, upkeep, shed | Always |
| `emote_wheel` | Open emote wheel | Always (some emotes require mutations) |
| `chat_open` / `chat_channel_next` | Chat input / switch proximity ↔ world | Always |
| `inventory_open`, `ledger_open`, `marketplace_open`, `mail_open`, `guild_open`, `map_open` | Open panels | Panel exists for the current build |
| `report_open` | Report a message, player, listing, etc. | A reportable thing is targeted |
| `menu_open` | Settings and system menu | Always |

## 17.3 Context Rules (D-15)

- The **context dock** (bottom-center) lists only currently valid actions. When an action becomes valid, it appears with a soft 150 ms fade; when invalid it fades out. Nothing pulses or flashes to draw attention (RULE_13).
- Growth is an **explicit two-step pointing interaction**: choose the part, then choose the place. There is no "auto-grow" button that makes decisions for the player.
- Conflicting inputs are resolved by priority: modal dialogs > text input > context actions > camera.

## 17.4 Desktop Controls (Defaults, All Rebindable)

| Action | Default | Notes |
|---|---|---|
| Orbit camera | Right mouse drag | Rotates around the camera target |
| Pan camera | Middle mouse drag, or Shift + right drag, or **W A S D** | Camera moves; the plant never does |
| Rotate camera left/right | Q / E | Optional keyboard rotation |
| Zoom | Mouse wheel | Smooth, clamped by config |
| Recenter on own plant | Space | Also double-click on empty ground |
| Select a part | Left click on a node or tip | Hover shows a plain outline |
| Set growth target | Left click on the target point/area after selecting | Preview line shows cost and expected time |
| Cancel | Esc, or right-click without dragging | |
| Prune selected part | X | Confirm dialog above a configured size |
| Root Sight | Tab (toggle) | Config option: hold-to-peek |
| Reroot steer | W A S D / arrow keys | Appears only when uprooted, tumbling, or re-rooting |
| Parasitize / shake off | F | Context only |
| Boosters | 1–5, B for panel | Slots show conditions currently active |
| Mutations panel | V | |
| Emote wheel | Hold G, release over an emote | |
| Chat | Enter to open, Tab switches channel while typing, Esc closes | Last-used channel remembered |
| Inventory | I | |
| Ledger | H | |
| Marketplace | P | Appears once T14 is built |
| Mail | J | Appears once T45 is built |
| Guild | U | Appears once T44 is built |
| Map | M | Appears once T48 is built |
| Report (context) | Right-click a name tag or chat message → Report | |
| Menu / settings | Esc when nothing else is open | |

Notes:

- Using WASD for camera panning and for reroot steering is deliberate: both are "move something with your hand" actions and never apply at the same time (reroot steering takes over when the plant is uprooted).
- All keys appear in a **rebinding screen** in Settings. Conflicts are shown plainly and must be resolved before saving.

## 17.5 Mobile Controls (Touch)

**Orientation:** landscape is the primary layout; portrait is supported with a compact HUD.
**Where used:** the PWA (standalone, no browser chrome) and the Capacitor app. Mobile browsers work but lose screen to their UI; the first-spawn card on mobile suggests "Add to Home Screen" (no depth explained).

| Action | Gesture / control |
|---|---|
| Orbit | One-finger drag on empty space |
| Zoom | Pinch |
| Pan | Two-finger drag |
| Rotate | Two-finger twist (optional, config) |
| Recenter | Double-tap empty space, or recenter button |
| Select a part | Tap a node/tip (enlarged touch hit area, config) |
| Set growth target | Tap the target after selecting; a preview line appears with cost and time |
| Confirm / cancel | Dock shows **Cancel** while a selection exists |
| Node menu (prune, inspect) | Long-press a node |
| Root Sight | Round button on the right edge, mid-height |
| Reroot steer | **Virtual joystick appears bottom-left only while uprooted/tumbling/re-rooting** (with a haptic pulse in apps) |
| Parasitize / shake off | Context dock button (only when valid) |
| Boosters | Vertical strip on the right edge (up to 5) |
| Emotes | Emote button opens the wheel; drag to a choice and release |
| Chat | Chat bubble button top-left opens a collapsible panel; tapping an input opens the keyboard |
| Panels | Menu button opens a bottom sheet with icons for inventory, ledger, mutations, etc. |
| Report | Long-press a chat message or name tag → Report |

Rules:

- **Touch targets at least 44×44 CSS px** (48 preferred); spacing at least 8 px.
- Respect **safe areas** (notch, home indicator, rounded corners). HUD anchors to the safe rectangle.
- Disable browser gestures that interfere (pull-to-refresh, double-tap zoom, text selection on canvas).
- No hover-only information: tooltips appear on long-press.
- Haptics only in the Capacitor app (the Vibration API is unavailable in iPhone browsers).
- Thumb reach: frequent actions sit in the lower third and on the side edges; rare actions go in the menu sheet.
- Keep the world visible: HUD never covers more than a configured fraction of the screen (start: 20% in landscape).

## 17.6 The Growth Interaction (Desktop and Mobile)

1. **Select.** Click/tap a node or tip of your plant (canopy or, in Root Sight, root). Eligible tips highlight with a plain outline; non-growable nodes do not select.
2. **Aim.** Move the pointer (or, on touch, press and hold the target area) and a **preview path** shows direction, node count, biomass cost and expected time, using only numbers (no "good/bad" language).
3. **Commit.** Click/tap to set the target. The server validates and starts growth; the client shows growth as server data arrives. Growth is continuous and interruptible (T01), so you can re-aim at any time.
4. **Cancel.** Esc / right-click (desktop), Cancel button (touch).

Edge cases: if the target is invalid (out of range, blocked, not enough biomass) the preview line turns dashed with a plain reason ("Not enough biomass"); the action cannot be committed.

## 17.7 Example `controls.json`

```json
{
  "_meta": { "system": "controls", "version": "1.1", "schema": "extended-1" },
  "values": {
    "bindings_desktop": {
      "type": "schema_array",
      "schema": { "action": "string", "keys": "array", "mouse": "string" },
      "value": [
        { "action": "camera_orbit",     "keys": [],        "mouse": "right_drag" },
        { "action": "camera_pan",       "keys": ["W","A","S","D"], "mouse": "middle_drag" },
        { "action": "camera_recenter",  "keys": ["Space"],  "mouse": "double_click_ground" },
        { "action": "select_part",      "keys": [],        "mouse": "left_click" },
        { "action": "grow_cancel",      "keys": ["Escape"], "mouse": "right_click" },
        { "action": "root_sight_toggle","keys": ["Tab"],    "mouse": "" },
        { "action": "reroot_steer",     "keys": ["W","A","S","D"], "mouse": "", "context": "uprooted" },
        { "action": "emote_wheel",      "keys": ["G"],      "mouse": "", "mode": "hold" },
        { "action": "inventory_open",   "keys": ["I"],      "mouse": "" }
      ]
    },
    "touch_min_target_px":   { "type": "number", "value": 44, "range": [40, 64] },
    "hud_max_screen_fraction": { "type": "number", "value": 0.2, "range": [0.1, 0.4] },
    "root_sight_mode":       { "type": "enum", "enum": ["toggle", "hold"], "value": "toggle" },
    "text_scale":            { "type": "number", "value": 1.0, "range": [0.8, 1.5] }
  }
}
```

## 17.8 Accessibility

**In the MVP (D-16):** remappable keys (desktop), adjustable text size (80–150%), a dismissible hint card, and keyboard-operable menus.

**Not committed, but cheap and recommended (Part 16 item 8):**

- Never rely on color alone (already a principle).
- A **reduced motion** toggle that also respects the operating system setting: removes camera shake, reduces particles and sway.
- Contrast ratio of at least 4.5:1 for text against its background; visible keyboard focus.
- No gamepad support (D-16).

Colorblind modes and screen-reader support are deferred; the shape/pattern rule keeps them possible later.

---

# Part 18 — UI and HUD

## 18.1 HUD Layouts

### 18.1.1 Desktop (Landscape, 16:9)

```text
┌───────────────────────────────────────────────────────────────────────────────────┐
│ [Spores 1,250]  [Biomass 842  +3.2/s]     [☀ Day 14:20 · Clear]  [Rain in 1:40]   [Session 24:10] [☰] │
│ [Season 3 · Day 12/36]                                                     [Notifications ▾]        │
│                                                                                   │
│ [State: Rooted]                                                  Active effects   │
│ [Structure ▮▮▮▮▮▯]                                              ┌──────────────┐  │
│ [Mutations 4 · upkeep 2.3/s]                                    │ Growth speed │  │
│                                                                  │ Common·2     │  │
│                                                                  │ (best: rain) │  │
│                                                                  └──────────────┘  │
│                         ( 3D WORLD  –  plant at center )                           │
│                                                                                   │
│ ┌─────────────────────┐                                         ┌───────────────┐ │
│ │ Chat  [Prox|World]  │         [ context dock: valid actions ]  │ Light     62  │ │
│ │ …                   │         [ 1 ][ 2 ][ 3 ][ 4 ][ 5 ] boosters│ Moisture  41  │ │
│ │ [type here…]        │                                         │ Minerals  27  │ │
│ └─────────────────────┘                                         │ [tile ▾]      │ │
│                                                                  └───────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 18.1.2 Phone Landscape

```text
┌────────────────────────────────────────────────────────────────────┐
│ [Biomass 842 +3.2/s] [Spores 1,250]  [☀ 14:20 Clear · Rain 1:40] [☰] │
│ [💬]                                                      [Root Sight]│
│ [State: Rooted]                                            [Booster 1]│
│                                                            [Booster 2]│
│              ( 3D WORLD )                                  [Booster 3]│
│ [joystick: only if uprooted]                                          │
│ [Light 62 · Moisture 41 · Minerals 27]   [ context dock ]   [😀 emote]│
└────────────────────────────────────────────────────────────────────┘
```

Chat, panels and notifications are collapsed by default and open as overlays.

### 18.1.3 Phone Portrait

Top strip (biomass, Spores, time/weather); world fills the middle; bottom has a thin resource readout and the context dock; Root Sight and boosters sit in a right-edge column; the menu opens a bottom sheet.

## 18.2 HUD Elements

| Element | Shows | Data source | Visibility | Rules |
|---|---|---|---|---|
| Biomass | Current value and **net rate per second** (signed number) | T00A, T01, T04 upkeep | Always | Plain numbers; no "good/bad" color. |
| Spores | `spore_balance` | T08A, T13 | Always (from T13) | |
| Time of day | Clock/sun arc, "Day" or "Night" | T07 | Always | |
| Weather and forecast | Current state; next state and time to it | T07 | Always | Telegraph phase shown as a plain label. |
| Season | Season number and day | T20 | From T20 | |
| Session timer | Time remaining | T08 | From T08 | |
| State | Rooted / Uprooted / Tumbling / Re-rooting | T06 | Always | |
| Reroot window | Countdown | T06 | Only while re-rooting | Number only. |
| Structure | Structural integrity relative to the uproot threshold | T06 | Always | |
| Mutations | Count and total upkeep per second | T04 | Always | Opens the mutations panel. |
| Resource readout | Light, moisture, minerals for own tile or a selected neighboring tile | T00A | Always | Values 0–100 with tooltips. Each has icon, label, and color. |
| Active effects | Boosters active, remaining duration or charges, and which condition currently gives their best effect | T13A | While active | Potency shown as name + number (no rarity colors). |
| Hotbar | Booster slots 1–5 | T08A | When boosters are owned | Counts come from the server. |
| Context dock | Valid actions right now | 17.3 | Context | |
| Chat | Proximity and world tabs | T05 | Collapsible | Report and block in a context menu. |
| Name tags | Name, and later guild tag and status | T17, T44, T46 | Nearby players | Fade with distance; identical whether or not the other player is in Root Sight. |
| Notifications | One-line factual events (attached, damaged, mail received) | Event bus | Collapsible log | No exclamation marks, no celebratory visuals. |
| Hint card | Three lines on first spawn | T00A | First spawn only | Dismissible; mobile adds "Add to Home Screen". |
| Debug overlay | fps, triangles, draw calls, memory, KB/s | C01 | Debug flag | |

## 18.3 Screens and Dialogs

| Screen | Contents | Task |
|---|---|---|
| Login / sign-up | Username, password, plain note about no password reset until email recovery | T08C, C05 |
| Spawn | Archetype (one in MVP), seed path (new seed, or restore via heirloom), spawn confirm | T12, T06A, C05 |
| Inventory | Grid with filters; item detail; flag icons (tradeable/mailable/listable/account-bound); **no rarity** | T08A, C05 |
| Mutations panel | Each mutation, upkeep, shed button with cooldown/penalty, visual preview | T04 |
| Ledger viewer | Per-object history, filters, tombstones, downvote-to-hide | T16, C05 |
| Death screen | The three paths, per-gene mix, Spore costs, death record shown as a list of mutations | T06A, C05 |
| Season screen | Countdown, replayable time-lapse, queue next seed | T20, C05 |
| Extraction/graft dialogs | Choose fragment/gene; shows cost, limits, chance as numbers | T51 |
| Marketplace | Listings, filters (no rarity), 3D preview, seller reputation | T14 |
| Trade window | Two-sided item offer | T14 |
| Mail | Inbox, compose, attachments, claim | T45 |
| Guild | Roster, roles, reputation | T44 |
| Report dialog | Reason, additional info, block checkbox | T05 |
| Settings | Controls rebinding, text size, graphics tier and fps cap, audio sliders, account, reduced motion (if adopted) | C04, C05 |
| Disconnected | Plain message, retry, reconnect window countdown | C01 |

All screens use the same tokens, scale with text size, and are keyboard operable.

## 18.4 UI Behavior and Motion Rules

- **Durations:** micro-interactions 120–200 ms, panel transitions 200–300 ms. Ease-out. No bounce, no elastic, no confetti.
- **Damage feedback:** a subtle edge vignette plus an audio cue, and a log line. Never a screen-wide flash. Uproot events trigger a stronger but still plain cue.
- **Achievements and prestige:** appear as ordinary log lines. No fanfare.
- **Empty states:** plain wording ("No messages"). No encouragement or hints.
- **Tooltips:** facts only; on touch, on long-press. The first-spawn card and resource tooltips are the *only* guidance in the multiplayer game (RULE_13).
- **Errors:** state what happened and what the server rejected; no blame, no jokes.
- **Performance:** HUD is DOM; avoid layout thrash; update HUD values at most 10 Hz; never allocate per frame; frosted-glass blur only on desktop (flat translucent panels on phones).

---

# Part 19 — Aesthetics

## 19.1 Pillars

1. **Light is the hero.** The game is about light, water and minerals, so lighting carries the look: warm direct light, cool shade, visible canopy shadows on the ground.
2. **Readable silhouettes.** A plant's shape must read at a distance; detail lives in gradients and shader noise, not in tiny geometry.
3. **Painterly materials, believable forms.** Smooth gradients and soft noise instead of photographic high-frequency textures. This also saves memory on phones.
4. **Quiet interface.** The HUD stays out of the way and disappears into the world's palette.

## 19.2 Rendering Style (Budget-Aware)

- PBR-lite shading, one directional light, hemispheric ambient light, rim light on plants, aerial-perspective fog, and a **color-grading profile per time of day**.
- Shadows: cascaded soft shadows on desktop (two cascades); simple blob shadows for distant plants and on phones.
- Vertex color and gradient ramps preferred over large textures. Textures compressed (KTX2).
- No outlines, except the selection highlight.
- Post-processing: tone mapping and a light bloom on desktop only; none on the phone tier.

## 19.3 Time of Day (Colors Are Starting Points)

| Phase | Sun/light | Ambient | Fog | Mood |
|---|---|---|---|---|
| Dawn | warm peach, low angle | cool lilac | pale rose | soft, long shadows |
| Day | clean warm white | sky blue | light haze | high contrast |
| Dusk | amber to red, low | deep violet | warm gray | long shadows, rich color |
| Night | cool moon blue, low intensity | deep blue-violet | dark teal | quiet, small light pools |

## 19.4 Weather

- **Clear:** sharp shadows, saturated greens.
- **Rain:** cooler, desaturated, wet specular on soil, soft rain streaks and splash particles, reduced shadow contrast.
- **Thunderstorm:** darker sky, strong wind sway, short lightning flashes (not seizure-inducing: limited brightness and rate, config), heavier rain.
- **Telegraph and aftermath** are **gradual** blends of the above so players can read what is coming (T07). The forecast HUD gives the numbers; the sky gives the feeling.

## 19.5 Plants

| Node | Look |
|---|---|
| Root | Pale cream to brown with fibrous noise; thin at tips |
| Stem | Green to woody brown as it ages; slightly glossy new growth |
| Leaf | Translucent greens with soft veins; light shows through when backlit |
| Flower | Accent hues from archetype and mutations; simple petal shapes |
| Vine | Thin, twisting, flexible sway |
| Spore sac | Soft, slightly glossy bulb with gentle pulse |

**Mutation visual signatures.** Each mutation sets at most three shader parameters (for example hue shift, pattern, emissive amount) and optionally an instance variant (leaf shape). Rules: (1) signatures must be readable at distance; (2) **no "rarity glow"**; no signature may imply tier or power (RULE_20); (3) signatures describe *what the mutation does*, not *how strong it is*; (4) all signatures use the shared plant shader (no unique meshes).

**Health and damage.** Wilt blends toward thinner, desaturated forms; pressure damage appears as local darkening at contact points.

## 19.6 Root Sight Style

- **Soil:** semi-transparent layered strata (darker topsoil to lighter subsoil), cut by a soft-edged sphere around the camera target.
- **Own roots:** cream core with a warm amber outline; faint animated flow along the root to show absorption.
- **Rival roots:** cool teal with a **dashed/striped pattern** so they are distinguishable without color.
- **Pressure contacts:** small plain markers where root overlap damage occurs.
- **Moisture and minerals:** faint soft-colored tint or drifting particles, switchable.
- Transition: smooth, 0–3000 ms (T02 config). Other players cannot see that you are in Root Sight.
- **Shader ownership (v5.3.1):** the cutaway shader is implemented by T02; C03 reuses/refines it for other cutaways.

## 19.7 Terrain and World

- MVP uses one biome: temperate meadow/soil. Smooth-shaded terrain with painterly ground textures (downsampled CC0), soil tint driven by moisture and minerals, simple grass cards at the L0 range.
- Deep-time transformations (T20) re-style terrain through the same shaders; scars may appear as darker or lighter ground patches that fossilize.

## 19.8 UI Visual Language

**Shapes:** rounded rectangles (radius 12 px), thin 1 px borders, soft translucent panels ("bark glass" on desktop, flat translucent on phones).
**Icons:** one consistent set, simple line style (free options such as Lucide, with license noted in `ATTRIBUTION.md`).
**Color tokens (starting values; verify contrast):**

```json
{
  "loam-900": "#14180F",  "loam-800": "#1B2014",  "bark-700": "#2A281F",  "bark-500": "#4A4536",
  "moss-600": "#4E6B34",  "leaf-500": "#7FA648",  "sprout-300": "#B7D47C",
  "bone-100": "#EFE9D8",  "bone-300": "#CFC8B2",  "mist-200": "#C8D6D4",
  "sun-400":  "#E5BE55",  "rain-400": "#5A8FA8",  "clay-400": "#B9754A",
  "ember-500": "#D4553A", "dusk-500": "#6C5B8C"
}
```

Usage: loam/bark for panels; bone for text; leaf/sprout for primary actions; **resource colors** sun (light), rain (moisture), clay (minerals) always paired with icon and label; ember reserved for damage and errors; dusk for night-time accents.

**Typography (free, SIL Open Font License, self-hosted):** display **Fraunces**, interface **Nunito Sans**, numbers and IDs **JetBrains Mono**. Base size 16 px × text scale; type ratio 1.125; use tabular numerals for all changing numbers so values do not jitter.

**Layout:** 8 px spacing grid; panels anchor to screen edges and the safe-area rectangle.

## 19.9 Audio Direction

Sparse and organic. Day: wind, distant insects. Night: crickets, low wind. Rain: layered by intensity. Thunder: distant to close. Growth: soft stretch and creak. Damage: dull cracks and tears. Uproot: deep, wet tearing. UI: soft wood/paper taps. Optional quiet ambient music, off by default or very low. All sounds stop when the tab is hidden. No stingers for achievements.

## 19.10 Free Assets (D-19)

| Need | Safe free sources | Rule |
|---|---|---|
| 3D models, textures, HDRIs | Kenney, Quaternius, Poly Haven, ambientCG (CC0) | CC0 preferred |
| Audio | Freesound (filter to CC0), OpenGameArt (check each item), Kenney audio | Avoid any "NonCommercial" license, because real-money purchases make the game commercial |
| Fonts | Google Fonts (OFL) | Self-host; no external font requests in the app |
| Icons | Lucide (ISC), Phosphor (MIT) | Record in `ATTRIBUTION.md` |
| Generated assets | Check the generating tool's terms before using | Record the tool and date |

C01's asset loader fails the build if an asset has no entry in `ATTRIBUTION.md`.

Because most plant geometry is procedural, the art actually needed is small: terrain textures, a few leaf/flower base shapes (even those can be generated), sky/HDRI, audio, fonts and icons.

## 19.11 Art Deliverable

`docs/art-bible.md` holds this section (pillars, palette, time-of-day and weather profiles, plant and Root Sight rules, UI tokens, audio direction, asset policy) so every AI session shares it. Update it at each gate.

---

# Appendix A — Starter Tuning Values

| System | Value | Default | Range |
|---|---|---|---|
| Resources | tile size | 1.0 | 0.5–10 |
| Resources | light base | 50 | 0–100 |
| Resources | moisture base | 50 | 0–100 |
| Resources | minerals base | 50 | 0–100 |
| Resources | photosynthesis rate | 0.1 | 0–1.0 |
| Resources | absorption radius | 5 | 1–50 |
| Resources | `tile_mineral_threshold` | 20 | 0–100 |
| Growth | root/canopy speed | 1.0 | 0.1–10 |
| Growth | node cost | 10 | 1–100 |
| Growth | root overlap pressure | 5 HP/s | 0–20 |
| Growth | light block per node | 10 | 1–25 |
| World | tick rate | 20 Hz | 10–60 |
| World | max players | 10,000 | 10–50,000 |
| World | offline tick | 5 Hz | 1–60 |
| World | reconnect window | 10 min | 1–60 |
| Weather | cycle length | 30 min | 10–120 |
| Weather | day fraction | 0.66 | 0.4–0.8 |
| Weather | forecast window | 120 s | 30–600 |
| Uproot | reroot window | 30 s | 3–120 |
| Uproot | crawl speed | 1.0 | 0.1–2.0 |
| Uproot | `kill_credit_window` | 60 s | 5–300 |
| Session | duration | 30 min | 5–120 |
| Session | stipend | 50 Spores | 0–1,000 |
| Booster | MVP tiers | inferior/common/standard | fixed |
| Booster | `min_effect` | 0.5 | 0–1 |
| Booster | standard crafting Essence | config | earn-only |
| Season | length | 36 days | tunable |
| Heirloom | `max_seeds_per_life` | 3 | 1–10 |
| Heirloom | `death_grant_seed` | true | bool |
| Heirloom | `calamity_grant_seed` | false | bool (needs Part 16 item 1) |
| Fragments | `fragment_lifetime` | 24 h | 1–168 h |
| Fragments | drop chance per destroyed node | 0.1 | 0–1 |
| Fragments | remains count | 3 | 0–20 |
| Extraction | `self_extract_limit_per_life` | 2 | 0–10 |
| Extraction | `mints_per_plant_mutation` | 1 | 1–5 |
| Extraction | graft chance | 0.25 | 0–1 |
| Extraction | `max_grafts_per_life` | 3 | 0–10 |
| Client | desktop L0 plant triangle budget | 40 K | 20 K–80 K |
| Client | phone L0 plant triangle budget | 12 K | 5 K–25 K |
| Client | desktop detailed plant cap | 100 | 50–150 |
| Client | phone detailed plant cap | 40 | 15–60 |
| Client | HUD max screen fraction (landscape) | 0.2 | 0.1–0.4 |
| Client | touch min target | 44 px | 40–64 |
| Client | text scale | 1.0 | 0.8–1.5 |

---

# Appendix B — Schema Examples

**Item definition with flags (enum includes fragment and offspring_seed)**

```json
{
  "id": "booster_standard_growth",
  "category": "booster",
  "grade": "standard",
  "stack_limit": 20,
  "tradeable": false,
  "mailable": false,
  "listable": false,
  "account_bound": true
}
```

**Fragment item**

```json
{
  "id": "frag_abc",
  "category": "fragment",
  "stack_limit": 1,
  "tradeable": true,
  "mailable": true,
  "listable": true,
  "account_bound": false,
  "payload": {
    "source_plant_id": "p_123",
    "source_owner_id": "acct_789",
    "node_type": "leaf",
    "source_genes": ["mut_reroot_flex", "mut_thick_bark"],
    "created_at": "2026-11-01T12:00:00Z",
    "expires_at": "2026-11-02T12:00:00Z"
  }
}
```

**Offspring seed (default flags, pending Part 16 item 3)**

```json
{
  "id": "offspring_xyz",
  "category": "offspring_seed",
  "stack_limit": 1,
  "tradeable": false,
  "mailable": false,
  "listable": false,
  "account_bound": true,
  "payload": {
    "parent_a_plant_id": "p_111",
    "parent_b_plant_id": "p_222",
    "parent_a_owner_id": "acct_aaa",
    "parent_b_owner_id": "acct_bbb",
    "blueprint": ["mut_reroot_flex", "mut_thick_bark", "mut_photosynth_boost"]
  }
}
```

**Mutation with movement block**

```json
{
  "id": "mut_reroot_flex",
  "trigger": { "type": "environment", "light": [0, 100] },
  "effect": { "type": "stat", "stat": "reroot_speed", "value": 1.1 },
  "maintenance": 2.0,
  "movement": { "translocate": false, "parts": false, "drift": false, "rerootSpeed": 1.1 },
  "visual_signature": "flexible_roots"
}
```

**Death record**

```json
{
  "plant_id": "p_123",
  "parent_seed_id": "seed_456",
  "genes": ["mut_reroot_flex", "mut_thick_bark"],
  "season": 3,
  "owner_id": "acct_789"
}
```

**Gift Bundle**

```json
{
  "id": "bundle_abc",
  "category": "gift_bundle",
  "contents": ["booster_common_growth", "gene_mut_thick_bark"],
  "tradeable": true,
  "mailable": true,
  "listable": true,
  "account_bound": false
}
```

**Provenance ledger entry for a gene (RULE_30)**

```json
{
  "entry_id": "ledger_ghi",
  "object_type": "gene",
  "object_id": "gene_mut_thick_bark_001",
  "editor_id": "acct_789",
  "text": "Extracted from fragment frag_abc (source plant p_123, source owner acct_789).",
  "created_at": "2026-11-01T12:05:00Z",
  "owner_at_time": "acct_789",
  "method": "fragment_extraction",
  "source_plant_id": "p_123",
  "source_owner_id": "acct_789"
}
```

---

# Appendix E — Event List

Minimum event bus events:

- `mutation_acquired`
- `mutation_shed`
- `plant_died`
- `plant_uprooted`
- `kill_credited`
- `drain_completed`
- `dung_dropped`
- `item_granted`
- `item_consumed`
- `bundle_created`
- `bundle_opened`
- `mail_sent`
- `mail_claimed`
- `review_posted`
- `review_erased`
- `guild_created`
- `guild_disbanded`
- `achievement_unlocked`
- `prestige_changed`
- `season_ended`
- `heirloom_queued`
- `heirloom_claimed`
- `account_progress_updated`

**V5.3 / v5.3.1 additions:**

- `fragment_dropped`
- `fragment_collected`
- `gene_extracted`
- `gene_grafted`
- `seed_produced`
- `report_filed`
- `account_created`
- `account_login`
- `tick_budget_exceeded`

Handlers must not block the tick. Subscribers register at startup. Event bus defined in T03.

---

# Appendix F — v5.3.1 Merge Audit / Change List

## F.1 What v5.3.1 changes relative to v5.3

**Critical fixes (review #1–#6):**

1. **B3.2 checkpoint table replaced** so the maximum gap between checkpoints is four weeks. New checkpoints added at W26, W47, W51, W54, W56, W61, W70, W78. RULE_28 now holds and the final sign-off claim is true.
2. **Gate 3 arithmetic corrected.** W78 is an explicit Gate 3 playtest week; W79–80 are buffer and launch prep. Gate 3 arithmetic: 25 task-weeks + 1 playtest + 2 buffer = 28 weeks (W53–80). Gate 3 in B3.1 updated to match.
3. **T25/T26 cut-list conflict resolved.** Gate 3 cut list keeps the T25 core stub (root tunneling/voids and canopy light-blocking persistence) required by T26. Only optional T25 capabilities are cut.
4. **T14/T43 cut-list conflict resolved.** Gate 2 cut list keeps the T14 seller/listing data model and the `getSellerReputation` stub even if the T14 UI/auction/preview is cut. T43 cannot start without seller/listing identity; if T14 UI is deferred, T14 data model + stub must be scheduled at Gate 3 before T43.
5. **Root Sight shader ownership fixed.** T02 implements the Root Sight cutaway shader; C03 reuses/refines it. C03 dependency row now includes T00A.
6. **H01 dependency fixed.** H01 depends on all Gate 3 tasks *except* the real-money switch.

**Moderate fixes (review #7–#13):**

7. **Stale `A…` references replaced** with real Part/Task references throughout Parts 4–6, 11–18. The replacement map is in F.3.
8. **T15 stale text corrected.** T15 no longer defers extraction to post-MVP. T51 owns extraction/graft; T14 owns gene listing; T22 owns bloodline. T15 owns the gene schema, shared ID space, and mint-on-acquisition.
9. **Vocabulary rows corrected.** Heirloom seed row now states seed production (T06A) and death grant; gene item row now states T51 extraction and `mints_per_plant_mutation`.
10. **Dependency matrix completed.** Added: `C03 → C01, T07, T00A`; `C05 → C01, C04, T08A, T16, T06A, T20, T08C, T12`; `C02b → C02, T03, T04`; `T14 → T08A, T15, T13A, T06A (stubs: getSellerReputation, giftToGuild)`; `T20 → T06A, T07, T16, T13A`; `T43 → T08B, T16, T14 (T14 may be deferred; T14 seller/listing stub required if T14 UI is cut)`; `H01 → all Gate 3 tasks except real-money switch`.
11. **Duplicate Part 8.2 heading removed.** The "continued from cut-off" heading and the duplicated `No NPC vendors…` bullet are gone. Locked decisions form one continuous list.
12. **RULE_16 checkpoint weeks corrected.** "Weeks 13, 36 and 65 become checkpoints" is now "Weeks 13, 36 and 67 become checkpoints," matching the corrected checkpoint table (CP21 is W67).
13. **Heirloom-seed planting separated from T53.** T06A's planting bullet now names T22 (or a separate post-MVP seed-planting task). T53 covers offspring seeds from cross-pollination only.

## F.2 What v5.3.1 does *not* change

- The 80-week schedule, the 73 task-week total, the gate structure (24 / 52 / 80), and the task IDs.
- The RULE_1–RULE_31 list (only RULE_16's checkpoint weeks changed).
- The system specs' behavior; only references and dependency rows were corrected.
- The secrets policy (Part 9).
- All beta-bucket specs except T22 (planting bullet) and T53 (offspring-only clarification).

## F.3 `A…` reference replacement map

Applied globally to v5.3.1. After this patch, no standalone `A5.2`, `A8.1`, `A9.2`, `A11.4`, `A13-*`, etc. remain.

| Find | Replace with |
|---|---|
| `Part 13, A5.2` / `A5.2` | `Part 13.6` |
| `Part 13, A5.3` / `A5.3` | `Part 13.7` |
| `Part 13, A5.4` / `A5.4` | `Part 13.8` |
| `Part 13, A5.5` / `A5.5` | `Part 13.9` |
| `Part 13, A4.4` / `A4.4` | `Part 13.4` |
| `Part 14, A6.1–A6.3` / `A6.1–A6.3` | `Part 14.1.1–14.1.3` |
| `Part 5, A8.1` / `A8.1` | `Part 5, T06A` |
| `Part 5, A8.2–A8.3` / `A8.2–A8.3` | `Part 5, T51` |
| `A8.2` / `A8.3` | `Part 5, T51` |
| `A8.1-1` … `A8.1-6` | `Part 5, T06A` / `T06A planting bullet / T22` as appropriate |
| `Part 5, A9.2` / `A9.2` | `Part 5, T05 (report/block) and T40 (admin triage)` |
| `A11.4` | `Part 6.1 condition matrix` |
| `A13-1` | `Part 16 item 1` |
| `A13-2` | `Part 16 item 2` |
| `A13-3` | `Part 16 item 3` |
| `A13-4` | `Part 16 item 4` |
| `A13-5` | `Part 16 item 5` |
| `A13-6` | `Part 16 item 6` |
| `A13-7` | `Part 16 item 7` |
| `A13-8` | `Part 16 item 8` |

## F.4 Retained v5.3 content

Every v5.3 system spec is retained in v5.3.1, including: T00A consumption triggers; T01 root competition and canopy shading; T02 camera/substrate and now shader ownership; T03 event bus, A5.2 tiers (now Part 13.6), A5.3 interest (Part 13.7), A5.4 protocol (Part 13.8), A5.5 persistence (Part 13.9); T04 movement block; T05 dual chat + report/block; T06 damage pipeline, kill credit, dung, reroot crawl, fragment drops and remains; T07 day/night and weather phases; T08A inventory with flags, bundles, duplication audit, fragment and offspring seed categories; T08 session feedback; T08B account progress; T12 one archetype; T10 parasitism; T13 currency and P2W closure; T15 gene schema; T13A 3×3 boosters with thunderstorm column; T14 UI marketplace; T16 ledger; T17 naming; T06A heirloom; T20 deep time; T43 reputation; T44 guilds; T45 mail + Gift Bundles; T50 Starter Pack; T46 status/rank display only; T23–T26 frameworks; T40–T42 launch minimum; real-money switch.

## F.5 Intentionally open / not missing

- Exact tuning numbers are defaults, not locks.
- Consumed vs copied genes remains a config decision in T06A/T22.
- Stacking curve for boosters remains tuning.
- Spectator caps, minimap aggregation frequency, territory contest rules remain config decisions.
- Offspring seed trading rule (**Part 16 item 3**).
- Graft restriction (**Part 16 item 2**).
- Calamity seed grant (**Part 16 item 1**).
- Gate dates (**Part 16 item 4**).
- `spore_sac` function (**Part 16 item 6**).
- Worker threads (**Part 16 item 7**).
- Accessibility extras (**Part 16 item 8**).
- Secrets file is intentionally excluded from AI sessions.

---

# Appendix G — Final Complete Task Index

**Gate 0 / Phase 0:** T00, O01, T03P

**Gate 1 / Phase 1 (end W24):** C01, T00A, T01, C02, T03, T08C, T02, T07, C03, T05, T04, T06, T08A, C04

**Gate 2 / Phase 2–3 (end W52):** T08, T08B, T16, T17, T15, T13, T51, T06A, T13A, T14, T12, T10, T20 partial, C05, C02b, O02

**Gate 3 / Phase 4–6 (end W80):** T43, T44, T45, T50, T46, T23, T24, T25, T26, T40, T41, T42, C06, C09, C07, H01, real-money switch

**Beta / post-alpha:** T09, T11, T13B, T18, T19, T21, T22, T27, T28, T29, T30, T34, T35, T36, T37, T38, T39, T47, T48, T31, T49, **T53**, T32, T33

**Dependency order is canonical per Part 4, B5.** If any older plan conflicts with v5.3.1, v5.3.1 wins.

---

# Appendix H — Data Model Sketch

Core tables (names are suggestions; every gameplay table carries `world_id`).

| Table | Key columns |
|---|---|
| `accounts` | account_id, username, password_hash, role, created_at, prestige, flags |
| `sessions` | session_id, account_id, refresh_hash, expires_at, device |
| `worlds` | world_id, season_number, season_started_at, config_version |
| `plants` | plant_id, world_id, owner_id, parent_seed_id, archetype, state, snapshot (bytea), snapshot_version, last_event_seq, born_at, died_at |
| `plant_events` | plant_id, seq, type, payload (since last snapshot) |
| `inventory_items` | item_id, owner_id, world_id, category, definition_id, stack_count, flags, payload (json), created_at |
| `spore_balances` | owner_id, world_id, balance (row-locked) |
| `death_records` | plant_id, parent_seed_id, genes[], season, owner_id, died_at, cause |
| `ledger_entries` | entry_id, object_type, object_id, editor_id, text, created_at, duration_active, owner_at_time, erased_at, erased_by |
| `tombstones` | ledger entry reference, erased_by, erased_at |
| `mail`, `mail_attachments` | mail_id, from, to, category, body, expires_at / item references |
| `listings`, `trades` | listing_id, seller_id, item_id, price, mode, status |
| `reviews` | review_id, rater_id, target_type, target_id, stars, text, response |
| `guilds`, `guild_members` | guild_id, name, motto, leader_id / role |
| `reports` | report_id, reporter_id, target_type, target_id, reason, free_text, context_snapshot (json), status, created_at |
| `blocks` | blocker_id, blocked_id, created_at |
| `fragments` | fragment_id (also an inventory_items row), source_plant_id, source_owner_id, node_type, source_genes[], expires_at |
| `achievements`, `prestige_log` | account_id, achievement_id / event, weight, ts |

All item and Spore mutations use row-level locks (RULE_17). Include the duplication-audit test (T08A) in CI.

**Additional tables for V5.3 / v5.3.1 features:**

| Table | Key columns |
|---|---|
| `gene_mints` | plant_id, mutation_id, mint_count, last_minted_at (enforces `mints_per_plant_mutation`) |
| `graft_log` | plant_id, gene_id, attempted_at, success |
| `seed_production` | plant_id, flower_node_id, produced_at, seed_item_id |
| `offspring_blueprints` | offspring_seed_item_id, parent_a_plant_id, parent_b_plant_id, blueprint_genes[] |
| `planted_seeds` | item_id, world_id, position, planted_at, spawned_plant_id (nullable until spawned) — used by T22 planting and T53 offspring planting alike |
| `tick_budget_samples` | world_id, ts, active_ms, near_ms, dormant_ms, queue_depth |
| `protocol_versions` | version, notes, deprecated_at |

---

# Final Sign-Off

v5.3.1 is now complete as the merged master plan: **v5.3 core + the thirteen reviewed corrections + all retained beta specs + corrected cross-references + corrected dependency matrix + corrected checkpoint schedule**. It is standalone for AI sessions. Feed Part 2 + Part 3 + one task spec at a time. Do not feed the secrets file. Build systems, not outcomes. If a gate slips, cut features, never the gate. If a schema field is named `rarity`, it is a bug. If an item moves, it is a server transaction with flags enforced. If a client system touches the world, the server is authoritative and the client corrects without drama. If a report touches player-authored content, only RULE_6 categories are acted on.

The plan's arithmetic holds: **73 task-weeks across three phases**, with playtest and buffer weeks bringing the total to **80 whole weeks**. Every checkpoint gap is **≤ 4 weeks**. Gate 3 has an explicit playtest week (W78), and its arithmetic is **25 task-weeks + 1 playtest + 2 buffer = 28 weeks (W53–80)**. Every task has a single AI-session scope. Every dependency is resolved before build. Every free-first choice is Docker-portable. Every stale `A…` reference now points to a real section or task.

**End of Plant Legacy — Master Build Plan v5.3.1.**



