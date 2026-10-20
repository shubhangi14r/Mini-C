import { Expr, Stmt, Func, Program, Type, IntLit, VarRef, Binary, Call } from "./nodes";

const P = { line: 0, col: 0 };

export const int = (value: number): IntLit => ({ kind: "IntLit", value, type: "int", ...P });
export const v = (name: string): VarRef => ({ kind: "VarRef", name, type: "int", ...P });
export const bin = (op: string, left: Expr, right: Expr): Binary =>
  ({ kind: "Binary", op, left, right, type: "int", ...P });
export const call = (name: string, args: Expr[], type: Type = "int"): Call =>
  ({ kind: "Call", name, args, type, ...P });

export const printInt = (e: Expr): Stmt =>
  ({ kind: "ExprStmt", expr: call("print_int", [e], "void"), ...P });
export const decl = (name: string, init: Expr): Stmt => ({ kind: "VarDecl", name, init, ...P });
export const assign = (name: string, value: Expr): Stmt => ({ kind: "Assign", name, value, ...P });
export const ifs = (cond: Expr, then: Stmt[], else_: Stmt[] = []): Stmt =>
  ({ kind: "If", cond, then, else_, ...P });
export const whiles = (cond: Expr, body: Stmt[]): Stmt => ({ kind: "While", cond, body, ...P });
export const ret = (value: Expr | null = null): Stmt => ({ kind: "Return", value, ...P });

export const fn = (name: string, params: string[], returnType: Type, body: Stmt[]): Func => ({
  kind: "Func", name, params: params.map(p => ({ name: p, type: "int" as Type })),
  returnType, body, ...P,
});
export const prog = (...funcs: Func[]): Program => ({ kind: "Program", funcs });
