import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini Client
// Note: In a production app, the key should come from a secure backend or proxy.
// For this frontend-only demo, we assume process.env.API_KEY is available.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export interface ReceiptData {
  merchant: string;
  amount: number;
  category: string;
  date: string;
}

export const analyzeReceipt = async (base64Image: string): Promise<ReceiptData> => {
  try {
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: cleanBase64
                }
            },
            {
                text: "Analyze this receipt image. Extract the merchant name, total amount, date (YYYY-MM-DD format), and suggest a category (Groceries, Dining, Gas, Shopping, Utilities, Transport). Return JSON."
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
