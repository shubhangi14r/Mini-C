/**
 * Adapter between Annanya's full frontend AST and the backend AST contract.
 *
 * The backend contract lives in src/ast/nodes.ts and is intentionally not
 * overwritten. This adapter converts only nodes that the current backend can
 * actually compile. Unsupported syntax fails at the parse stage with a useful
 * source location instead of reaching the WAT emitter and crashing there.
 */
import type {
  Program as FrontendProgram,
  Func as FrontendFunc,
  Stmt as FrontendStmt,
  Expr as FrontendExpr,
  Type as FrontendType,
} from "./ast/nodes";
import { parse, ParseFailure } from "./parser/parser";
import { MiniCError } from "../mini_parser";
import type {
  Program as BackendProgram,
  Func as BackendFunc,
  Stmt as BackendStmt,
  Expr as BackendExpr,
  Type as BackendType,
} from "../../ast/nodes";

const BACKEND_BINARY_OPERATORS = new Set([
  "+", "-", "*", "/", "%", "<", "<=", ">", ">=", "==", "!=",
]);

function unsupported(message: string, node: { line: number; col: number }): never {
  throw new MiniCError("parse", message, node.line, node.col);
}

function assertBackendType(type: FrontendType, node: { line: number; col: number }, context: string): BackendType {
  if (type !== "int" && type !== "void") {
    return unsupported(`${context}: type '${type}' is not supported by the current backend`, node);
  }
  return type;
}

function convertExpr(expr: FrontendExpr): BackendExpr {
  switch (expr.kind) {
    case "IntLit":
      return { kind: "IntLit", value: expr.value, type: "int", line: expr.line, col: expr.col };
    case "VarRef":
      return { kind: "VarRef", name: expr.name, type: "int", line: expr.line, col: expr.col };
    case "Call":
      return {
        kind: "Call", name: expr.name, args: expr.args.map(convertExpr),
        type: "int", line: expr.line, col: expr.col,
      };
    case "Binary":
      if (!BACKEND_BINARY_OPERATORS.has(expr.op)) {
        return unsupported(`operator '${expr.op}' is not supported by the current WebAssembly backend`, expr);
      }
      return {
        kind: "Binary", op: expr.op, left: convertExpr(expr.left), right: convertExpr(expr.right),
        type: "int", line: expr.line, col: expr.col,
      };
    case "Unary": {
      // The backend has no Unary node. Lower unary operators into supported
      // binary nodes, preserving the same semantics for the int-only subset.
      const operand = convertExpr(expr.operand);
      const zero: BackendExpr = {
        kind: "IntLit", value: 0, type: "int", line: expr.line, col: expr.col,
      };
      if (expr.op === "-") {
        return { kind: "Binary", op: "-", left: zero, right: operand, type: "int", line: expr.line, col: expr.col };
      }
      if (expr.op === "!") {
        return { kind: "Binary", op: "==", left: operand, right: zero, type: "int", line: expr.line, col: expr.col };
      }
      return unsupported(`unary operator '${expr.op}' is not supported by the current backend`, expr);
    }
    case "Logical":
      return unsupported(`operator '${expr.op}' needs short-circuit code generation, which the current backend does not implement`, expr);
  }
}

function convertStmt(stmt: FrontendStmt): BackendStmt {
  switch (stmt.kind) {
    case "VarDecl": {
      if (assertBackendType(stmt.type, stmt, "Variable declaration") !== "int") {
        return unsupported("variables must have type 'int' in the current backend", stmt);
      }
      // Backend VarDecl requires an initializer. C-style uninitialized locals
      // are represented as zero so generated WASM is deterministic.
      const init = stmt.init ?? {
        kind: "IntLit" as const, value: 0, type: "int" as const,
        line: stmt.line, col: stmt.col,
      };
      return { kind: "VarDecl", name: stmt.name, init: convertExpr(init), line: stmt.line, col: stmt.col };
    }
    case "Assign":
      return { kind: "Assign", name: stmt.name, value: convertExpr(stmt.value), line: stmt.line, col: stmt.col };
    case "ExprStmt":
      return { kind: "ExprStmt", expr: convertExpr(stmt.expr), line: stmt.line, col: stmt.col };
    case "Return":
      return { kind: "Return", value: stmt.value ? convertExpr(stmt.value) : null, line: stmt.line, col: stmt.col };
    case "If":
      return {
        kind: "If", cond: convertExpr(stmt.cond), then: stmt.then.map(convertStmt),
        else_: stmt.else_.map(convertStmt), line: stmt.line, col: stmt.col,
      };
    case "While":
      return { kind: "While", cond: convertExpr(stmt.cond), body: stmt.body.map(convertStmt), line: stmt.line, col: stmt.col };
    case "For":
      return unsupported("'for' loops are parsed by the frontend but are not supported by the current backend; use 'while'", stmt);
    case "DoWhile":
      return unsupported("'do-while' loops are not supported by the current backend; use 'while'", stmt);
    case "Break":
      return unsupported("'break' is not supported by the current backend", stmt);
    case "Continue":
      return unsupported("'continue' is not supported by the current backend", stmt);
  }
}

function convertProgram(program: FrontendProgram): BackendProgram {
  const funcs: BackendFunc[] = program.funcs.map((func: FrontendFunc) => {
    const returnType = assertBackendType(func.returnType, func, "Function return");
    for (const param of func.params) {
      if (assertBackendType(param.type, func, `Parameter '${param.name}'`) !== "int") {
        unsupported("function parameters must have type 'int' in the current backend", func);
      }
    }
    return {
      kind: "Func", name: func.name,
      params: func.params.map(p => ({ name: p.name, type: "int" as const })),
      returnType, body: func.body.map(convertStmt), line: func.line, col: func.col,
    };
  });
  return { kind: "Program", funcs };
}

/** Parse with Annanya's lexer/parser and return exactly the backend's AST shape. */
export function parseProgram(source: string): BackendProgram {
  try {
    return convertProgram(parse(source));
  } catch (error) {
    if (error instanceof MiniCError) throw error;
    if (error instanceof ParseFailure) {
      const first = error.errors[0] ?? { message: error.message, line: 1, col: 1 };
      throw new MiniCError("parse", first.message, first.line, first.col);
    }
    throw error;
  }
}
