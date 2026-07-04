> **Historical — stale implementation guide (banner added 2026-07-04).** The `quickAddReceipt` endpoint still returns `501 Not Implemented` (referenced from `types/schema.ts` `ApiKeyPermissions.receiptScanning`), but the code sample below predates the current Gemini setup: functions now use `@google/genai` (not `@google/generative-ai`), the `GEMINI_API_KEY` secret already exists (used by `functions/src/geminiProxy.ts`, the pattern to follow), and the model/pricing named here are outdated. If implementing, write a fresh plan in `advisor-plans/` modeled on `geminiProxy.ts`.

# Receipt Scanning Cloud Function Implementation

This document describes how to enable the `quickAddReceipt` endpoint for iOS Shortcuts.

## Current Status

The endpoint exists but returns `501 Not Implemented`. The infrastructure (API key validation, rate limiting, permissions) is already in place.

## Steps to Implement

### 1. Install Gemini SDK in Functions

```bash
cd functions
npm install @google/generative-ai
```

### 2. Set Gemini API Key in Firebase Config

```bash
# Set the secret
firebase functions:secrets:set GEMINI_API_KEY

# When prompted, paste your Gemini API key
```

Alternatively, use environment config (less secure):
```bash
firebase functions:config:set gemini.api_key="YOUR_GEMINI_API_KEY"
```

### 3. Update the Cloud Function

Replace the placeholder in `functions/src/quickAdd/index.ts`:

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

// In quickAddReceipt function, replace the placeholder try block:

try {
  // Initialize Gemini
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

  // Prepare the image
  const imageData = {
    inlineData: {
      data: image.replace(/^data:image\/\w+;base64,/, ""),
      mimeType: "image/jpeg",
    },
  };

  // Analyze receipt
  const prompt = `Analyze this receipt image and extract:
1. Merchant/store name
2. Total amount (number only, no currency symbol)
3. Date (in YYYY-MM-DD format)
4. Suggested category (one of: Groceries, Dining, Shopping, Entertainment, Transportation, Utilities, Healthcare, Other)

Respond in JSON format only:
{
  "merchant": "Store Name",
  "amount": 12.34,
  "date": "2024-01-15",
  "category": "Groceries"
}

If you cannot read something, use null for that field.`;

  const result = await model.generateContent([prompt, imageData]);
  const response = await result.response;
  const text = response.text();

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not parse receipt data");
  }

  const receiptData = JSON.parse(jsonMatch[0]);

  // If autoCreate is true, create the transaction
  if (autoCreate && receiptData.amount && receiptData.merchant) {
    const transactionData = {
      amount: receiptData.amount,
      merchant: receiptData.merchant,
      category: receiptData.category || "Uncategorized",
      date: receiptData.date || format(new Date(), "yyyy-MM-dd"),
      status: "verified",
      isRecurring: false,
      source: "receipt-shortcut",
      autoCategorized: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const transactionRef = await db
      .collection(`households/${householdId}/transactions`)
      .add(transactionData);

    await logApiCall(householdId, apiKey.substring(0, 16), "receipt", { autoCreate }, 200);

    jsonResponse(res, 200, {
      success: true,
      message: `Receipt scanned and transaction created: $${receiptData.amount} at ${receiptData.merchant}`,
      data: {
        transactionId: transactionRef.id,
        ...receiptData,
      },
    });
  } else {
    // Just return the scanned data without creating transaction
    await logApiCall(householdId, apiKey.substring(0, 16), "receipt", { autoCreate }, 200);

    jsonResponse(res, 200, {
      success: true,
      message: "Receipt scanned successfully",
      data: receiptData,
    });
  }
} catch (error) {
  logger.error("Error in quickAddReceipt:", error);
  await logApiCall(householdId, apiKey.substring(0, 16), "receipt", { autoCreate }, 500);
  errorResponse(res, 500, "Failed to analyze receipt", "INTERNAL_ERROR");
}
```

### 4. Update Function Definition for Secrets

```typescript
export const quickAddReceipt = onRequest(
  {
    cors: true,
    region: "us-central1",
    secrets: ["GEMINI_API_KEY"]  // Add this line
  },
  async (req, res) => {
    // ... function body
  }
);
```

### 5. Deploy

```bash
firebase deploy --only functions:quickAddReceipt
```

## iOS Shortcut Setup

1. Create new Shortcut
2. Add action: "Take Photo" or "Select Photos"
3. Add action: "Base64 Encode"
4. Add action: "Get Contents of URL"
   - URL: `https://us-central1-lifebalance-26080.cloudfunctions.net/quickAddReceipt`
   - Method: POST
   - Headers:
     - `Authorization`: `Bearer YOUR_API_KEY`
     - `Content-Type`: `application/json`
   - Body (JSON):
     ```json
     {
       "image": "[Base64 Encoded Image]",
       "autoCreate": true
     }
     ```
5. Add action: "Show Result"

## Rate Limits

- 20 receipts per day (aligned with AI quota)
- Tracked in `households/{id}/apiUsage/receipt`

## Estimated Cost

- Gemini 2.0 Flash: ~$0.00015 per image
- At 20 receipts/day = ~$0.003/day = ~$0.09/month per household
