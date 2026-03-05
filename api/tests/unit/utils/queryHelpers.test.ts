import { parseQueryInt } from '../../../src/utils/queryHelpers';

describe('parseQueryInt', () => {
  it('should return default when value is undefined', () => {
    expect(parseQueryInt(undefined, 50, 1)).toBe(50);
  });

  it('should return default when value is empty string', () => {
    expect(parseQueryInt('', 50, 1)).toBe(50);
  });

  it('should parse valid integer string', () => {
    expect(parseQueryInt('42', 50, 1)).toBe(42);
  });

  it('should return default for NaN', () => {
    expect(parseQueryInt('abc', 50, 1)).toBe(50);
  });

  it('should clamp to min value', () => {
    expect(parseQueryInt('-5', 50, 0)).toBe(0);
    expect(parseQueryInt('0', 50, 1)).toBe(1);
  });

  it('should clamp to max value when provided', () => {
    expect(parseQueryInt('5000', 50, 1, 1000)).toBe(1000);
  });

  it('should not clamp when max is not provided', () => {
    expect(parseQueryInt('5000', 50, 1)).toBe(5000);
  });

  it('should handle min and max together', () => {
    expect(parseQueryInt('500', 50, 1, 1000)).toBe(500); // within range
    expect(parseQueryInt('0', 50, 1, 1000)).toBe(1);     // below min
    expect(parseQueryInt('9999', 50, 1, 1000)).toBe(1000); // above max
  });

  it('should handle zero as min', () => {
    expect(parseQueryInt('0', 50, 0)).toBe(0);
  });

  it('should handle negative values with min', () => {
    expect(parseQueryInt('-10', 0, 0)).toBe(0);
  });
});
