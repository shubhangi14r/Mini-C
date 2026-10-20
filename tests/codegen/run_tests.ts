import { WatEmitter } from "../../src/codegen/wat_emitter";
import { watToWasm } from "../../src/codegen/wasm_tools";
import { runWasm } from "../../runtime/host";
import { Program } from "../../src/ast/nodes";
import {
  fn, prog, int, v, bin, printInt, decl, assign, ifs, whiles,
} from "../../src/ast/builders";
import { factorialProgram } from "../../src/ast/samples";

interface TestCase {
  name: string;
  program: Program;
  expected: string[];
}

const tests: TestCase[] = [
  {
    name: "arithmetic: 2 + 3 * 4",
    program: prog(
      fn("main", [], "void", [
        printInt(bin("+", int(2), bin("*", int(3), int(4)))),
      ])
    ),
    expected: ["14"],
  },
  {
    name: "variables: x = 10; x = x + 5",
    program: prog(
      fn("main", [], "void", [
        decl("x", int(10)),
        assign("x", bin("+", v("x"), int(5))),
        printInt(v("x")),
      ])
    ),
    expected: ["15"],
  },
  {
    name: "if/else: x = 3; if (x > 2) print 1 else print 0",
    program: prog(
      fn("main", [], "void", [
        decl("x", int(3)),
        ifs(
          bin(">", v("x"), int(2)),
          [printInt(int(1))],
          [printInt(int(0))]
        ),
      ])
    ),
    expected: ["1"],
  },
  {
    name: "while: sum of 1..10",
    program: prog(
      fn("main", [], "void", [
        decl("sum", int(0)),
        decl("i", int(1)),
        whiles(bin("<=", v("i"), int(10)), [
          assign("sum", bin("+", v("sum"), v("i"))),
          assign("i", bin("+", v("i"), int(1))),
        ]),
        printInt(v("sum")),
      ])
    ),
    expected: ["55"],
  },
  {
    name: "recursion: factorial(5)",
    program: factorialProgram,
    expected: ["120"],
  },
];

(async () => {
  let passed = 0;

  for (const t of tests) {
    try {
      const wat = new WatEmitter().generate(t.program); // AST -> WAT
      const bytes = await watToWasm(wat);                // WAT -> validated .wasm
      const out = await runWasm(bytes);                  // run it
      const ok = JSON.stringify(out) === JSON.stringify(t.expected);
      if (ok) {
        passed++;
        console.log(`PASS  ${t.name}`);
      } else {
        console.log(`FAIL  ${t.name}  (expected ${t.expected}, got ${out})`);
      }
    } catch (e) {
      console.log(`FAIL  ${t.name}  ${(e as Error).message}`);
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
})();