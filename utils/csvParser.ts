
/**
 * Simple CSV parser that handles quoted values and commas within quotes.
 */
export const parseCSV = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1] || '';

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i++; // Skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentVal);
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (currentVal || currentRow.length > 0) {
        currentRow.push(currentVal);
        rows.push(currentRow);
        currentRow = [];
        currentVal = '';
      }
      if (char === '\r' && nextChar === '\n') i++;
    } else {
      currentVal += char;
    }
  }
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal);
    rows.push(currentRow);
  }
  return rows;
};

export interface CSVMapping {
  dateIndex: number;
  amountIndex: number;
  merchantIndex: number;
  categoryIndex?: number;
}

export interface CSVParseResult {
  merchant: string;
  amount: number;
  date: string;
  category: string;
}

/**
 * Maps a row to a transaction object based on column indices.
 */
export const mapRowToTransaction = (
  row: string[],
  mapping: CSVMapping
): CSVParseResult | null => {
  try {
    const dateRaw = row[mapping.dateIndex]?.trim();
    let amountRaw = row[mapping.amountIndex]?.trim();
    const merchantRaw = row[mapping.merchantIndex]?.trim();
    const categoryRaw = mapping.categoryIndex !== undefined ? row[mapping.categoryIndex]?.trim() : '';

    if (!dateRaw || !amountRaw || !merchantRaw) return null;

    // Handle currency symbols ($, £, etc.) and commas
    amountRaw = amountRaw.replace(/[^0-9.-]/g, '');
    let amount = parseFloat(amountRaw);

    if (isNaN(amount)) return null;

    // Convert to positive number (Expenses are stored as positive in the app logic)
    amount = Math.abs(amount);

    // Simple Date Normalization (MM/DD/YYYY -> YYYY-MM-DD)
    let date = dateRaw;
    if (date.includes('/')) {
        const parts = date.split('/');
        if (parts.length === 3) {
            // Check for MM/DD/YYYY format
            if (parts[2].length === 4) {
               const y = parts[2];
               const m = parts[0].padStart(2, '0');
               const d = parts[1].padStart(2, '0');
               date = `${y}-${m}-${d}`;
            }
        }
    }

    return {
      merchant: merchantRaw,
      amount,
      date,
      category: categoryRaw || 'Uncategorized'
    };
  } catch (_e) {
    return null;
  }
};
