# What Spores are

Plain-language answer, required before any store UI ships (T13, Phase 0 checklist
item 5).

**Spores are a consumable in-game currency.** You earn them by playing — taking
part in sessions, exploring chunks you have never visited, acquiring mutations,
kills, consuming dung, and season rewards. In pre-alpha they **cannot be bought
with real money**: the only money path is a donation, and a donation grants no
Spores, items, advantage or account status (ADR-079). Buying Spores is a later
feature, not a current one.

They are not an investment, not stored value, and not redeemable. They buy
fertilizer, gene stabilization, cosmetics, market fees, and other sinks inside
the game. Once spent, they are gone.

**There is no artificial earn cap.** Playing more earns more.

**What is live today (2026-11-20).** The server owns one balance
(`INVENTORY_SYNC.sporeBalance`), starts a new plant at **120** spores and caps it
at **1,000,000**. The earn sources wired are: consuming dung **5**, acquiring a
mutation **15**, kill credit **30**, and picking up a fragment drop **3**. The
shop sells six items in two sections, priced **20–80** spores; prices and earn
rates are `config/shop.json` and `config/spores.json`. Sessions, first-visit
chunks and season rewards are still design intent, not earn sources yet. The
purse is in memory, so a restart begins again from the configured starting
balance until T08A lands.

**What money cannot buy:** potency grades above common. Inferior and common
boosters are purchasable with Spores and tradeable. Standard and above are
account-bound, earn-only, and standard crafting requires Essence, which is never
purchasable. If Spore purchases return after pre-alpha, money buys Spores and
Spores buy time, not power that others cannot reach (RULE_10).

Real-money purchasing is **not enabled in pre-alpha**. Donations are separate
from the economy and do not buy Spores. Any later real-money path must be
labeled as early access, with a visible "what works now" list, and it must not
ship before the legal gate (age, terms, privacy, country/storefront).
