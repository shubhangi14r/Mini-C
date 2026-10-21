// MiniC parser: hand-written recursive descent for declarations and statements,
// precedence climbing for binary expressions. See src/parser/grammar.md.
//
// Phase 2 scope: functions (int / void), variable declarations, assignments
// (including += and ++, desugared), calls, return, and all expression
// operators except ~, ?: and casts. Anything the AST contract does not cover
// yet reports "not supported yet (Phase N)" instead of guessing a node shape.

import { lex, formatLexError, LexError } from "../lexer/lexer";
import { Token, TokenType } from "../lexer/tokens";
import {
  Assign, Binary, Break, Call, Continue, DoWhile, Expr, ExprStmt, For, Func,
  If, IntLit, Logical, Param, Program, Return, Stmt, Type, Unary, VarDecl,
  VarRef, While,
} from "../ast/nodes";

export type ParseError = LexError; // { message, line, col }
export const formatParseError = formatLexError; // "line L, col C: message"

export interface ParseResult {
  program: Program;
  errors: ParseError[];
}

/** Thrown by parse() when the source has errors. Contains all of them. */
export class ParseFailure extends Error {
  constructor(public errors: ParseError[]) {
    super(errors.map(formatParseError).join("\n"));
    this.name = "ParseFailure";
  }
}

/** Parse source text. Throws ParseFailure (with every error found) if invalid. */
export function parse(source: string): Program {
  const { program, errors } = parseWithErrors(source);
  if (errors.length > 0) throw new ParseFailure(errors);
  return program;
}

/** Like parse(), but returns the errors instead of throwing. */
export function parseWithErrors(source: string): ParseResult {
  const lexed = lex(source);
  if (lexed.errors.length > 0) {
    // Dropped or mangled tokens would cause misleading syntax errors,
    // so report the lexical errors on their own.
    return { program: { kind: "Program", funcs: [] }, errors: lexed.errors };
  }
  return new Parser(lexed.tokens).parseProgram();
}

// The parser leaves this in every expression's `type`; the type checker overwrites it.
const PLACEHOLDER: Type = "int";

const INT_MAX = 2147483647;

// Binary operator precedence (higher binds tighter). All are left-associative.
// Levels match docs/language_spec.md section 4 (levels 3 to 12).
const BINARY_PREC = new Map<string, number>([
  ["||", 1], ["&&", 2], ["|", 3], ["^", 4], ["&", 5],
  ["==", 6], ["!=", 6],
  ["<", 7], ["<=", 7], [">", 7], [">=", 7],
  ["<<", 8], [">>", 8],
  ["+", 9], ["-", 9],
  ["*", 10], ["/", 10], ["%", 10],
]);

// x op= e   ->   x = x op e
const COMPOUND_OPS = new Map<string, string>([
  ["+=", "+"], ["-=", "-"], ["*=", "*"], ["/=", "/"], ["%=", "%"],
]);

const describe = (t: Token) => (t.type === "EOF" ? "end of input" : `'${t.text}'`);

/** Internal: aborts the current statement; caught and recorded by the recovery loops. */
class SyntaxErr {
  constructor(public error: ParseError) {}
}

type At = { line: number; col: number };

class Parser {
  private pos = 0;
  private errors: ParseError[] = [];

  constructor(private toks: Token[]) {}

  // ---------- token helpers ----------

  private get cur(): Token { return this.toks[this.pos]; }
  private peekType(offset: number): TokenType {
    return (this.toks[this.pos + offset] ?? this.toks[this.toks.length - 1]).type;
  }
  private check(type: TokenType): boolean { return this.cur.type === type; }

  private advance(): Token {
    const t = this.cur;
    if (t.type !== "EOF") this.pos++;
    return t;
  }

  private match(type: TokenType): Token | null {
    return this.check(type) ? this.advance() : null;
  }

  /** Abort the current statement with an error at `at` (default: current token). */
  private fail(message: string, at: At = this.cur): never {
    throw new SyntaxErr({ message, line: at.line, col: at.col });
  }

  /** Consume `type`, or fail. A missing token is reported just after the previous token. */
  private expect(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    if (this.pos > 0) {
      const p = this.toks[this.pos - 1];
      this.fail(message, { line: p.line, col: p.col + p.text.length });
    }
    return this.fail(message);
  }

  private unsupported(t: Token, phase: number): never {
    return this.fail(`'${t.text}' is not supported yet (Phase ${phase})`, t);
  }

  // ---------- recovery ----------

  /** Skip past the end of the broken statement: the next ';' (outside braces) or a balanced {...}. */
  private syncStatement() {
    let depth = 0;
    while (!this.check("EOF")) {
      const t = this.cur.type;
      if (t === "}") {
        if (depth === 0) return; // belongs to the enclosing block
        depth--;
        this.advance();
        if (depth === 0) return;
        continue;
      }
      if (t === "{") depth++;
      this.advance();
      if (t === ";" && depth === 0) return;
    }
  }

  /** Skip past the end of the broken top-level declaration. */
  private syncTopLevel() {
    let depth = 0;
    while (!this.check("EOF")) {
      const t = this.advance().type;
      if (t === "{") depth++;
      else if (t === "}") {
        depth--;
        if (depth <= 0) return;
      } else if (t === ";" && depth === 0) return;
    }
  }

  private recover(e: unknown, sync: () => void) {
    if (!(e instanceof SyntaxErr)) throw e;
    this.errors.push(e.error);
    sync();
  }

  // ---------- program and functions ----------

  parseProgram(): ParseResult {
    const funcs: Func[] = [];
    while (!this.check("EOF")) {
      try {
        funcs.push(this.parseFunc());
      } catch (e) {
        this.recover(e, () => this.syncTopLevel());
      }
    }
    return { program: { kind: "Program", funcs }, errors: this.errors };
  }

  private parseType(): Type {
    const t = this.cur;
    switch (t.type) {
      case "int": this.advance(); return "int";
      case "void": this.advance(); return "void";
      case "long": case "float": case "bool": case "char":
        return this.unsupported(t, 4);
      case "string": case "struct":
        return this.unsupported(t, 5);
      default:
        return this.fail(`expected a type, found ${describe(t)}`);
    }
  }

  private parseFunc(): Func {
    const start = this.cur;
    const returnType = this.parseType();
    const name = this.expect("IDENT", "expected a function name after the return type");

    if (this.check(";") || this.check("=")) {
      this.fail("global variables are not supported yet (Phase 5)", start);
    }
    this.expect("(", "expected '(' after the function name");

    const params: Param[] = [];
    if (!this.check(")")) {
      do {
        const typeTok = this.cur;
        const type = this.parseType();
        if (type === "void") this.fail("a parameter cannot have type 'void'", typeTok);
        const pname = this.expect("IDENT", "expected a parameter name");
        params.push({ name: pname.text, type });
      } while (this.match(","));
    }
    this.expect(")", "expected ')' after the parameters");

    if (this.check(";")) {
      this.fail("forward declarations are not supported yet", this.cur);
    }
    this.expect("{", "expected '{' before the function body");
    const body = this.parseBlockBody("expected '}' to close the function body");
    return {
      kind: "Func", line: start.line, col: start.col,
      name: name.text, params, returnType, body,
    };
  }

  /** Statements up to and including the closing '}'. Recovers from errors inside. */
  private parseBlockBody(closeMessage: string): Stmt[] {
    const body: Stmt[] = [];
    while (!this.check("}") && !this.check("EOF")) {
      try {
        if (this.match("{")) {
          body.push(...this.parseBlockBody("expected '}' to close block"));
        } else {
          body.push(this.parseStatement());
        }
      } catch (e) {
        this.recover(e, () => this.syncStatement());
      }
    }
    this.expect("}", closeMessage);
    return body;
  }

  // ---------- statements ----------

  private parseStatement(): Stmt {
    const t = this.cur;
    switch (t.type) {
      case "int": case "void": case "long": case "float":
      case "bool": case "char": case "string": case "struct":
        return this.parseVarDecl();
      case "return":
        return this.parseReturn();
      case "if": return this.parseIf();
      case "while": return this.parseWhile();
      case "for": return this.parseFor();
      case "do": return this.parseDoWhile();
      case "break": {
        this.advance();
        this.expect(";", "expected ';' after break");
        return { kind: "Break", line: t.line, col: t.col };
      }
      case "continue": {
        this.advance();
        this.expect(";", "expected ';' after continue");
        return { kind: "Continue", line: t.line, col: t.col };
      }
      case "switch":
        return this.unsupported(t, 7);
      case "{":
        return this.fail("nested blocks are not supported yet (Phase 3)", t);
      default: {
        const s = this.parseSimpleStatement();
        this.expect(";", s.kind === "ExprStmt"
          ? "expected ';' after expression"
          : "expected ';' after assignment");
        return s;
      }
    }
  }

  private parseBodyStatements(): Stmt[] {
    if (this.match("{")) return this.parseBlockBody("expected '}' to close block");
    return [this.parseStatement()];
  }

  private parseIf(): If {
    const t = this.advance();
    this.expect("(", "expected '(' after if");
    const cond = this.parseExpr();
    this.expect(")", "expected ')' after if condition");
    const then = this.parseBodyStatements();
    let else_: Stmt[] = [];
    if (this.match("else")) else_ = this.parseBodyStatements();
    return { kind: "If", line: t.line, col: t.col, cond, then, else_ };
  }

  private parseWhile(): While {
    const t = this.advance();
    this.expect("(", "expected '(' after while");
    const cond = this.parseExpr();
    this.expect(")", "expected ')' after while condition");
    const body = this.parseBodyStatements();
    return { kind: "While", line: t.line, col: t.col, cond, body };
  }

  private parseDoWhile(): DoWhile {
    const t = this.advance();
    const body = this.parseBodyStatements();
    this.expect("while", "expected 'while' after do body");
    this.expect("(", "expected '(' after while");
    const cond = this.parseExpr();
    this.expect(")", "expected ')' after do-while condition");
    this.expect(";", "expected ';' after do-while");
    return { kind: "DoWhile", line: t.line, col: t.col, body, cond };
  }

  private parseFor(): For {
    const t = this.advance();
    this.expect("(", "expected '(' after for");
    let init: Stmt | null = null;
    if (!this.check(";")) {
      if (["int", "void", "long", "float", "bool", "char", "string", "struct"].includes(this.cur.type)) {
        init = this.parseVarDecl();
      } else {
        init = this.parseSimpleStatement();
        this.expect(";", "expected ';' after for initializer");
      }
    } else {
      this.advance();
    }
    const cond = this.check(";") ? null : this.parseExpr();
    this.expect(";", "expected ';' after for condition");
    let update: Stmt | null = null;
    if (!this.check(")")) update = this.parseSimpleStatement();
    this.expect(")", "expected ')' after for clauses");
    const body = this.parseBodyStatements();
    return { kind: "For", line: t.line, col: t.col, init, cond, update, body };
  }

  private parseVarDecl(): VarDecl {
    const typeTok = this.cur;
    const type = this.parseType();
    if (type === "void") this.fail("a variable cannot have type 'void'", typeTok);
    if (this.check("*")) this.fail("pointers are not supported yet (Phase 5)");
    const name = this.expect("IDENT", "expected a variable name after the type");
    if (this.check("[")) this.fail("arrays are not supported yet (Phase 5)");
    const init = this.match("=") ? this.parseExpr() : null;
    this.expect(";", "expected ';' after variable declaration");
    return {
      kind: "VarDecl", line: typeTok.line, col: typeTok.col,
      name: name.text, type, init,
    };
  }

  private parseReturn(): Return {
    const t = this.advance(); // 'return'
    const value = this.check(";") ? null : this.parseExpr();
    this.expect(";", "expected ';' after return");
    return { kind: "Return", line: t.line, col: t.col, value };
  }

  /**
   * An assignment, x++ / x--, or an expression, WITHOUT the trailing ';'
   * (so a later 'for' header can reuse it).
   */
  private parseSimpleStatement(): Assign | ExprStmt {
    const e = this.parseConditional();
    const t = this.cur;
    const isAssign = t.type === "=" || COMPOUND_OPS.has(t.type);
    const isIncDec = t.type === "++" || t.type === "--";

    if (!isAssign && !isIncDec) {
      return { kind: "ExprStmt", line: e.line, col: e.col, expr: e };
    }
    if (e.kind !== "VarRef") this.fail("cannot assign to this expression", e);
    this.advance(); // the operator

    let value: Expr;
    if (isIncDec) {
      // x++  ->  x = x + 1        x--  ->  x = x - 1
      const one: IntLit = { kind: "IntLit", line: t.line, col: t.col, value: 1, type: PLACEHOLDER };
      value = this.binary(t, t.type === "++" ? "+" : "-", this.varRef(e), one);
    } else {
      const rhs = this.parseExpr();
      // x += e  ->  x = x + e
      value = t.type === "=" ? rhs : this.binary(t, COMPOUND_OPS.get(t.type)!, this.varRef(e), rhs);
    }
    return { kind: "Assign", line: e.line, col: e.col, name: e.name, value };
  }

  // ---------- expressions ----------

  /** A full expression. Assignment is a statement in MiniC, so it is rejected here. */
  private parseExpr(): Expr {
    const e = this.parseConditional();
    const t = this.cur;
    if (t.type === "=" || COMPOUND_OPS.has(t.type) || t.type === "++" || t.type === "--") {
      this.fail("assignment is a statement and cannot be used inside an expression", t);
    }
    return e;
  }

  /** Binary expressions, with a clear message for the not-yet-supported '?:'. */
  private parseConditional(): Expr {
    const e = this.parseBinary(1);
    if (this.check("?")) this.fail("the '?:' operator is not supported yet (Phase 7)");
    return e;
  }

  /** Precedence climbing. Only operators with precedence >= minPrec are consumed. */
  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const op = this.cur;
      const prec = BINARY_PREC.get(op.type);
      if (prec === undefined || prec < minPrec) return left;
      this.advance();
      const right = this.parseBinary(prec + 1); // +1 makes the operator left-associative
      left = this.binary(op, op.type, left, right);
    }
  }

  private parseUnary(): Expr {
    const t = this.cur;
    if (t.type === "-" || t.type === "!") {
      this.advance();
      // -2147483648 is one literal; 2147483648 alone does not fit in an int.
      if (t.type === "-" && this.check("INT") && this.cur.text === String(INT_MAX + 1)) {
        this.advance();
        return { kind: "IntLit", line: t.line, col: t.col, value: -(INT_MAX + 1), type: PLACEHOLDER };
      }
      const operand = this.parseUnary();
      const u: Unary = { kind: "Unary", line: t.line, col: t.col, op: t.type, operand, type: PLACEHOLDER };
      return u;
    }
    if (t.type === "~") {
      return this.fail("'~' is not supported yet (Unary op in the AST contract needs agreement with Person B)");
    }
    if (t.type === "(" && this.isTypeKeyword(this.peekType(1))) {
      return this.fail("casts are not supported yet (Phase 4)");
    }
    return this.parsePostfix();
  }

  private isTypeKeyword(t: TokenType): boolean {
    return t === "int" || t === "long" || t === "float" || t === "bool"
      || t === "char" || t === "string" || t === "void";
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.check("(")) {
        if (e.kind !== "VarRef") this.fail("only a function name can be called", e);
        this.advance();
        const args: Expr[] = [];
        if (!this.check(")")) {
          do { args.push(this.parseExpr()); } while (this.match(","));
        }
        this.expect(")", "expected ')' after the arguments");
        const call: Call = { kind: "Call", line: e.line, col: e.col, name: e.name, args, type: PLACEHOLDER };
        e = call;
      } else if (this.check("[") || this.check(".") || this.check("->")) {
        return this.unsupported(this.cur, 5);
      } else {
        return e;
      }
    }
  }

  private parsePrimary(): Expr {
    const t = this.cur;
    switch (t.type) {
      case "INT": {
        this.advance();
        if (Number(t.text) > INT_MAX) {
          this.fail(`integer literal '${t.text}' is too large for int`, t);
        }
        return { kind: "IntLit", line: t.line, col: t.col, value: Number(t.text), type: PLACEHOLDER };
      }
      case "IDENT":
        this.advance();
        return { kind: "VarRef", line: t.line, col: t.col, name: t.text, type: PLACEHOLDER };
      case "(": {
        this.advance();
        const e = this.parseExpr();
        this.expect(")", "expected ')' after expression");
        return e;
      }
      case "LONG": case "FLOAT": case "CHAR": case "true": case "false":
        return this.unsupported(t, 4);
      case "STRING": case "null": case "new":
        return this.unsupported(t, 5);
      default:
        return this.fail(`expected an expression, found ${describe(t)}`);
    }
  }

  // ---------- node builders ----------

  private varRef(e: VarRef): VarRef {
    return { kind: "VarRef", line: e.line, col: e.col, name: e.name, type: PLACEHOLDER };
  }

  /** Binary or Logical, positioned at the operator token. && and || short-circuit, so they are Logical. */
  private binary(opTok: At, op: string, left: Expr, right: Expr): Binary | Logical {
    const pos = { line: opTok.line, col: opTok.col };
    if (op === "&&" || op === "||") {
      return { kind: "Logical", ...pos, op, left, right, type: PLACEHOLDER };
    }
    return { kind: "Binary", ...pos, op, left, right, type: PLACEHOLDER };
  }
}
