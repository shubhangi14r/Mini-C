import wabt from "wabt";

export async function watToWasm(wat: string): Promise<Uint8Array> {
  const w = await wabt();
  const mod = w.parseWat("module.wat", wat);
  mod.resolveNames();
  mod.validate();
  const { buffer } = mod.toBinary({});
  mod.destroy();
  return buffer;
}