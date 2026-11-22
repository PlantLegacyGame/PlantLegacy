# What Spores are

Plain-language answer, required before any store UI ships (T13, Phase 0 checklist
item 5).

**Spores are a consumable in-game currency.** You earn them by playing — taking
part in sessions, exploring chunks you have never visited, acquiring mutations,
kills, consuming dung, and season rewards. You can also buy them with real money.

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
boosters are purchasable and tradeable. Standard and above are account-bound,
earn-only, and standard crafting requires Essence, which is never purchasable.
Spending money buys Spores; Spores buy time, not power that others cannot reach
(RULE_10).

Real-money purchasing is not enabled yet. When it is, it will be labeled as
early access, with a visible "what works now" list.
