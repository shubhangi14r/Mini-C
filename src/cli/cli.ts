import fs from "fs";
import { WatEmitter } from "../codegen/wat_emitter";
import { watToWasm } from "../codegen/wasm_tools";
import { runWasm } from "../../runtime/host";
import { factorialProgram } from "../ast/samples";

function usage() {
  console.log("Usage: cli.ts [--emit-wat] [-o <file.wasm>] [--run]");
}

(async () => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    usage();
    return;
  }

  // Until Person A's parser is integrated, we compile a built-in hand-built AST.
  const wat = new WatEmitter().generate(factorialProgram);

  if (args.includes("--emit-wat")) {
    console.log(wat);
  }

  const o = args.indexOf("-o");
  if (o !== -1) {
    const outFile = args[o + 1];
    if (!outFile) {
      console.error("error: -o needs a file name, for example -o out.wasm");
      process.exit(1);
    }
    const bytes = await watToWasm(wat); // validates before writing
    fs.writeFileSync(outFile, bytes);
    console.log(`wrote ${outFile} (${bytes.length} bytes, validated)`);
  }

  if (args.includes("--run")) {
    const output = await runWasm(await watToWasm(wat));
    console.log("output:", output.join(", "));
  }
})();