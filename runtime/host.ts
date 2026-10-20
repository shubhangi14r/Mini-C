export async function runWasm(bytes: Uint8Array): Promise<string[]> {
  const output: string[] = [];
  const imports = {
    env: { print_int: (n: number) => output.push(String(n)) },
  };
  const module = new WebAssembly.Module(bytes as BufferSource);
  const instance = new WebAssembly.Instance(module, imports);
  (instance.exports.main as () => void)();
  return output;
}