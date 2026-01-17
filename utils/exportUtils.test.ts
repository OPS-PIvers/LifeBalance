import { describe, it, expect } from 'vitest';
import { convertToCSV } from './exportUtils';

describe('exportUtils', () => {
  describe('convertToCSV', () => {
    it('should convert simple data to CSV format', () => {
      const data = [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ];
      const csv = convertToCSV(data);
      expect(csv).toBe('name,age\n"John","30"\n"Jane","25"');
    });

    it('should handle null or undefined values', () => {
      const data = [
        { name: 'John', age: null },
        { name: 'Jane', age: undefined },
      ];
      const csv = convertToCSV(data);
      expect(csv).toBe('name,age\n"John",""\n"Jane",""');
    });

    it('should escape double quotes', () => {
      const data = [
        { name: 'John "The Rock" Doe' },
      ];
      const csv = convertToCSV(data);
      expect(csv).toBe('name\n"John ""The Rock"" Doe"');
    });

    // This test ensures CSV injection protection is working
    it('should sanitize CSV injection attempts', () => {
      const data = [
        { formula: '=1+1', malicious: '+cmd|' },
        { formula: '@SUM(1,1)', malicious: '-dangerous' },
        { formula: ' =1+1', malicious: '|DDE' }, // Leading whitespace and pipe
      ];
      const csv = convertToCSV(data);

      // Expect single quote prepended to dangerous characters
      expect(csv).toContain('"\'+cmd|"');
      expect(csv).toContain('"\'-dangerous"');

      // For formula starting with =, we expect prepended '
      expect(csv).toContain('"' + "'=1+1" + '"');
      expect(csv).toContain('"' + "'@SUM(1,1)" + '"');

      // Whitespace and DDE protection
      expect(csv).toContain('"' + "' =1+1" + '"');
      expect(csv).toContain('"' + "'|DDE" + '"');
    });

    it('should sanitize edge cases for CSV injection', () => {
      const data = [
        { char: '=' },
        { char: '+' },
        { char: '-' },
        { char: '@' },
        { char: '|' },
        { char: '   @' },
      ];
      const csv = convertToCSV(data);

      expect(csv).toContain('"' + "'=" + '"');
      expect(csv).toContain('"' + "'+" + '"');
      expect(csv).toContain('"' + "'-" + '"');
      expect(csv).toContain('"' + "'@" + '"');
      expect(csv).toContain('"' + "'|" + '"');
      expect(csv).toContain('"' + "'   @" + '"');
    });
  });
});
