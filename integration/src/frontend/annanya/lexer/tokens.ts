// Token definitions for MiniC (see docs/language_spec.md, sections 3 and 4).

export const KEYWORDS = [
  "int", "long", "float", "bool", "char", "string", "void", "struct",
  "if", "else", "while", "for", "do", "switch", "case", "default",
  "break", "continue", "return", "new", "free", "true", "false", "null",
] as const;
export type Keyword = (typeof KEYWORDS)[number];

// Two-character operators. Checked before single-character ones (longest match).
export const TWO_CHAR_OPERATORS = [
  "==", "!=", "<=", ">=", "&&", "||", "<<", ">>",
  "++", "--", "+=", "-=", "*=", "/=", "%=", "->",
] as const;

export const ONE_CHAR_OPERATORS = [
  "+", "-", "*", "/", "%", "=", "<", ">", "!", "&", "|", "^", "~", "?", ":",
] as const;

export const PUNCTUATION = ["(", ")", "{", "}", "[", "]", ";", ",", "."] as const;

export type Operator =
  | (typeof TWO_CHAR_OPERATORS)[number]
  | (typeof ONE_CHAR_OPERATORS)[number];
export type Punctuation = (typeof PUNCTUATION)[number];

// Keywords, operators and punctuation use their own text as the token type
// (e.g. type "while", type "+="). Everything else uses one of these names.
export type TokenType =
  | "IDENT" | "INT" | "LONG" | "FLOAT" | "CHAR" | "STRING" | "EOF"
  | Keyword | Operator | Punctuation;

export interface Token {
  type: TokenType;
  text: string;     // the exact source text of the token
  line: number;     // 1-based
  col: number;      // 1-based
  // Decoded value for literals that have escapes:
  //   CHAR   -> character code (number)
  //   STRING -> decoded string
  value?: string | number;
}

const keywordSet = new Set<string>(KEYWORDS);
export function isKeyword(word: string): word is Keyword {
  return keywordSet.has(word);
}
