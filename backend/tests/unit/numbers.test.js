const {
  toNumber,
  roundQuantity,
  roundMoney,
  isZero,
  isNegative,
  hasSufficient,
  addQuantity,
  subtractQuantity,
  multiplyMoney
} = require('../../src/shared/utils/numbers');

describe('quantity helpers', () => {
  test('parses numeric strings and rejects invalid input', () => {
    expect(toNumber('2.5')).toBe(2.5);
    expect(toNumber('')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(10)).toBe(10);
  });

  test('rounds quantities to six decimal places', () => {
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
    expect(roundQuantity(1.0000004)).toBe(1);
  });

  test('rounds money to two decimal places', () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(2.344)).toBe(2.34);
  });

  test('treats floating point residue as zero', () => {
    expect(isZero(0.0000000001)).toBe(true);
    expect(isZero(0.0001)).toBe(false);
  });

  test('compares stock with a tolerance so 0.1 + 0.2 covers 0.3', () => {
    expect(hasSufficient(0.1 + 0.2, 0.3)).toBe(true);
    expect(hasSufficient(0.3, 0.31)).toBe(false);
  });

  test('adds and subtracts without floating point drift', () => {
    expect(addQuantity(0.1, 0.2)).toBe(0.3);
    expect(subtractQuantity(0.3, 0.1)).toBe(0.2);
    expect(subtractQuantity(1, 0.5)).toBe(0.5);
  });

  test('detects negative quantities beyond tolerance', () => {
    expect(isNegative(-0.0000000001)).toBe(false);
    expect(isNegative(-0.01)).toBe(true);
  });

  test('calculates monetary value', () => {
    expect(multiplyMoney(2.5, 10)).toBe(25);
    expect(multiplyMoney(3, 1.115)).toBe(3.35);
  });
});
