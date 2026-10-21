# Mini-C frontend/backend integration pack

This pack connects Annanya's lexer/parser/AST to Shubhangi's existing Mini-C WebAssembly backend **without replacing the backend's AST or code generator**.

## What this fixes

The two ASTs are not structurally identical:

- The frontend has `Unary`, `Logical`, `For`, `DoWhile`, `Break`, and `Continue` nodes; the backend currently does not.
- Frontend `VarDecl` has a declared `type` and nullable `init`; backend `VarDecl` has a required `init` and no `type` field.
- The backend emitter only handles integer expressions and `if`/`while` control flow.

`src/frontend/annanya/adapter.ts` converts frontend nodes into the exact types in the backend's `src/ast/nodes.ts`. It lowers unary `-x` and `!x` to backend-supported binary expressions and converts a declaration without an initializer to `int x = 0`. Syntax that cannot be compiled by the existing backend is rejected with a source-positioned error instead of reaching code generation and failing mysteriously.

## Install on Windows (PowerShell)

1. Download this ZIP and extract the `integration` folder from it into the **root** of the cloned `Mini-C` repository. The folder layout should be `Mini-C\integration\install.ps1`.
2. Open PowerShell in the repository root and run:

   ```powershell
   .\integration\install.ps1
   ```

3. Run the integration smoke test:

   ```powershell
   npx ts-node tests/frontend-adapter.smoke.ts
   ```

   Expected messages include `Frontend/backend integration smoke test passed. Output: 36, 15` and `Unsupported-syntax guard passed.`

4. Start the web app using the backend's dependencies and existing instructions. For this repository's server entry point:

   ```powershell
   npm install
   npx ts-node web/server.ts
   ```

   Open `http://localhost:3000` in your browser. Keep the terminal running while using the website. Stop it with `Ctrl+C`.

The installer only changes the server's parser import and adds the frontend adapter files. It does not replace `src/ast/nodes.ts`, `src/codegen`, `runtime`, or the existing web UI.

## Supported syntax after integration

Use the subset the backend currently compiles:

- `int` and `void` functions; `int` parameters and local variables
- integer literals, variable references, function calls
- `+ - * / % < <= > >= == !=`, unary `-`, and `!`
- assignments, `return`, expression statements, `if/else`, and `while`
- built-in `print_int(expression)`

The adapter deliberately rejects `for`, `do-while`, `break`, `continue`, `&&`, `||`, bitwise/shift operators, arrays, strings, structs, pointers, and non-`int` local types because the current backend cannot compile them yet. Use `while` instead of `for` and express simple conjunctions using nested `if` statements until logical short-circuit code generation is implemented.

## Example to try in the web UI

```c
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
}
```

Expected output:

```text
36
15
```

## If something fails

- If `npx ts-node` says `ts-node` is missing, run `npm install` from the backend repository root.
- If `wabt` is missing, run `npm install` and check that the backend's `package.json` includes `wabt`.
- If the installer says it cannot find `web/server.ts` or `src/ast/nodes.ts`, the `integration` folder is not at the repository root.
- Do not copy this pack's `src/ast/nodes.ts` over the backend file; the adapter is specifically designed to preserve the backend's canonical AST contract.
