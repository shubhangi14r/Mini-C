import fs from "fs";
import { watToWasm } from "../../src/codegen/wasm_tools";
import { runWasm } from "../../runtime/host";

(async () => {
  const wat = fs.readFileSync("tests/codegen/fact.wat", "utf8");
  console.log(await runWasm(await watToWasm(wat)));
})();