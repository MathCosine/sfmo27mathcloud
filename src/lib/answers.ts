/**
 * Turning what someone typed into something comparable with the key.
 *
 * The server only compares strings, so this one function decides what counts
 * as "the same answer": spaces, dollar signs, \dfrac vs \frac, a leading +,
 * thousands commas and unicode minus signs never matter, and plain numbers are
 * compared by value (0.375, 3/8 and 6/16 are all 3/8). Expressions are left as
 * typed apart from spacing, so 2\sqrt{3}, 2sqrt3 and 2√3 match each other but
 * not sqrt12; list every form you accept in the key.
 */

function readGroup(s: string, i: number): [string, number] | null {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return [s.slice(i + 1, j), j + 1];
    }
  }
  return null;
}

function readArg(s: string, i: number): [string, number] | null {
  while (s[i] === ' ') i++;
  if (s[i] === '{') return readGroup(s, i);
  return i < s.length ? [s[i], i + 1] : null;
}

const atom = (s: string) => (/^-?[\w.]+(\([^()]*\))?$/.test(s) ? s : `(${s})`);

function latexToPlain(input: string): string {
  let s = input;
  s = s.replace(/\\[dt]frac/g, '\\frac');
  s = s.replace(/\\left|\\right|\\,|\\;|\\!|\\ /g, '');
  s = s.replace(/\\cdot|\\times/g, '*');
  s = s.replace(/\\pi\b/g, 'pi');
  s = s.replace(/\\infty\b/g, 'inf');
  for (let guard = 0; guard < 30; guard++) {
    const f = s.indexOf('\\frac');
    const r = s.indexOf('\\sqrt');
    if (f === -1 && r === -1) break;
    if (f !== -1 && (r === -1 || f < r)) {
      const a = readArg(s, f + 5);
      const b = a && readArg(s, a[1]);
      if (!a || !b) break;
      s = s.slice(0, f) + `${atom(latexToPlain(a[0]))}/${atom(latexToPlain(b[0]))}` + s.slice(b[1]);
    } else {
      const a = readArg(s, r + 5);
      if (!a) break;
      s = s.slice(0, r) + `sqrt(${latexToPlain(a[0])})` + s.slice(a[1]);
    }
  }
  s = s.replace(/\^\{([^{}]*)\}/g, (_, e: string) => `^${atom(e)}`);
  s = s.replace(/[{}]/g, '');
  return s;
}

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

function decimalToFraction(t: string): [bigint, bigint] | null {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const frac = m[3] ?? '';
  const num = BigInt((m[2] || '0') + frac) * (m[1] ? -1n : 1n);
  return [num, 10n ** BigInt(frac.length)];
}

/** "7", "-0.375", "6/16", "(-3)/4" as a reduced fraction string; null for anything else. */
export function canonicalNumber(s: string): string | null {
  if (s.length > 60) return null;
  const parts = s.split('/');
  if (parts.length > 2) return null;
  const strip = (p: string) => p.replace(/^\((.*)\)$/, '$1');
  const top = decimalToFraction(strip(parts[0]));
  if (!top) return null;
  let [n, d] = top;
  if (parts.length === 2) {
    const bottom = decimalToFraction(strip(parts[1]));
    if (!bottom || bottom[0] === 0n) return null;
    n = n * bottom[1];
    d = d * bottom[0];
  }
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n;
  n /= g;
  d /= g;
  return d === 1n ? n.toString() : `${n}/${d}`;
}

export function normalize(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/^\$+|\$+$/g, '').replace(/^\\\(|\\\)$/g, '');
  s = s.replace(/[\u2212\u2013\u2014]/g, '-').replace(/[\u00d7\u22c5\u00b7]/g, '*').replace(/\u00f7/g, '/');
  s = s.replace(/\u03c0/g, '\\pi ').replace(/\u221a/g, '\\sqrt');
  s = latexToPlain(s);
  s = s.replace(/\s+/g, '').toLowerCase();
  s = s.replace(/^\+/, '').replace(/\.$/, '');
  s = s.replace(/sqrt(\d+|[a-z])(?![\w(])/g, 'sqrt($1)');
  s = s.replace(/(\d)\*(?=[a-z(])/g, '$1');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  return canonicalNumber(s) ?? s;
}

/** Accepted answers typed by staff, one per line or separated by | or ;. */
export function splitKeys(text: string): string[] {
  return text
    .split(/\n|\||;/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function keysFor(answers: string[]): string[] {
  return [...new Set(answers.map(normalize).filter(Boolean))];
}

/** A best-effort TeX rendering of a typed answer for the live preview. */
export function answerToTex(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  if (s.includes('\\')) return s.replace(/^\$+|\$+$/g, '');
  s = s.replace(/sqrt\(([^()]*)\)/g, '\\sqrt{$1}').replace(/sqrt(\d+|[a-z])/g, '\\sqrt{$1}');
  s = s.replace(/\bpi\b/g, '\\pi');
  s = s.replace(/(\([^()]*\)|[\w.\\{}]+)\/(\([^()]*\)|[\w.\\{}]+)/g, (_, a: string, b: string) => `\\frac{${a.replace(/^\((.*)\)$/, '$1')}}{${b.replace(/^\((.*)\)$/, '$1')}}`);
  s = s.replace(/\*/g, '\\cdot ');
  return s;
}

/** Worth showing a rendered preview under the answer box? */
export function looksMathy(raw: string): boolean {
  return /[\\/^]|sqrt|pi|\u221a|\u03c0/.test(raw);
}
