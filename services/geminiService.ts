import { GoogleGenAI, Type } from "@google/genai";
import { PantryItem, Meal } from "@/types/schema";

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
  date?: string; // Optional - may not be visible on all receipts
  suggestedHabits?: string[];
}

export interface BankTransactionData {
  merchant: string;
  amount: number;
  category: string;
  date: string;
  suggestedHabits?: string[];
}

export interface GroceryItem {
  name: string;
  quantity?: string;
  category: string;
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
 * @param availableHabits - List of available habits for smart matching
 */
export const analyzeReceipt = async (
  base64Image: string,
  availableCategories?: string[],
  availableHabits?: string[]
): Promise<ReceiptData> => {
  validateApiKey();

  try {
    const mimeType = extractMimeType(base64Image);
    const cleanBase64 = stripDataUrlPrefix(base64Image);

    const categoryList = availableCategories?.length
      ? availableCategories.join(', ')
      : 'Groceries, Dining, Gas, Shopping, Utilities, Transport';

    const habitList = availableHabits?.length
      ? availableHabits.join(', ')
      : '';

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
            {
                inlineData: {
                    mimeType,
                    data: cleanBase64
                }
            },
            {
                text: `Analyze this receipt image. Extract the merchant name, total amount (as a positive number), date (YYYY-MM-DD format), and suggest the most appropriate category from this list: ${categoryList}. ${habitList ? `Also suggest any relevant habits from this list that might apply to this transaction: ${habitList}.` : ''} Return JSON.`
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
            date: { type: Type.STRING },
            suggestedHabits: { type: Type.ARRAY, items: { type: Type.STRING } }
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
 * @param availableHabits - List of available habits for smart matching
 */
export const parseBankStatement = async (
  base64Image: string,
  availableCategories?: string[],
  availableHabits?: string[]
): Promise<BankTransactionData[]> => {
  validateApiKey();

  try {
    const mimeType = extractMimeType(base64Image);
    const cleanBase64 = stripDataUrlPrefix(base64Image);

    const categoryList = availableCategories?.length
      ? availableCategories.join(', ')
      : 'Groceries, Dining, Gas, Shopping, Utilities, Transport';

    const habitList = availableHabits?.length
      ? availableHabits.join(', ')
      : '';

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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
${habitList ? `- suggestedHabits: Suggest any relevant habits from this list: ${habitList}` : ''}

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
              date: { type: Type.STRING },
              suggestedHabits: { type: Type.ARRAY, items: { type: Type.STRING } }
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

/**
 * Analyzes a pantry image and extracts food items
 * @param base64Image - Base64 encoded image data
 */
export const analyzePantryImage = async (
  base64Image: string
): Promise<Omit<PantryItem, 'id'>[]> => {
  validateApiKey();

  try {
    const mimeType = extractMimeType(base64Image);
    const cleanBase64 = stripDataUrlPrefix(base64Image);

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
            {
                inlineData: {
                    mimeType,
                    data: cleanBase64
                }
            },
            {
                text: `Analyze this image of a pantry, fridge, or food items. Identify all distinct food items visible.
                For each item, provide:
                - name: A clear, concise name of the item
                - quantity: estimated amount/quantity visible (e.g., "1 box", "approx 500g", "half full")
                - category: Logical category (e.g., "Produce", "Dairy", "Grains", "Canned Goods", "Snacks", "Beverages", "Condiments")
                - expiryDate: (Optional) If an expiry date is clearly visible, provide in YYYY-MM-DD. Otherwise null.

                Return a JSON array of these items.`
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
              name: { type: Type.STRING },
              quantity: { type: Type.STRING },
              category: { type: Type.STRING },
              expiryDate: { type: Type.STRING, nullable: true },
            },
            required: ["name", "quantity", "category"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No data returned from Gemini");

    return JSON.parse(text) as Omit<PantryItem, 'id'>[];

  } catch (error) {
    console.error("Gemini Pantry Analysis Error:", error);
    throw new Error("Failed to analyze pantry image. Please try manual entry.");
  }
};

export interface MealSuggestionRequest {
  usePantry: boolean;
  cheap: boolean;
  quick: boolean;
  new: boolean;
  pantryItems: PantryItem[];
  previousMeals: Meal[];
}

export interface MealSuggestionResponse {
  name: string;
  description: string;
  ingredients: { name: string; quantity: string; pantryItemId?: string }[];
  tags: string[];
  reasoning: string;
}

/**
 * Suggests a meal based on preferences and pantry
 */
export const suggestMeal = async (
  options: MealSuggestionRequest
): Promise<MealSuggestionResponse> => {
  validateApiKey();

  try {
    // Include IDs for pantry items so AI can match them
    const pantryList = options.pantryItems.map(p => `ID:${p.id} - ${p.name} (${p.quantity})`).join(', ');
    const previousMealsList = options.previousMeals.map(m => m.name).join(', ');

    let prompt = `Suggest a meal plan idea based on the following criteria:\n`;
    if (options.usePantry) prompt += `- MUST use available pantry items as much as possible.\n`;
    if (options.cheap) prompt += `- Should be budget-friendly/cheap.\n`;
    if (options.quick) prompt += `- Should be quick to prepare (under 30 mins).\n`;
    if (options.new) prompt += `- Should be DIFFERENT from these previous meals: ${previousMealsList}\n`;

    prompt += `\nAvailable Pantry Items (with IDs): ${pantryList || "None provided"}\n`;

    prompt += `\nReturn a JSON object with:
    - name: Meal name
    - description: Short appetizing description
    - ingredients: Array of objects { name, quantity, pantryItemId (if ingredient matches a provided pantry item ID exactly, otherwise null) }
    - tags: Array of strings (e.g., "Quick", "Healthy", "Comfort Food")
    - reasoning: Brief explanation of why this meal was suggested based on criteria.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            ingredients: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  quantity: { type: Type.STRING },
                  pantryItemId: { type: Type.STRING, nullable: true }
                },
                required: ["name", "quantity"]
              }
            },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            reasoning: { type: Type.STRING }
          },
          required: ["name", "description", "ingredients", "tags", "reasoning"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No data returned from Gemini");

    return JSON.parse(text) as MealSuggestionResponse;

  } catch (error) {
    console.error("Gemini Meal Suggestion Error:", error);
    throw new Error("Failed to suggest meal.");
  }
};

/**
 * Parses a grocery receipt to extract items
 * @param base64Image - Base64 encoded image
 */
export const parseGroceryReceipt = async (
  base64Image: string
): Promise<GroceryItem[]> => {
  validateApiKey();

  try {
    const mimeType = extractMimeType(base64Image);
    const cleanBase64 = stripDataUrlPrefix(base64Image);

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
            {
                inlineData: {
                    mimeType,
                    data: cleanBase64
                }
            },
            {
                text: `Analyze this grocery receipt. Extract all purchased food/grocery items.
                For each item, provide:
                - name: The item name
                - quantity: quantity if specified (e.g., "2", "1 lb"), otherwise "1"
                - category: Logical category (e.g., "Produce", "Dairy", "Meat", "Snacks", "Household", "Pantry")

                Ignore taxes, subtotal, total, and non-product lines.
                Return a JSON array of items.`
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
              name: { type: Type.STRING },
              quantity: { type: Type.STRING },
              category: { type: Type.STRING }
            },
            required: ["name", "category"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No data returned from Gemini");

    return JSON.parse(text) as GroceryItem[];

  } catch (error) {
    console.error("Gemini Grocery Receipt Parse Error:", error);
    throw new Error("Failed to parse grocery receipt.");
  }
};
