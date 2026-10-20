// Prints any AST as an indented tree (works for every node kind).
export function astToText(root: unknown): string {
  const out: string[] = [];
  const scalars = (o: Record<string, unknown>): string =>
    Object.entries(o)
      .filter(([k, v]) => !["kind", "line", "col", "type"].includes(k) && (v === null || typeof v !== "object"))
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");

  const walk = (n: unknown, ind: string, label: string | null): void => {
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    const name = typeof o.kind === "string" ? o.kind : "Param";
    const sc = scalars(o);
    out.push(`${ind}${label ? label + ": " : ""}${name}${sc ? "  (" + sc + ")" : ""}`);
    for (const [k, v] of Object.entries(o)) {
      if (k === "type" || !v || typeof v !== "object") continue;
      if (Array.isArray(v)) {
        if (v.length === 0) continue;
        out.push(`${ind}  ${k}:`);
        v.forEach(x => walk(x, ind + "    ", null));
      } else {
        walk(v, ind + "  ", k);
      }
    }
  };
  walk(root, "", null);
  return out.join("\n");
}
