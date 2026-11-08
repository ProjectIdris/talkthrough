// A very small arithmetic language for the rows of the kit table (kit-presets.ts): numbers, names, + - * / %, comparisons, && || !, `a ? b : c`,
// parentheses, quoted strings and a few functions. A row is data, so its formulas are text; this reads that text. It runs nothing else: no property
// access, no calls beyond the list below, no assignment. A formula is read once and kept.

export type Value = number | string | boolean;
export type Scope = { [name: string]: unknown };

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, cos: Math.cos, sin: Math.sin, atan2: Math.atan2, floor: Math.floor, sqrt: Math.sqrt,
};

type Node = (scope: Scope) => Value;

const TOKEN = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|('[^']*'|"[^"]*")|(&&|\|\||==|!=|<=|>=|[-+*/%<>!?:(),]))/y;

function tokens(text: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(text);
    if (!m) { if (/^\s*$/.test(text.slice(at))) break; throw new Error(`kit formula "${text}": cannot read it at ${at}`); }
    out.push(m[0].trim());
  }
  return out;
}

function parse(text: string): Node {
  const t = tokens(text);
  let at = 0;
  const peek = () => t[at];
  const take = (want?: string): string => {
    const v = t[at++];
    if (v === undefined || (want !== undefined && v !== want)) throw new Error(`kit formula "${text}": expected ${want ?? 'more'}, found ${v ?? 'the end'}`);
    return v;
  };

  const ternary = (): Node => {
    const test = or();
    if (peek() !== '?') return test;
    take('?');
    const yes = ternary();
    take(':');
    const no = ternary();
    return (s) => (test(s) ? yes(s) : no(s));
  };
  const binary = (next: () => Node, ops: Record<string, (a: never, b: never) => Value>): Node => {
    let left = next();
    while (peek() !== undefined && Object.hasOwn(ops, peek()!)) {
      const op = ops[take()]!;
      const l = left, r = next();
      left = (s) => op(l(s) as never, r(s) as never);
    }
    return left;
  };
  const or = (): Node => {
    let left = and();
    while (peek() === '||') { take(); const l = left, r = and(); left = (s) => l(s) || r(s); }
    return left;
  };
  const and = (): Node => {
    let left = equality();
    while (peek() === '&&') { take(); const l = left, r = equality(); left = (s) => l(s) && r(s); }
    return left;
  };
  const equality = (): Node => binary(relational, { '==': (a, b) => a === b, '!=': (a, b) => a !== b });
  const relational = (): Node => binary(additive, { '<': (a: number, b: number) => a < b, '<=': (a: number, b: number) => a <= b, '>': (a: number, b: number) => a > b, '>=': (a: number, b: number) => a >= b } as never);
  const additive = (): Node => binary(multiplicative, { '+': (a: number, b: number) => a + b, '-': (a: number, b: number) => a - b } as never);
  const multiplicative = (): Node => binary(unary, { '*': (a: number, b: number) => a * b, '/': (a: number, b: number) => a / b, '%': (a: number, b: number) => a % b } as never);
  const unary = (): Node => {
    if (peek() === '-') { take(); const v = unary(); return (s) => -(v(s) as number); }
    if (peek() === '!') { take(); const v = unary(); return (s) => !v(s); }
    return primary();
  };
  const primary = (): Node => {
    const v = take();
    if (v === '(') { const inner = ternary(); take(')'); return inner; }
    if (/^[\d.]/.test(v)) { const n = Number(v); return () => n; }
    if (v[0] === "'" || v[0] === '"') { const str = v.slice(1, -1); return () => str; }
    if (/^[A-Za-z_]/.test(v)) {
      if (peek() === '(') {
        const fn = FUNCTIONS[v];
        if (!fn) throw new Error(`kit formula "${text}": unknown function ${v}`);
        take('(');
        const args: Node[] = [];
        if (peek() !== ')') for (;;) { args.push(ternary()); if (peek() === ',') take(','); else break; }
        take(')');
        return (s) => fn(...args.map((a) => a(s) as number));
      }
      return (s) => {
        if (!(v in s)) throw new Error(`kit formula "${text}": ${v} is not known here`);
        return s[v] as Value;
      };
    }
    throw new Error(`kit formula "${text}": unexpected ${v}`);
  };

  const root = ternary();
  if (at < t.length) throw new Error(`kit formula "${text}": unexpected ${t[at]}`);
  return root;
}

const READ = new Map<string, Node>();

/** A formula's value in a scope; a number, string or boolean in a row stands for itself. */
export function evaluate(e: Value, scope: Scope): Value {
  if (typeof e !== 'string') return e;
  let node = READ.get(e);
  if (!node) { node = parse(e); READ.set(e, node); }
  return node(scope);
}

export const num = (e: Value, scope: Scope): number => evaluate(e, scope) as number;

/** A scope inside another: names set here shadow it, the rest are read through. */
export const inner = (scope: Scope): Scope => Object.create(scope) as Scope;

/** The constants every formula can use. */
export const BASE: Scope = { pi: Math.PI, deg: Math.PI / 180 };
