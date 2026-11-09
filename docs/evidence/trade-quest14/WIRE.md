# Trade and quest metadata, private protocol14 union

This is the coordinator-approved byte contract. Existing wire version/identity admission remains coordinator-owned. No hosted quest/trade profile or UI is activated here.

Input18 is exactly three bytes: tag18, fixed merchant kind, pick. Merchant kinds are Barter0 and Stats1. Picks are0..2; there is no skip value. No price, reward, coordinates, label, actor ID or issued handle is accepted. The ordinary input queue resolves the fixed kind through validation and Sim submission; seeing a merchant row is not an added prerequisite.

State key11 is a complete `Trade` replacement. Its first byte is strict availability0/1. Missing key retains the prior value,0 replaces it with Unavailable, and1 supplies the following whole value. Available empty owner facts remain distinct from Unavailable. Welcome resets the collection and pending inputs.

| Available Trade field | Layout and bounds |
| --- | --- |
| Used | strict bool byte |
| Saved offers | canonical varint count<=3; each cost-stat byte, cost f64LE, gain-stat byte, gain f64LE, label string |
| Applied stat rows | canonical varint count<=7; each stat byte, signed f64LE value |
| Barter deadline | strict option0/1; absolute f64LE when present |
| Visible merchant rows | canonical varint count<=2; each kind byte, x f64LE, y f64LE, name string |
| Barter choice labels | exactly three strings, no count |

Stat codes are MaxHp0, Ad1, Ap2, AttackSpeed3, MoveSpeed4, Armor5 and Shield6. Offer cost and gain must be different stats with positive finite values. Applied rows preserve finite signed values, signed-zero bits, order and duplicates. The optional deadline preserves None, Some0 and past deadlines; present values are finite and nonnegative, with exact bits. No f32 narrowing, rounding, refold, reprice or gameplay-derived upper bound is added.

Merchants use separate noncombat kind/coordinate rows, with no actor references or invented fighter fields. Positions preserve finite binary64 values within0..=8191.875. The count/range limits are publication restrictions; native restore is unchanged. Duplicate-kind rows and their order are preserved within the cap. Names are the native fixed-catalog strings. Barter labels come from the existing native helper using this SAME prepared observation's valid inventory and selected slot; TradeSome with missing/invalid inventory refuses the whole preparation. An empty hand is not inferred from Self.weapon or converted to Fists.

All strings use u8 UTF-8 byte lengths, at most255 bytes, with strict decoding. Empty/duplicate display strings are valid and never identity or action authority. Trade's complete value, INCLUDING availability, is bounded by2213 bytes:933 for the bounded native facts,768 for three255-byte Barter labels and512 for two255-byte merchant names. A structurally valid2214-byte value is impossible under those bounds; an extra byte after the value is outer trailing data, not evidence for a reachable aggregate-overflow branch.

State10 Quest rows append five mandatory final strings after owner_visited, in order: name, giver_label, brief, objective, reward. Existing handle, Def ID, giver coordinate, state, roster/participant/navigation and Owner* facts are preserved. The strings are copied from the sealed native factory; clients do not derive objective/reward wording or readiness/ownership from text. Native source Number addition/string behavior at the farm-count boundary stays in the native producer. Closed history retains its fixed reward wording.

The Quest complete-value cap is24576 bytes INCLUDING availability, excluding the State key. All structural limits remain20 rows,8 roster entries,8 participants per row,160 objectives and8 objectives per row; IDs remain full nonzero u32 namespaces. Each new string retains the255-byte bound. The captured catalog/context bound adds4720 bytes to the prior16384-byte value bound, yielding21104; this does not imply that arbitrary individually valid255-byte strings across all20 rows fit. Aggregate overflow refuses without truncation or partial publication.

MAX_STATE_KEYS becomes11. MAX_SERVER_FRAME remains262144 and the writer's buffer540672. Conservative per-key maxima, including each key, are8/136201/29699/36355/90/10755/6659/1084/47/24577/2214. With the7-byte State envelope their sum is247696, leaving14448 bytes. This is a synthetic arithmetic ceiling, not measured traffic. Complete replacement of a moving merchant scene can repeat owner text; no patch semantics or client cycle is introduced to hide that cost.

Rust, C# and JS must validate complete frames before held collection mutation, including retained/replaced QuestItem references. Bitwise Trade equality protects signed-zero and deadline changes. Prepared observer and collection baselines commit only after the whole reliable batch is accepted. Failed projection/encoding/capacity/closed enqueue leaves them unchanged; resync and Resume retain the existing transaction and reset rules.
