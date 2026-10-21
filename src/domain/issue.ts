// A located invariant failure. The YAML adapters turn these into graph findings.

export interface Issue {
  path: (string | number)[];
  message: string;
}
