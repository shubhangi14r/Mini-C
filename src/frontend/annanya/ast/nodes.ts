// AST contract between Person A (parser / type checker / optimizer) and
// Person B (code generator). Source of truth: section 4 of the work plan.
//
// !! The PDF of the plan was cut off at the right margin for some lines, so
// !! the parts marked INFERRED below are reconstructed, not copied. Compare
// !! this file with B's copy before merging. After agreement, changes need
// !! a pull request that both approve.

export type Type = "int" | "void"; // will grow: Phase 4 adds long/float/bool/char/string
export interface Pos { line: number; col: number; } // 1-based

// ---------- Expressions ----------
// Every expression has a `type`. The parser fills in a placeholder; the type
// checker overwrites it. (INFERRED: field order and the `type` field on each.)
export interface IntLit  extends Pos { kind: "IntLit";  value: number; type: Type; }
export interface VarRef  extends Pos { kind: "VarRef";  name: string; type: Type; }
export interface Binary  extends Pos { kind: "Binary";  op: string; left: Expr; right: Expr; type: Type; }
export interface Unary   extends Pos { kind: "Unary";   op: "-" | "!"; operand: Expr; type: Type; }
export interface Logical extends Pos { kind: "Logical"; op: "&&" | "||"; left: Expr; right: Expr; type: Type; }
export interface Call    extends Pos { kind: "Call";    name: string; args: Expr[]; type: Type; }
export type Expr = IntLit | VarRef | Binary | Unary | Logical | Call;

// ---------- Statements ----------
// INFERRED: VarDecl carries its declared type in `type` (like Param), and
// `init` is null when there is no initializer.
export interface VarDecl  extends Pos { kind: "VarDecl";  name: string; type: Type; init: Expr | null; }
export interface Assign   extends Pos { kind: "Assign";   name: string; value: Expr; }
export interface If       extends Pos { kind: "If";       cond: Expr; then: Stmt[]; else_: Stmt[]; }
export interface While    extends Pos { kind: "While";    cond: Expr; body: Stmt[]; }
export interface DoWhile  extends Pos { kind: "DoWhile";  body: Stmt[]; cond: Expr; }
export interface For      extends Pos { kind: "For";      init: Stmt | null; cond: Expr | null; update: Stmt | null; body: Stmt[]; }
export interface Break    extends Pos { kind: "Break"; }
export interface Continue extends Pos { kind: "Continue"; }
export interface Return   extends Pos { kind: "Return";   value: Expr | null; }
export interface ExprStmt extends Pos { kind: "ExprStmt"; expr: Expr; }
export type Stmt =
  | VarDecl | Assign | If | While | DoWhile | For
  | Break | Continue | Return | ExprStmt;

// ---------- Top level ----------
export interface Param { name: string; type: Type; }
export interface Func extends Pos {
  kind: "Func"; name: string; params: Param[]; returnType: Type; body: Stmt[];
}
export interface Program { kind: "Program"; funcs: Func[]; }
