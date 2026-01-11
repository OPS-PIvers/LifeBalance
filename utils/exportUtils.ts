/**
 * Utility functions for exporting data to files (JSON, CSV)
 */

/**
 * Triggers a browser download for a given content string
 */
const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  // Clean up after a small delay to ensure download has started
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
};

/**
 * Exports a full data object as a JSON file
 */
export const generateJsonBackup = (data: Record<string, any>, filenamePrefix: string = 'lifebalance-backup') => {
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `${filenamePrefix}-${dateStr}.json`;
  const content = JSON.stringify(data, null, 2);
  downloadFile(content, filename, 'application/json');
};

/**
 * Converts an array of flat objects to CSV format
 * Wraps all values in quotes for safety and escapes embedded quotes
 */
export const convertToCSV = (data: Record<string, any>[]): string => {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];

  for (const row of data) {
    const values = headers.map(header => {
      const val = row[header];
      const escaped = ('' + (val ?? '')).replace(/"/g, '""'); // Escape double quotes
      return `"${escaped}"`; // Wrap in quotes
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
};

/**
 * Exports an array of objects as a CSV file
 */
export const generateCsvExport = (data: Record<string, any>[], filenamePrefix: string = 'export') => {
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `${filenamePrefix}-${dateStr}.csv`;
  const content = convertToCSV(data);
  downloadFile(content, filename, 'text/csv');
};
