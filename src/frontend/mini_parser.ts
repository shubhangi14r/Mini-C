// ============================================================================
// MAKESHIFT FRONTEND (temporary stand-in for Person A's lexer + parser).
// Reads the small subset of MiniC that the 25% backend supports:
//   int / void functions, int variables, + - * / %, comparisons, ! and unary -,
//   if / else if / else, while, return, calls, print_int(...)
// and produces the SAME AST nodes the code generator already consumes.
// ============================================================================
import { Program, Func, Stmt, Expr, Param, Type, Call } from "../ast/nodes";

export class MiniCError extends Error {
  constructor(public stage: "lex" | "parse" | "check", message: string, public line: number, public col: number) {
    super(message);
  }
}

type TokKind = "num" | "id" | "kw" | "op" | "eof";
interface Tok { kind: TokKind; text: string; line: number; col: number; }

const KEYWORDS = new Set(["int", "void", "if", "else", "while", "return"]);
// Words from the full MiniC language that this early build does not compile yet.
const LATER = new Set(["for", "do", "break", "continue", "switch", "case", "default", "long", "float",
  "char", "bool", "string", "struct", "new", "free", "null", "true", "false"]);
const TWO_CHAR = ["<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "++", "--"];
const ONE_CHAR = "+-*/%<>=(){},;!";

// ---------------------------------------------------------------- lexer
function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0, line = 1, col = 1;
  const adv = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") { line++; col = 1; } else col++;
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { adv(); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") adv(); continue; }
    if (c === "/" && src[i + 1] === "*") {
      const sl = line, sc = col;
      adv(2);
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) adv();
      if (i >= src.length) throw new MiniCError("lex", "unterminated comment", sl, sc);
      adv(2);
      continue;
    }
    const l = line, cc = col;
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      const next = src[j] ?? "";
      if (next === ".") throw new MiniCError("lex", "decimal numbers are not supported yet (int only in this build)", l, cc);
      if (/[A-Za-z_]/.test(next)) throw new MiniCError("lex", `invalid number '${src.slice(i, j + 1)}'`, l, cc);
      toks.push({ kind: "num", text: src.slice(i, j), line: l, col: cc });
      adv(j - i);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const text = src.slice(i, j);
      toks.push({ kind: KEYWORDS.has(text) ? "kw" : "id", text, line: l, col: cc });
      adv(j - i);
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR.includes(two)) { toks.push({ kind: "op", text: two, line: l, col: cc }); adv(2); continue; }
    if (ONE_CHAR.includes(c)) { toks.push({ kind: "op", text: c, line: l, col: cc }); adv(); continue; }
    throw new MiniCError("lex", `unexpected character '${c}'`, l, cc);
  }
  toks.push({ kind: "eof", text: "", line, col });
  return toks;
}

// ---------------------------------------------------------------- parser
class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  private get cur(): Tok { return this.toks[this.pos]; }
  private peek(n = 1): Tok { return this.toks[Math.min(this.pos + n, this.toks.length - 1)]; }
  private next(): Tok { return this.toks[this.pos++]; }
  private is(text: string): boolean { return this.cur.kind !== "eof" && this.cur.text === text && this.cur.kind !== "num"; }
  private fail(msg: string, t: Tok = this.cur): never { throw new MiniCError("parse", msg, t.line, t.col); }
  private desc(t: Tok): string { return t.kind === "eof" ? "end of file" : `'${t.text}'`; }
  private expect(text: string, why = ""): Tok {
    if (!this.is(text)) this.fail(`expected '${text}'${why ? " " + why : ""} but found ${this.desc(this.cur)}`);
    return this.next();
  }
  private ident(what: string): Tok {
    if (this.cur.kind !== "id") this.fail(`expected ${what} but found ${this.desc(this.cur)}`);
    return this.next();
  }

  program(): Program {
    const funcs: Func[] = [];
    while (this.cur.kind !== "eof") funcs.push(this.func());
    return { kind: "Program", funcs };
  }

  private func(): Func {
    const t = this.cur;
    if (!(this.is("int") || this.is("void"))) {
      this.fail(`expected a function starting with 'int' or 'void' but found ${this.desc(t)}`);
    }
    this.next();
    const returnType: Type = t.text === "int" ? "int" : "void";
    const name = this.ident("a function name");
    this.expect("(");
    const params: Param[] = [];
    if (!this.is(")")) {
      do {
        this.expect("int", "(parameters must be 'int')");
        params.push({ name: this.ident("a parameter name").text, type: "int" });
      } while (this.is(",") && this.next());
    }
    this.expect(")");
    const body = this.block();
    return { kind: "Func", name: name.text, params, returnType, body, line: t.line, col: t.col };
  }

  private block(): Stmt[] {
    this.expect("{");
    const out: Stmt[] = [];
    while (!this.is("}")) {
      if (this.cur.kind === "eof") this.fail("missing '}' before end of file");
      out.push(this.stmt());
    }
    this.expect("}");
    return out;
  }

  private body(): Stmt[] {
    return this.is("{") ? this.block() : [this.stmt()];
  }

  private stmt(): Stmt {
    const t = this.cur;
    if (t.kind === "id" && LATER.has(t.text)) {
      this.fail(`'${t.text}' is not supported by this build yet (it is planned for a later phase)`);
    }
    if (this.is("{")) this.fail("nested blocks are not supported yet; use if/while bodies");

    if (this.is("int")) {
      this.next();
      const name = this.ident("a variable name");
      if (!this.is("=")) this.fail(`variables must be initialized, for example: int ${name.text} = 0;`);
      this.next();
      const init = this.expr();
      this.expect(";", "after the declaration");
      return { kind: "VarDecl", name: name.text, init, line: t.line, col: t.col };
    }
    if (this.is("if")) return this.ifStmt();
    if (this.is("while")) {
      this.next();
      this.expect("(");
      const cond = this.expr();
      this.expect(")");
      return { kind: "While", cond, body: this.body(), line: t.line, col: t.col };
    }
    if (this.is("return")) {
      this.next();
      let value: Expr | null = null;
      if (!this.is(";")) value = this.expr();
      this.expect(";", "after return");
      return { kind: "Return", value, line: t.line, col: t.col };
    }
    if (t.kind === "id") {
      const n = this.peek();
      if (n.kind === "op" && n.text === "(") {
        const e = this.expr();
        this.expect(";", "after the call");
        return { kind: "ExprStmt", expr: e, line: t.line, col: t.col };
      }
      if (n.kind === "op" && n.text === "=") {
        this.next(); this.next();
        const value = this.expr();
        this.expect(";", "after the assignment");
        return { kind: "Assign", name: t.text, value, line: t.line, col: t.col };
      }
      if (n.kind === "op" && ["+=", "-=", "*=", "/=", "%="].includes(n.text)) {
        this.next(); this.next();
        const rhs = this.expr();
        this.expect(";", "after the assignment");
        const value: Expr = { kind: "Binary", op: n.text[0], left: this.ref(t), right: rhs, type: "int", line: t.line, col: t.col };
        return { kind: "Assign", name: t.text, value, line: t.line, col: t.col };
      }
      if (n.kind === "op" && (n.text === "++" || n.text === "--")) {
        this.next(); this.next();
        this.expect(";", "after the statement");
        const one: Expr = { kind: "IntLit", value: 1, type: "int", line: n.line, col: n.col };
        const value: Expr = { kind: "Binary", op: n.text[0], left: this.ref(t), right: one, type: "int", line: t.line, col: t.col };
        return { kind: "Assign", name: t.text, value, line: t.line, col: t.col };
      }
    }
    return this.fail(`expected a statement but found ${this.desc(t)}`);
  }

  private ref(t: Tok): Expr {
    return { kind: "VarRef", name: t.text, type: "int", line: t.line, col: t.col };
  }

  private ifStmt(): Stmt {
    const t = this.next(); // 'if'
    this.expect("(");
    const cond = this.expr();
    this.expect(")");
    const then = this.body();
    let else_: Stmt[] = [];
    if (this.is("else")) {
      this.next();
      else_ = this.is("if") ? [this.ifStmt()] : this.body();
    }
    return { kind: "If", cond, then, else_, line: t.line, col: t.col };
  }

  // ---- expressions: precedence climbing ----
  private static PREC: Record<string, number> = {
    "==": 1, "!=": 1, "<": 2, "<=": 2, ">": 2, ">=": 2, "+": 3, "-": 3, "*": 4, "/": 4, "%": 4,
  };

  expr(minPrec = 1): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.cur;
      if (t.kind === "op" && (t.text === "&&" || t.text === "||")) {
        this.fail(`'${t.text}' is not supported by this build yet (short-circuit logic comes later)`);
      }
      const prec = t.kind === "op" ? Parser.PREC[t.text] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      this.next();
      const right = this.expr(prec + 1);
      left = { kind: "Binary", op: t.text, left, right, type: "int", line: t.line, col: t.col };
    }
  }

  private unary(): Expr {
    const t = this.cur;
    if (this.is("-")) {            // -x  becomes  0 - x
      this.next();
      const operand = this.unary();
      const zero: Expr = { kind: "IntLit", value: 0, type: "int", line: t.line, col: t.col };
      return { kind: "Binary", op: "-", left: zero, right: operand, type: "int", line: t.line, col: t.col };
    }
    if (this.is("!")) {            // !x  becomes  x == 0
      this.next();
      const operand = this.unary();
      const zero: Expr = { kind: "IntLit", value: 0, type: "int", line: t.line, col: t.col };
      return { kind: "Binary", op: "==", left: operand, right: zero, type: "int", line: t.line, col: t.col };
    }
    return this.primary();
  }

  private primary(): Expr {
    const t = this.cur;
    if (t.kind === "num") {
      this.next();
      const value = Number(t.text);
      if (value > 2147483647) this.fail("integer literal is too large for int", t);
      return { kind: "IntLit", value, type: "int", line: t.line, col: t.col };
    }
    if (t.kind === "id") {
      if (LATER.has(t.text)) this.fail(`'${t.text}' is not supported by this build yet (it is planned for a later phase)`);
      this.next();
      if (this.is("(")) {
        this.next();
        const args: Expr[] = [];
        if (!this.is(")")) {
          do { args.push(this.expr()); } while (this.is(",") && this.next());
        }
        this.expect(")", "to close the call");
        return { kind: "Call", name: t.text, args, type: "int", line: t.line, col: t.col };
      }
      return this.ref(t);
    }
    if (this.is("(")) {
      this.next();
      const e = this.expr();
      this.expect(")");
      return e;
    }
    return this.fail(`expected an expression but found ${this.desc(t)}`);
  }
}

export function parseProgram(source: string): Program {
  return new Parser(lex(source)).program();
}

// ---------------------------------------------------------------- semantic checks
// Resolves names, checks argument counts and return rules, and fills in Call types.
export function checkProgram(p: Program): Program {
  const err = (msg: string, n: { line: number; col: number }): never => {
    throw new MiniCError("check", msg, n.line, n.col);
  };
  const sigs = new Map<string, { params: number; ret: Type }>();
  sigs.set("print_int", { params: 1, ret: "void" });

  for (const f of p.funcs) {
    if (f.name === "print_int") err("'print_int' is a built-in and cannot be redefined", f);
    if (sigs.has(f.name)) err(`function '${f.name}' is already defined`, f);
    sigs.set(f.name, { params: f.params.length, ret: f.returnType });
  }
  const main = p.funcs.find(f => f.name === "main");
  if (!main) throw new MiniCError("check", "the program has no 'main' function (write: void main() { ... })", 1, 1);
  if (main.returnType !== "void" || main.params.length > 0) err("'main' must be declared as: void main()", main);

  const checkExpr = (e: Expr, scopes: Set<string>[], valueUsed: boolean): void => {
    switch (e.kind) {
      case "IntLit": return;
      case "VarRef":
        if (!scopes.some(s => s.has(e.name))) err(`'${e.name}' is not declared`, e);
        return;
      case "Binary":
        checkExpr(e.left, scopes, true);
        checkExpr(e.right, scopes, true);
        return;
      case "Call": {
        const sig = sigs.get(e.name);
        if (!sig) err(`function '${e.name}' is not defined`, e);
        const s = sig!;
        if (e.args.length !== s.params) {
          err(`'${e.name}' expects ${s.params} argument${s.params === 1 ? "" : "s"} but got ${e.args.length}`, e);
        }
        if (s.ret === "void" && valueUsed) err(`'${e.name}' returns nothing, so its result cannot be used as a value`, e);
        e.args.forEach(a => checkExpr(a, scopes, true));
        (e as Call).type = s.ret;
        return;
      }
    }
  };

  const alwaysReturns = (stmts: Stmt[]): boolean => {
    const last = stmts[stmts.length - 1];
    if (!last) return false;
    if (last.kind === "Return") return true;
    if (last.kind === "If") return last.else_.length > 0 && alwaysReturns(last.then) && alwaysReturns(last.else_);
    return false;
  };

  const checkStmts = (stmts: Stmt[], scopes: Set<string>[], f: Func): void => {
    const own = new Set<string>();
    const inner = [...scopes, own];
    for (const s of stmts) {
      switch (s.kind) {
        case "VarDecl":
          checkExpr(s.init, inner, true);
          if (own.has(s.name)) err(`'${s.name}' is already declared in this block`, s);
          if (scopes.some(sc => sc.has(s.name))) err(`'${s.name}' hides another variable; this build needs unique names per function`, s);
          own.add(s.name);
          break;
        case "Assign":
          if (!inner.some(sc => sc.has(s.name))) err(`'${s.name}' is not declared`, s);
          checkExpr(s.value, inner, true);
          break;
        case "ExprStmt": checkExpr(s.expr, inner, false); break;
        case "Return":
          if (f.returnType === "void" && s.value) err(`'${f.name}' is void, so it cannot return a value`, s);
          if (f.returnType === "int" && !s.value) err(`'${f.name}' must return an int value`, s);
          if (s.value) checkExpr(s.value, inner, true);
          break;
        case "If":
          checkExpr(s.cond, inner, true);
          checkStmts(s.then, inner, f);
          checkStmts(s.else_, inner, f);
          break;
        case "While":
          checkExpr(s.cond, inner, true);
          checkStmts(s.body, inner, f);
          break;
      }
    }
  };

  for (const f of p.funcs) {
    const seen = new Set<string>();
    for (const prm of f.params) {
      if (seen.has(prm.name)) err(`parameter '${prm.name}' is repeated in '${f.name}'`, f);
      seen.add(prm.name);
    }
    checkStmts(f.body, [seen], f);
    if (f.returnType === "int" && !alwaysReturns(f.body)) {
      err(`function '${f.name}' may reach its end without returning a value`, f);
    }
  }
  return p;
}

export function parseSource(source: string): Program {
  return checkProgram(parseProgram(source));
}
