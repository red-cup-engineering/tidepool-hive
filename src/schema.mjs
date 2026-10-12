/**
 * tidepool-hive - JSON Schemas (draft 2020-12) for the Hive custom_json payload and the evidence envelope.
 *
 * Data doctrine (founder, 2026-10-08): the schema is code, not a hand-written record. The roadmap named
 * `schemas/tidepool-custom-json.schema.json`; that file is not created. These constants are the
 * schema, `validate` is their reader (called by `decodeCellOp` and `envelopeFor`), and `emitSchemas()` returns
 * the JSON text for any consumer that wants a file (cross-chain Phase 4.1/4.2 import this module instead).
 */

export const MAX_PAYLOAD_BYTES = 8192;
export const HIVE_SITE = "hive:beeab0de00000000000000000000000000000000";

const hex64 = { type: "string", pattern: "^[0-9a-f]{64}$" };
const b32 = { type: "string", pattern: "^0x[0-9a-f]{64}$" };

/** The `json` member of the custom_json op, parsed (Appendix D). */
export const PAYLOAD_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "tidepool-hive/custom-json-payload@1",
  type: "object",
  required: ["v", "p", "c", "s", "w", "t"],
  additionalProperties: false,
  properties: {
    v: { const: 1 },
    p: hex64,
    c: hex64,
    s: { enum: ["for", "against"] },
    w: { type: "string", pattern: "^[a-z0-9][a-z0-9.-]{1,14}[a-z0-9]$" },
    t: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", pattern: "^[A-Za-z0-9+/]+={0,2}$" } },
  },
};

/** The operation as the chain carries it. */
export const CUSTOM_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "tidepool-hive/custom-json@1",
  type: "object",
  required: ["id", "required_auths", "required_posting_auths", "json"],
  properties: {
    id: { const: "tidepool" },
    required_auths: { type: "array", items: { type: "string" } },
    required_posting_auths: { type: "array", items: { type: "string" } },
    json: { type: "string", maxBytes: MAX_PAYLOAD_BYTES },
  },
};

/** The evidence envelope sub-schema (spec 2.9; the fields `RelayEnvelopeLib` takes from the Hive side). */
export const ENVELOPE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "tidepool-hive/evidence-envelope@1",
  type: "object",
  required: ["hiveChainId", "srcSite", "blockNum", "blockId", "trxId", "opIndex", "payloadNi"],
  additionalProperties: false,
  properties: {
    hiveChainId: { type: "string", pattern: "^hive:[0-9a-f]{40}$" },
    srcSite: b32,
    blockNum: { type: "string", pattern: "^[0-9]{1,20}$" },
    blockId: b32,
    trxId: b32,
    opIndex: { type: "integer", minimum: 0, maximum: 4294967295 },
    payloadNi: b32,
  },
};

/** Minimal reader for the keywords the schemas above use. Returns null, or the name of the first failing field. */
export function validate(schema, value, path = "") {
  const at = (k) => (path === "" ? k : `${path}.${k}`);
  if (schema.const !== undefined && value !== schema.const) return path || "$";
  if (schema.enum && !schema.enum.includes(value)) return path || "$";
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return path || "$";
    for (const k of schema.required ?? []) if (!(k in value)) return at(k);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in value) { const bad = validate(sub, value[k], at(k)); if (bad) return bad; }
    }
    if (schema.additionalProperties === false) for (const k of Object.keys(value)) if (!(k in (schema.properties ?? {}))) return at(k);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return path || "$";
    if (schema.minItems !== undefined && value.length < schema.minItems) return path || "$";
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return path || "$";
    for (let i = 0; i < value.length; i++) { const bad = validate(schema.items, value[i], `${path}[${i}]`); if (bad) return bad; }
  } else if (schema.type === "string") {
    if (typeof value !== "string") return path || "$";
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return path || "$";
    if (schema.maxBytes !== undefined && Buffer.byteLength(value) > schema.maxBytes) return path || "$";
  } else if (schema.type === "integer") {
    if (!Number.isInteger(value)) return path || "$";
    if (schema.minimum !== undefined && value < schema.minimum) return path || "$";
    if (schema.maximum !== undefined && value > schema.maximum) return path || "$";
  }
  return null;
}

export const emitSchemas = () => JSON.stringify({ payload: PAYLOAD_SCHEMA, customJson: CUSTOM_JSON_SCHEMA, envelope: ENVELOPE_SCHEMA }, null, 2);
