export type Type = "int" | "void";
export interface Pos { line: number; col: number; }

// ---------- Expressions ----------
export interface IntLit extends Pos { kind: "IntLit"; value: number; type: Type; }
export interface VarRef extends Pos { kind: "VarRef"; name: string; type: Type; }
export interface Binary extends Pos { kind: "Binary"; op: string; left: Expr; right: Expr; type: Type; }
export interface Call   extends Pos { kind: "Call"; name: string; args: Expr[]; type: Type; }
export type Expr = IntLit | VarRef | Binary | Call;

// ---------- Statements ----------
export interface VarDecl  extends Pos { kind: "VarDecl"; name: string; init: Expr; }
export interface Assign   extends Pos { kind: "Assign"; name: string; value: Expr; }
export interface If       extends Pos { kind: "If"; cond: Expr; then: Stmt[]; else_: Stmt[]; }
export interface While    extends Pos { kind: "While"; cond: Expr; body: Stmt[]; }
export interface Return   extends Pos { kind: "Return"; value: Expr | null; }
export interface ExprStmt extends Pos { kind: "ExprStmt"; expr: Expr; }
export type Stmt = VarDecl | Assign | If | While | Return | ExprStmt;

// ---------- Top level ----------
export interface Param { name: string; type: Type; }
export interface Func extends Pos {
  kind: "Func"; name: string; params: Param[]; returnType: Type; body: Stmt[];
}
export interface Program { kind: "Program"; funcs: Func[]; }