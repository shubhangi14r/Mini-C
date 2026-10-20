import { fn, prog, ifs, ret, bin, v, int, call, printInt } from "./builders";

export const factorialProgram = prog(
  fn("fact", ["n"], "int", [
    ifs(bin("<=", v("n"), int(1)), [ret(int(1))]),
    ret(bin("*", v("n"), call("fact", [bin("-", v("n"), int(1))]))),
  ]),
  fn("main", [], "void", [printInt(call("fact", [int(5)]))])
);