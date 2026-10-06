# UI/UX and KPI improvement backlog — 5 October 2026

Based on actual Oracle test-company use: 132 desktop/mobile route-persona checks, screenshots, real Excel downloads and consumable entry. Rendering is not classified as full workflow completion. Raw findings remain in var/company-year/ui-ux/results.json; the corrected workflow evidence is in ui-ux-workflow-recheck.md.

| Priority | Improvement | Evidence | Acceptance condition |
|---|---|---|---|
| P1 | Count final polishing output once | DPR 110 cut/330 polished for 110 finished pieces after 3 passes | Grinding/resin/polishing shown separately; finished output 110; regression covers both piece and lot runs. |
| P1 | Value damage from actual purchase cost | 528 credit blocks all have 0 damage cost | Payment percentage cannot change cost per damaged piece; net stone cost plus configured/allocated charges reviewed. |
| P1 | Fix mobile form/card overflow | Yard 614 px, Sell 694 px, lot sell 547 px, Consumables 490 px, reports 457 px on 390 px viewport; dashboard 400 px at large dues | No body overflow at 390/360 px; controls fit; tables scroll within wrappers; currency wraps/scales. |
| P1 | Make registers usable at factory volume | Yard 593,722 px tall on mobile; desktop 100,334 px; Money 31,367 px; Consumables 44,930 px | Server-side search/filter/pagination or virtualized queues; bounded initial payload and task page length. Do not merely hide rows after loading all 30 kpieces. |
| P1 | Stock-first Yard and grouped receipts | Stock below a long receipt form; only 6 intake fields fit first desktop screen | Stock/search/queues default; explicit Receive block action; grouped supplier+bill+price/charges/date, review before save. |
| P1 | Match Cut UI to actual B 21/LPM work | Completion defaults 10/9; no dimensions/date; native multiselect and glossy-only polish | Batch selection/search/counts/area/recovery; explicit grinding/resin/polish and finish; per-session inputs and review. |
| P1 | Integrate consumable buying and supplier settlements | Separate stock receipt and paid expense; later quarry/AP payment absent | One reviewed supplier bill posts stock+net cost+GST+AP; later payments with mode/reference/date reduce same party dues. |
| P2 | Add discoverable Consumables and Recovery navigation | Consumables has no incoming app link or routePolicy entry | Group Yard/material stock and Cut/quality; authorized staff can discover routes without knowing URLs. |
| P2 | Define manager and specialist permission models | New accounts limited to 3 roles; persisted manager/admin map to owner | Owner chooses supported hierarchy; separate operational/finance permissions and SoD, explicit migration plan preserving legacy accounts. |
| P2 | Business date on returns/credit notes | September-ending report differs from ledger by₹ 8,260; all-dates agrees | Explicit return/credit-note date shared by documents, journals and period reports; replay and backdate rules tested. |
| P2 | Make recovery benchmark configurable | Actual 110 correct but benchmark 105 hardcoded | Owner can set 110 for this factory; distinguish actual, target and tolerance by variety/process. |
| P2 | Period presets and focused analytics | Historic year initially looks empty under the current month; analytics 2,942 pxlong | All dates/FY/month presets, short summary plus drilldowns; move provider/settings/document setup out of main KPI scan. |
| P2 | Complete product costing model | Four-worker fixture and no complete COGS lifecycle | Explicit earned margin vs estimate; input GST excluded; operating cost, labour, damage and inventory cost recognized consistently. |

Recommended order: correct KPI/cost defects; repair mobile layout; implement bounded stock/register lists; reorganize daily task flows; connect consumable procurement/AP; then improve roles, return dates and analytics presets. Reuse the saved role agents against the retained test company after each focused change. No product fixes were silently applied during the audit.
