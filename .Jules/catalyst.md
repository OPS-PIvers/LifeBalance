## 2025-05-20 - [Horizon Command Bar] **Discovery:** [Gemini "Magic Action" Logic Unused in UI] **Opportunity:** [Unified Natural Language Input]

**Discovery:**
I found a powerful `parseMagicAction` function in `services/geminiService.ts` that can intelligently classify and parse natural language into Transactions, ToDos, or Shopping Items. Currently, similar logic is only used for processing background `pendingItems` from iOS Shortcuts, and the sophisticated `parseMagicAction` appears to be underutilized or reserved for a future feature.

**Opportunity:**
I can implement a "Horizon Command Bar" on the Dashboard. This input field will allow users to type requests like "Buy milk", "Pay $50 for gas", or "Remind me to call mom" directly in the app. This leverages the existing AI investment to drastically reduce friction (no navigation needed to add items) and creates a "delightful" power-user feature with minimal risk, as it reuses the existing context actions (`addTransaction`, `addToDo`, `addShoppingItem`).
