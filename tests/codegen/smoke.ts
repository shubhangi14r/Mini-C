import { WatEmitter } from "../../src/codegen/wat_emitter";
import { watToWasm } from "../../src/codegen/wasm_tools";
import { runWasm } from "../../runtime/host";
import { factorialProgram } from "../../src/ast/samples";

(async () => {
  const wat = new WatEmitter().generate(factorialProgram);
  console.log(wat);
  console.log("\noutput:", await runWasm(await watToWasm(wat)));
})();