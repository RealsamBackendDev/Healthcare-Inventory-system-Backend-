const { QUANTITY_EPSILON } = require('../constants');

const toNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const roundQuantity = (value) => Math.round((value + Number.EPSILON) * 1000000) / 1000000;

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const isZero = (value) => Math.abs(value) < QUANTITY_EPSILON;

const isPositive = (value) => value > QUANTITY_EPSILON;

const isNegative = (value) => value < -QUANTITY_EPSILON;

const isNonNegative = (value) => value >= -QUANTITY_EPSILON;

const hasSufficient = (available, requested) => available + QUANTITY_EPSILON >= requested;

const addQuantity = (left, right) => roundQuantity(left + right);

const subtractQuantity = (left, right) => roundQuantity(left - right);

const multiplyMoney = (quantity, unitCost) => roundMoney(quantity * unitCost);

const formatQuantity = (value) => {
  const rounded = roundQuantity(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const formatMoney = (value) => roundMoney(value).toFixed(2);

module.exports = {
  toNumber,
  roundQuantity,
  roundMoney,
  isZero,
  isPositive,
  isNegative,
  isNonNegative,
  hasSufficient,
  addQuantity,
  subtractQuantity,
  multiplyMoney,
  formatQuantity,
  formatMoney
};
