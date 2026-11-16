import { describe, expect, it } from 'vitest';
import { answerToTex, canonicalNumber, keysFor, normalize, splitKeys } from './answers';

describe('normalize', () => {
  it('ignores typing differences', () => {
    expect(normalize(' 42 ')).toBe('42');
    expect(normalize('+42')).toBe('42');
    expect(normalize('$42$')).toBe('42');
    expect(normalize('042')).toBe('42');
    expect(normalize('1,000')).toBe('1000');
    expect(normalize('−7')).toBe('-7');
    expect(normalize('12.')).toBe('12');
  });

  it('compares plain numbers by value', () => {
    for (const x of ['3/8', '0.375', '6/16', '\\frac{3}{8}', '\\dfrac38', '$\\frac{3}{8}$', '.375']) expect(normalize(x)).toBe('3/8');
    expect(normalize('-3/4')).toBe('-3/4');
    expect(normalize('3/-4')).toBe('-3/4');
    expect(normalize('(-3)/4')).toBe('-3/4');
    expect(normalize('4/2')).toBe('2');
    expect(normalize('2.50')).toBe('5/2');
    expect(normalize('-0')).toBe('0');
    expect(normalize('1/0')).toBe('1/0');
  });

  it('keeps expressions, tidied', () => {
    expect(normalize('2\\sqrt{3}')).toBe('2sqrt(3)');
    expect(normalize('2 sqrt 3')).toBe('2sqrt(3)');
    expect(normalize('2√3')).toBe('2sqrt(3)');
    expect(normalize('2*sqrt(3)')).toBe('2sqrt(3)');
    expect(normalize('\\frac{\\sqrt{3}}{2}')).toBe('sqrt(3)/2');
    expect(normalize('3π')).toBe('3pi');
    expect(normalize('3\\pi')).toBe('3pi');
    expect(normalize('X^{2}')).toBe('x^2');
  });

  it('builds keys from staff input', () => {
    expect(splitKeys('3/8 | 0.375\n6/16')).toEqual(['3/8', '0.375', '6/16']);
    expect(keysFor(['3/8', '0.375', '2\\sqrt3'])).toEqual(['3/8', '2sqrt(3)']);
    expect(canonicalNumber('abc')).toBeNull();
  });

  it('renders typed answers as TeX', () => {
    expect(answerToTex('3/8')).toBe('\\frac{3}{8}');
    expect(answerToTex('2sqrt(3)')).toBe('2\\sqrt{3}');
  });
});
