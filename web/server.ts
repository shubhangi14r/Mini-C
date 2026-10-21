// Local web server that connects the browser UI to the real compiler backend:
//   source -> (makeshift parser) -> AST -> WatEmitter -> WAT -> WABT validate -> .wasm -> run
// Run with:  npx ts-node web/server.ts      then open http://localhost:3000
import http from "http";
import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import { inspect } from "util";
import ts from "typescript";
import { parseProgram } from "../src/frontend/annanya/adapter";
import { checkProgram, MiniCError } from "../src/frontend/mini_parser";
import { WatEmitter } from "../src/codegen/wat_emitter";
import { watToWasm } from "../src/codegen/wasm_tools";
import { astToText } from "./ast_text";

const PORT = Number(process.env.PORT) || 3000;
const RUN_LIMIT_MS = 3000;     // stops infinite loops
const MAX_OUTPUT = 1000;       // lines of program output returned

interface Stage { name: string; status: "ok" | "fail" | "skipped"; ms: number; }

function friendlyRuntimeError(msg: string): string {
  if (/divide by zero/i.test(msg)) return "Runtime error: division by zero";
  if (/unreachable/i.test(msg)) return "Runtime error: a function ended without returning a value";
  if (/call stack|stack overflow/i.test(msg)) return "Runtime error: stack overflow (infinite recursion?)";
  if (/integer overflow/i.test(msg)) return "Runtime error: integer overflow";
  return "Runtime error: " + msg;
}

// Runs the compiled module on a worker thread so an infinite loop cannot freeze the server.
// The worker runs the project's real runtime/host.ts (transpiled on the fly).
function runInWorker(bytes: Uint8Array): Promise<{ output: string[]; error?: string }> {
  return new Promise(resolve => {
    const hostPath = path.resolve(__dirname, "../runtime/host.ts");
    const hostJs = ts.transpileModule(fs.readFileSync(hostPath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const code = `
      const { workerData, parentPort } = require("worker_threads");
      const mod = { exports: {} };
      new Function("module", "exports", "require", workerData.hostJs)(mod, mod.exports, require);
      mod.exports.runWasm(new Uint8Array(workerData.bytes)).then(
        out => parentPort.postMessage({ output: out }),
        err => parentPort.postMessage({ output: [], error: String((err && err.message) || err) })
      );`;
    const worker = new Worker(code, {
      eval: true,
      workerData: { bytes: Buffer.from(bytes), hostJs },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let done = false;
    const finish = (r: { output: string[]; error?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ output: [], error: `Time limit exceeded (${RUN_LIMIT_MS / 1000} s): the program may contain an infinite loop` }),
      RUN_LIMIT_MS
    );
    worker.on("message", m => finish(m));
    worker.on("error", (e: unknown) => {
      const msg = e && typeof (e as { message?: unknown }).message === "string"
        ? (e as { message: string }).message
        : inspect(e, { depth: 2 });
      finish({ output: [], error: friendlyRuntimeError(msg) });
    });
  });
}

function hexDump(bytes: Uint8Array, max = 96): string {
  const rows: string[] = [];
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i += 16) {
    const chunk = Array.from(bytes.slice(i, Math.min(i + 16, n)));
    const hex = chunk.map(b => b.toString(16).padStart(2, "0")).join(" ");
    const asc = chunk.map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    rows.push(i.toString(16).padStart(4, "0") + "  " + hex.padEnd(47, " ") + "  " + asc);
  }
  if (bytes.length > max) rows.push(`... (${bytes.length - max} more bytes)`);
  return rows.join("\n");
}

function countInstructions(wat: string): number {
  return wat.split("\n").filter(l => /^\s+[a-z][a-z0-9_.]*(\s|$)/.test(l) && !/^\s+(func|import|export|local|param|result)\b/.test(l)).length;
}

async function compileAndRun(source: string) {
  const stages: Stage[] = [];
  const result: Record<string, unknown> = { ok: false, stages };
  const timed = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
    const t0 = process.hrtime.bigint();
    try {
      const v = await fn();
      stages.push({ name, status: "ok", ms: Number(process.hrtime.bigint() - t0) / 1e6 });
      return v;
    } catch (e) {
      stages.push({ name, status: "fail", ms: Number(process.hrtime.bigint() - t0) / 1e6 });
      throw e;
    }
  };
  const ALL = ["Parse", "Check", "Emit WAT", "Validate + encode", "Run"];
  const fillSkipped = () => ALL.forEach(n => { if (!stages.find(s => s.name === n)) stages.push({ name: n, status: "skipped", ms: 0 }); });

  try {
    const ast = await timed("Parse", () => parseProgram(source));
    result.ast = astToText(ast);
    await timed("Check", () => checkProgram(ast));
    result.ast = astToText(ast);
    const wat = await timed("Emit WAT", () => new WatEmitter().generate(ast));
    result.wat = wat;
    result.instructions = countInstructions(wat);
    const bytes = await timed("Validate + encode", () => watToWasm(wat));
    result.wasm = { bytes: bytes.length, hex: hexDump(bytes) };
    const t0 = process.hrtime.bigint();
    const run = await runInWorker(bytes);
    stages.push({ name: "Run", status: run.error ? "fail" : "ok", ms: Number(process.hrtime.bigint() - t0) / 1e6 });
    const out = run.output.slice(0, MAX_OUTPUT);
    result.output = out;
    if (run.output.length > MAX_OUTPUT) result.outputTruncated = true;
    if (run.error) result.runtimeError = run.error.startsWith("Runtime error") || run.error.startsWith("Time limit") ? run.error : friendlyRuntimeError(run.error);
    result.ok = !run.error;
  } catch (e) {
    if (e instanceof MiniCError) {
      result.error = { stage: e.stage, message: e.message, line: e.line, col: e.col };
    } else {
      // e.g. WABT rejected the generated module: a bug in the code generator, shown honestly
      result.error = { stage: "backend", message: String((e as Error).message || e), line: 0, col: 0 };
    }
  }
  fillSkipped();
  const order = new Map(ALL.map((n, i) => [n, i]));
  stages.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  return result;
}

const INDEX = path.resolve(__dirname, "index.html");

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(INDEX));
      return;
    }
    if (req.method === "POST" && req.url === "/api/compile") {
      let body = "";
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 200_000) { res.writeHead(413); res.end("too large"); return; }
        body += chunk;
      }
      const { source } = JSON.parse(body || "{}");
      const result = await compileAndRun(String(source ?? ""));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: { stage: "server", message: String((e as Error).message), line: 0, col: 0 } }));
  }
});

server.listen(PORT, () => {
  console.log(`MiniC -> WebAssembly demo running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});

