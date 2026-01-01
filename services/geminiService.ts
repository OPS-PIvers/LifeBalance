import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini Client
// Uses Vite environment variable for the API key
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

/**
 * Validates that the Gemini API key is configured
 * @throws Error if API key is not configured
 */
const validateApiKey = () => {
  if (!apiKey) {
    throw new Error("Gemini API key not configured. Please set VITE_GEMINI_API_KEY in your environment.");
  }
};

export interface ReceiptData {
  merchant: string;
  amount: number;
  category: string;
  date: string;
}

export interface BankTransactionData {
  merchant: string;
  amount: number;
  category: string;
  date: string;
}

/**
 * Extracts MIME type from base64 data URL
 * Supports formats like image/jpeg, image/png, image/webp, image/svg+xml
 */
const extractMimeType = (base64Image: string): string => {
  const match = base64Image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  return match ? match[1] : 'image/jpeg';
};

/**
 * Strips the data URL prefix from base64 image data
 */
const stripDataUrlPrefix = (base64Image: string): string => {
  return base64Image.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
};

/**
 * Analyzes a receipt image and extracts transaction data
 * @param base64Image - Base64 encoded image data
 * @param availableCategories - List of available budget categories for smart matching
 */
export const analyzeReceipt = async (
  base64Image: string,
  availableCategories?: string[]
): Promise<ReceiptData> => {
  validateApiKey();

  try {
    const mimeType = extractMimeType(base64Image);
    const cleanBase64 = stripDataUrlPrefix(base64Image);

    const categoryList = availableCategories?.length
      ? availableCategories.join(', ')
      : 'Groceries, Dining, Gas, Shopping, Utilities, Transport';

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: {
        parts: [
            {
                inlineData: {
                    mimeType,
                    data: cleanBase64
                }
            },
            {
                text: `Analyze this receipt image. Extract the merchant name, total amount (as a positive number), date (YYYY-MM-DD format), and suggest the most appropriate category from this list: ${categoryList}. Return JSON.`
            }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            merchant: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            category: { type: Type.STRING },
            date: { type: Type.STRING }
          },
          required: ["merchant", "amount", "category"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No data returned from Gemini");

    return JSON.parse(text) as ReceiptData;

  } catch (error) {
    console.error("Gemini OCR Error:", error);
    throw new Error("Failed to analyze receipt. Please try manual entry.");
  }
};

/**
 * Analyzes a bank statement screenshot and extracts multiple transactions
 * @param base64Image - Base64 encoded image of bank statement/transaction list
 * @param availableCategories - List of available budget categories for smart matching
 */
export const parseBankStatement = async (
  base64Image: string,
  availableCategories?: string[]
): Promise<BankTransactionData[]> => {
  validateApiKey();

  try {
    const mimeType = extractMimeType(base64Image);
    const cleanBase64 = stripDataUrlPrefix(base64Image);

    const categoryList = availableCategories?.length
      ? availableCategories.join(', ')
      : 'Groceries, Dining, Gas, Shopping, Utilities, Transport';

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: {
        parts: [
            {
                inlineData: {
                    mimeType,
                    data: cleanBase64
                }
            },
            {
                text: `Analyze this bank statement or transaction list screenshot. Extract ALL visible transactions. For each transaction, provide:
- merchant: The merchant or payee name
- amount: The transaction amount as a POSITIVE number (even if shown as negative/debit)
- date: The transaction date in YYYY-MM-DD format
- category: Suggest the most appropriate category from: ${categoryList}

Only include expense transactions (debits/withdrawals). Skip any credits, deposits, or payments received.
Return a JSON array of transactions.`
            }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              merchant: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              category: { type: Type.STRING },
              date: { type: Type.STRING }
            },
            required: ["merchant", "amount", "category", "date"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No data returned from Gemini");

    const transactions = JSON.parse(text) as BankTransactionData[];

    // Ensure amounts are positive
    return transactions.map(tx => ({
      ...tx,
      amount: Math.abs(tx.amount)
    }));

  } catch (error) {
    console.error("Gemini Bank Statement Parse Error:", error);
    throw new Error("Failed to parse bank statement. Please try again or enter transactions manually.");
  }
};
