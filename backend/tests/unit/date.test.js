const { parseDateInput, todayIsoDate, toIsoDate } = require('../../src/shared/utils/date');

describe('date helpers', () => {
  test('parses ISO dates', () => {
    expect(parseDateInput('2027-03-15')).toBe('2027-03-15');
  });

  test('parses day first dates used on import spreadsheets', () => {
    expect(parseDateInput('15/03/2027')).toBe('2027-03-15');
    expect(parseDateInput('15-03-2027')).toBe('2027-03-15');
  });

  test('rejects impossible calendar dates', () => {
    expect(parseDateInput('2027-02-30')).toBeNull();
    expect(parseDateInput('31/04/2027')).toBeNull();
  });

  test('returns null for empty and invalid values', () => {
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput(null)).toBeNull();
    expect(parseDateInput('not a date')).toBeNull();
  });

  test('parses Excel serial dates', () => {
    expect(parseDateInput(45000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('formats today as an ISO date', () => {
    expect(todayIsoDate()).toBe(toIsoDate(new Date()));
  });
});
