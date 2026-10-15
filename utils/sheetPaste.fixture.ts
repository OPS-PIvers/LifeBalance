// Test fixture: the household's October 2026 sheet as Google Sheets puts it on the
// clipboard: A Date | B Expense Name | C $ | D Actual | E Remaining | F |
// G Date | H Expense Name | I $.
type L = [string?, string?, string?, string?, string?];
type R = [string?, string?, string?];
const row = (l: L = [], r: R = []) =>
  [l[0] ?? '', l[1] ?? '', l[2] ?? '', l[3] ?? '', l[4] ?? '', '', r[0] ?? '', r[1] ?? '', r[2] ?? ''].join('\t');

export const OCTOBER_SHEET_PASTE = [
  row(['Date', 'Expense Name', '$'], ['Date', 'Expense Name', '$']),
  row(['', 'Paycheck', '5703'], ['', 'Paycheck', '5703']),
  row(['1', 'Mortgage', '2166'], ['16', 'Heloc', '400']),
  row(['', 'Xcel', '133.53'], ['', 'Paul Car', '498']),
  row(['', 'Jen Car', '639'], ['', 'Paul Visa Min', '50']),
  row(['', 'Jen tabs', '602'], ['', 'Ferry Ride', '160']),
  row(['', 'Jen Visa Minimum', '72']),
  row(['', 'Parkway', '80']),
  row(['', 'AT&T', '143.8']),
  row(['', 'Haferman Water', '36.56'], ['', 'Fidelity', '100']),
  row(['', 'Manny Meds', '108'], ['', 'Easton 529', '50']),
  row(['2', 'Stella bday gift', '40'], ['17', 'Comcast', '158']),
  row(),
  row(['3', 'Auto-Owners Life', '83'], ['18', 'American Express', '735']),
  row(['4'], ['19', 'Auto-Owners Car/Home', '225']),
  row([], ['', 'Camp Bow Wow', '300']),
  row([], ['', 'Airport Parking', '100']),
  row([], ['', 'Parkway', '80']),
  row(['5', 'Jen Hair', '200'], ['20']),
  row(['6'], ['21']),
  row(['7', 'Parkway', '80'], ['22']),
  row(['8'], ['23', 'Paul Hockey', '219']),
  row(['9'], ['24']),
  row(['10'], ['25']),
  row(['11'], ['26', 'Parkway', '80']),
  row([], ['', 'Centerpoint', '38.75']),
  row(['12'], ['27']),
  row(['13', 'Spotify Premium', '22'], ['28', 'Xcel', '98.68']),
  row(['14', 'Parkway', '80'], ['29']),
  row(['15'], ['30']),
  row(['', '', 'Projected Expenses', 'Actual Expenses', 'REMAINING'], ['31']),
  row(['Other Expenses', 'Gas', '120'], ['', '', 'Projected Expenses']),
  row(['', 'Grocery/Misc', '850'], ['Other Expenses', 'Gas', '110']),
  row(['', 'Daycare'], ['', 'Grocery/Misc', '850']),
  row(['', 'Jen Credit Card']),
  row(['', 'Paul Credit Card', '', '0', '0'], ['', 'Childcare', '400']),
  row(['', 'AmEx', '700', '', '700'], ['', 'AmEx']),
  row(['', 'Leftover to savings'], ['', 'Leftover to savings', '900']),
  row(['', 'Proj/Actual']),
  row([], ['', 'Total Other Expenses', '2260']),
  row(['', '1st half TOTAL Expenses', '6155.89', '0']),
  row(['', '1st half Remainder', '-452.89', '5703'], ['', '2nd half TOTAL Expenses', '5552.43']),
  row([], ['', '2nd half Remainder', '150.57']),
].join('\n');
