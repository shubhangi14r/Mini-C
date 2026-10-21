import {
  Token, TokenType, isKeyword,
  TWO_CHAR_OPERATORS, ONE_CHAR_OPERATORS, PUNCTUATION,
} from "./tokens";

export interface LexError {
  message: string;
  line: number;
  col: number;
}

export interface LexResult {
  tokens: Token[];     // always ends with an EOF token
  errors: LexError[];  // empty if the source is lexically valid
}

export function formatLexError(e: LexError): string {
  return `line ${e.line}, col ${e.col}: ${e.message}`;
}

const ESCAPES: Record<string, string> = {
  n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"',
};

const twoChar = new Set<string>(TWO_CHAR_OPERATORS);
const oneChar = new Set<string>([...ONE_CHAR_OPERATORS, ...PUNCTUATION]);

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c);

/** Turn MiniC source text into tokens. Never throws; problems go in `errors`. */
export function lex(source: string): LexResult {
  return new Lexer(source).run();
}

class Lexer {
  private i = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];
  private errors: LexError[] = [];

  constructor(private src: string) {}

  run(): LexResult {
    for (;;) {
      this.skipTrivia();
      if (this.i >= this.src.length) break;
      this.scanToken();
    }
    this.tokens.push({ type: "EOF", text: "", line: this.line, col: this.col });
    return { tokens: this.tokens, errors: this.errors };
  }

  // ---------- character helpers ----------

  /** Character at offset from the current position, or "" at end of input. */
  private peek(offset = 0): string {
    return this.src[this.i + offset] ?? "";
  }

  /** Consume one character, keeping line/column up to date. */
  private advance(): string {
    const c = this.src[this.i++];
    if (c === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return c;
  }

  private error(message: string, line: number, col: number) {
    this.errors.push({ message, line, col });
  }

  private emit(type: TokenType, start: number, line: number, col: number, value?: string | number) {
    const tok: Token = { type, text: this.src.slice(start, this.i), line, col };
    if (value !== undefined) tok.value = value;
    this.tokens.push(tok);
  }

  // ---------- whitespace and comments ----------

  private skipTrivia() {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.advance();
      } else if (c === "/" && this.peek(1) === "/") {
        while (this.peek() !== "" && this.peek() !== "\n") this.advance();
      } else if (c === "/" && this.peek(1) === "*") {
        const line = this.line, col = this.col;
        this.advance(); this.advance();
        let closed = false;
        while (this.peek() !== "") {
          if (this.peek() === "*" && this.peek(1) === "/") {
            this.advance(); this.advance();
            closed = true;
            break;
          }
          this.advance();
        }
        if (!closed) this.error("unterminated block comment", line, col);
      } else {
        return;
      }
    }
  }

  // ---------- tokens ----------

  private scanToken() {
    const c = this.peek();
    if (isIdentStart(c)) return this.scanWord();
    if (isDigit(c)) return this.scanNumber();
    if (c === '"') return this.scanString();
    if (c === "'") return this.scanChar();
    this.scanOperator();
  }

  private scanWord() {
    const start = this.i, line = this.line, col = this.col;
    while (isIdentPart(this.peek())) this.advance();
    const word = this.src.slice(start, this.i);
    this.emit(isKeyword(word) ? word : "IDENT", start, line, col);
  }

  private scanNumber() {
    const start = this.i, line = this.line, col = this.col;
    let type: "INT" | "LONG" | "FLOAT" = "INT";
    let malformed = false;

    while (isDigit(this.peek())) this.advance();

    if (this.peek() === "." && isDigit(this.peek(1))) {
      type = "FLOAT";
      this.advance();
      while (isDigit(this.peek())) this.advance();
      if (this.peek() === "e" || this.peek() === "E") {
        const hasSign = this.peek(1) === "+" || this.peek(1) === "-";
        this.advance();
        if (hasSign) this.advance();
        if (isDigit(this.peek())) {
          while (isDigit(this.peek())) this.advance();
        } else {
          malformed = true; // exponent with no digits, e.g. 1.5e
        }
      }
    } else if (this.peek() === "L") {
      type = "LONG";
      this.advance();
    }

    // A number glued to letters or underscores, e.g. 12abc or 3.14f
    if (isIdentPart(this.peek())) {
      malformed = true;
      while (isIdentPart(this.peek())) this.advance();
    }

    if (malformed) {
      const text = this.src.slice(start, this.i);
      this.error(`malformed number '${text}'`, line, col);
    } else {
      this.emit(type, start, line, col);
    }
  }

  /**
   * Read one possibly-escaped character inside a char or string literal.
   * Returns the decoded character, "" if the literal ended (newline / EOF),
   * or null after reporting an invalid escape.
   */
  private readLiteralChar(): string | null {
    if (this.peek() !== "\\") return this.advance();
    const line = this.line, col = this.col;
    this.advance(); // backslash
    const e = this.peek();
    if (e === "" || e === "\n") return ""; // caller reports "unterminated"
    this.advance();
    const decoded = ESCAPES[e];
    if (decoded === undefined) {
      this.error(`invalid escape sequence '\\${e}'`, line, col);
      return null;
    }
    return decoded;
  }

  private scanString() {
    const start = this.i, line = this.line, col = this.col;
    this.advance(); // opening quote
    let value = "";
    let ok = true;
    for (;;) {
      const c = this.peek();
      if (c === "" || c === "\n") {
        this.error("unterminated string literal", line, col);
        return;
      }
      if (c === '"') {
        this.advance();
        break;
      }
      const ch = this.readLiteralChar();
      if (ch === null) ok = false;
      else value += ch;
    }
    if (ok) this.emit("STRING", start, line, col, value);
  }

  private scanChar() {
    const start = this.i, line = this.line, col = this.col;
    this.advance(); // opening quote

    if (this.peek() === "'") {
      this.advance();
      this.error("empty character literal", line, col);
      return;
    }
    if (this.peek() === "" || this.peek() === "\n") {
      this.error("unterminated character literal", line, col);
      return;
    }

    const ch = this.readLiteralChar();
    let ok = ch !== null && ch !== "";

    if (this.peek() === "'") {
      this.advance();
    } else {
      // Too many characters or no closing quote: skip to the closing quote on this line.
      while (this.peek() !== "" && this.peek() !== "\n" && this.peek() !== "'") this.advance();
      if (this.peek() === "'") {
        this.advance();
        this.error("character literal must contain exactly one character", line, col);
      } else {
        this.error("unterminated character literal", line, col);
      }
      ok = false;
    }
    if (ok) this.emit("CHAR", start, line, col, (ch as string).charCodeAt(0));
  }

  private scanOperator() {
    const start = this.i, line = this.line, col = this.col;
    const two = this.peek() + this.peek(1);
    if (twoChar.has(two)) {
      this.advance(); this.advance();
      this.emit(two as TokenType, start, line, col);
      return;
    }
    const one = this.peek();
    if (oneChar.has(one)) {
      this.advance();
      this.emit(one as TokenType, start, line, col);
      return;
    }
    this.advance();
    this.error(`unexpected character '${one}'`, line, col);
  }
}
