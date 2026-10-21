import { Expr, Program, Stmt } from "./nodes";

function assertNever(x: never): never {
  throw new Error(`unhandled node: ${JSON.stringify(x)}`);
}

/** Pretty-print the tree, indented two spaces per level. Powers --emit-ast. */
export function printProgram(program: Program): string {
  const lines: string[] = [];
  const out = (d: number, text: string): void => {
    lines.push("  ".repeat(d) + text);
  };

  const expr = (e: Expr, d: number): void => {
    switch (e.kind) {
      case "IntLit": return out(d, `IntLit ${e.value}`);
      case "VarRef": return out(d, `VarRef ${e.name}`);
      case "Binary":
      case "Logical":
        out(d, `${e.kind} ${e.op}`);
        expr(e.left, d + 1);
        expr(e.right, d + 1);
        return;
      case "Unary":
        out(d, `Unary ${e.op}`);
        return expr(e.operand, d + 1);
      case "Call":
        out(d, `Call ${e.name}`);
        for (const a of e.args) expr(a, d + 1);
        return;
      default: return assertNever(e);
    }
  };

  const group = (label: string, stmts: Stmt[], d: number) => {
    out(d, label);
    for (const s of stmts) stmt(s, d + 1);
  };

  const stmt = (s: Stmt, d: number): void => {
    switch (s.kind) {
      case "VarDecl":
        out(d, `VarDecl ${s.name}`);
        if (s.init) expr(s.init, d + 1);
        return;
      case "Assign":
        out(d, `Assign ${s.name}`);
        return expr(s.value, d + 1);
      case "If":
        out(d, "If");
        out(d + 1, "Cond"); expr(s.cond, d + 2);
        group("Then", s.then, d + 1);
        if (s.else_.length > 0) group("Else", s.else_, d + 1);
        return;
      case "While":
        out(d, "While");
        out(d + 1, "Cond"); expr(s.cond, d + 2);
        return group("Body", s.body, d + 1);
      case "DoWhile":
        out(d, "DoWhile");
        group("Body", s.body, d + 1);
        out(d + 1, "Cond"); expr(s.cond, d + 2);
        return;
      case "For":
        out(d, "For");
        if (s.init) { out(d + 1, "Init"); stmt(s.init, d + 2); }
        if (s.cond) { out(d + 1, "Cond"); expr(s.cond, d + 2); }
        if (s.update) { out(d + 1, "Update"); stmt(s.update, d + 2); }
        return group("Body", s.body, d + 1);
      case "Break": return out(d, "Break");
      case "Continue": return out(d, "Continue");
      case "Return":
        out(d, "Return");
        if (s.value) expr(s.value, d + 1);
        return;
      case "ExprStmt":
        out(d, "ExprStmt");
        return expr(s.expr, d + 1);
      default: return assertNever(s);
    }
  };

  for (const f of program.funcs) {
    const params = f.params.map((p) => `${p.name}: ${p.type}`).join(", ");
    out(0, `Func ${f.name}(${params}) -> ${f.returnType}`);
    for (const s of f.body) stmt(s, 1);
  }
  return lines.join("\n");
}
