/** End-to-end smoke test for the frontend -> backend AST adapter. */
import assert from "assert";
import { parseProgram } from "../src/frontend/annanya/adapter";
import { checkProgram } from "../src/frontend/mini_parser";
import { WatEmitter } from "../src/codegen/wat_emitter";
import { watToWasm } from "../src/codegen/wasm_tools";
import { runWasm } from "../runtime/host";

async function main() {
  const source = `
int square(int x) {
  return x * x;
}
void main() {
  int i = 1;
  int total;
  total = 0;
  while (i <= 5) {
    total += i;
    i++;
  }
  print_int(square(6));
  print_int(total);
}`;

  const ast = parseProgram(source);
  // These compile-time assignments also guard the backend AST contract.
  checkProgram(ast);
  const wat = new WatEmitter().generate(ast);
  const wasm = await watToWasm(wat);
  const output = await runWasm(wasm);
  assert.deepStrictEqual(output, ["36", "15"]);
  process.stdout.write("Frontend/backend integration smoke test passed. Output: 36, 15\n");

  let rejected = false;
  try {
    parseProgram("void main() { for (int i = 0; i < 3; i++) print_int(i); }");
  } catch (error) {
    rejected = /for.*not supported/i.test(String((error as Error).message));
  }
  assert.ok(rejected, "unsupported syntax should fail clearly before code generation");
  process.stdout.write("Unsupported-syntax guard passed.\n");
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
