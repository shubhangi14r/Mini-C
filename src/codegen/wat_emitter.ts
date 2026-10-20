import { Program, Func, Stmt, Expr } from "../ast/nodes";

// Source operator -> WebAssembly instruction (int = i32)
const BIN_OPS: Record<string, string> = {
  "+": "i32.add", "-": "i32.sub", "*": "i32.mul",
  "/": "i32.div_s", "%": "i32.rem_s",
  "<": "i32.lt_s", "<=": "i32.le_s", ">": "i32.gt_s", ">=": "i32.ge_s",
  "==": "i32.eq", "!=": "i32.ne",
};

export class WatEmitter {
  private lines: string[] = [];
  private indent = 1;
  private labelId = 0; // unique labels so nested loops don't clash

  private emit(s: string) {
    this.lines.push("  ".repeat(this.indent) + s);
  }

  generate(p: Program): string {
    this.lines = [];
    this.indent = 1;
    this.labelId = 0;
    this.emit('(import "env" "print_int" (func $print_int (param i32)))');
    p.funcs.forEach(f => this.func(f));
    this.emit('(export "main" (func $main))');
    return ["(module", ...this.lines, ")"].join("\n");
  }

  // ---------- Functions ----------
  private func(f: Func) {
    const params = f.params.map(p => `(param $${p.name} i32)`).join(" ");
    const result = f.returnType === "int" ? " (result i32)" : "";
    this.emit(`(func $${f.name} ${params}${result}`);
    this.indent++;

    // Pre-pass: WASM needs every local declared at the top of the function
    const locals = new Set<string>();
    this.collectLocals(f.body, locals);
    locals.forEach(n => this.emit(`(local $${n} i32)`));

    f.body.forEach(s => this.stmt(s));

    // Needed so the validator accepts functions that end in an if/else.
    // Every path returns before this, so it is never reached.
    if (f.returnType === "int") this.emit("unreachable");

    this.indent--;
    this.emit(")");
  }

  private collectLocals(stmts: Stmt[], out: Set<string>) {
    for (const s of stmts) {
      if (s.kind === "VarDecl") out.add(s.name);
      else if (s.kind === "If") {
        this.collectLocals(s.then, out);
        this.collectLocals(s.else_, out);
      } else if (s.kind === "While") this.collectLocals(s.body, out);
    }
  }

  // ---------- Statements ----------
  private stmt(s: Stmt) {
    switch (s.kind) {
      case "VarDecl":
        this.expr(s.init);
        this.emit(`local.set $${s.name}`);
        break;

      case "Assign":
        this.expr(s.value);
        this.emit(`local.set $${s.name}`);
        break;

      case "ExprStmt":
        this.expr(s.expr);
        if (s.expr.type !== "void") this.emit("drop"); // discard an unused value
        break;

      case "Return":
        if (s.value) this.expr(s.value);
        this.emit("return");
        break;

      case "If":
        this.expr(s.cond);
        this.emit("if");
        this.indent++;
        s.then.forEach(x => this.stmt(x));
        this.indent--;
        if (s.else_.length) {
          this.emit("else");
          this.indent++;
          s.else_.forEach(x => this.stmt(x));
          this.indent--;
        }
        this.emit("end");
        break;

      case "While": {
        // WASM has no 'while'. Build it from block + loop + br_if.
        const id = this.labelId++;
        this.emit(`block $brk${id}`);
        this.indent++;
        this.emit(`loop $cont${id}`);
        this.indent++;
        this.expr(s.cond);
        this.emit("i32.eqz");            // condition false ->
        this.emit(`br_if $brk${id}`);    //   jump out of the block
        s.body.forEach(x => this.stmt(x));
        this.emit(`br $cont${id}`);      // back to the loop start
        this.indent--;
        this.emit("end");
        this.indent--;
        this.emit("end");
        break;
      }
    }
  }

  // ---------- Expressions (each leaves exactly ONE value on the stack) ----------
  private expr(e: Expr) {
    switch (e.kind) {
      case "IntLit":
        this.emit(`i32.const ${e.value}`);
        break;
      case "VarRef":
        this.emit(`local.get $${e.name}`);
        break;
      case "Binary":
        this.expr(e.left);
        this.expr(e.right);
        this.emit(BIN_OPS[e.op]);
        break;
      case "Call":
        e.args.forEach(a => this.expr(a));
        this.emit(`call $${e.name}`);
        break;
    }
  }
}