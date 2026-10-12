/**
 * tidepool-hive - the custom_json cell codec (spec Appendix D, 2.5-2.6, 2.7).
 *
 * `encodeCellOp` builds the operation; `decodeCellOp` is the reader every Hive-side consumer uses and returns
 * either `{ok: true, telling}` or `{ok: false, refusal: {field, reason}}` naming the field; `rosterFilter` keeps
 * only the roster's witnesses; `sectionDigest` is `sectionDigestHex` over the surviving cells ascending.
 * Pure functions: no network, no key. Terms are the JS values `tidepool-evm/terms` takes (string, Uint8Array, number).
 */
import { PREDICATES, cellId, encodeTerm, hexToBytes, sectionDigestHex } from "@red-cup-engineering/tidepool-evm/terms";
import { CUSTOM_JSON_SCHEMA, MAX_PAYLOAD_BYTES, PAYLOAD_SCHEMA, validate } from "./schema.mjs";

export { MAX_PAYLOAD_BYTES };
export const OP_ID = "tidepool";

/** Predicates whose cells move or record money: active authority (Appendix D). */
export const MONEY_PREDICATES = Object.freeze(new Set(["tidepool:releasedTo", "tidepool:drawSettledBy", "tidepool:yieldRouted", "tidepool:cycleTotal"]));
const KNOWN = new Set(PREDICATES.map(([, name]) => name));

const refuse = (field, reason) => ({ ok: false, refusal: { field, reason } });
const bytesHex = (u) => Buffer.from(u).toString("hex");
const hexBytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));

// - canonical CBOR terms: text (3), bytes (2), uint (0), shortest-form heads only -
function decodeTerm(bytes) {
  const major = bytes[0] >> 5, info = bytes[0] & 31;
  let len, off;
  if (info < 24) { len = info; off = 1; }
  else if (info === 24) { len = bytes[1]; off = 2; }
  else if (info === 25) { len = (bytes[1] << 8) | bytes[2]; off = 3; }
  else if (info === 26) { len = bytes.readUInt32BE(1); off = 5; }
  else if (info === 27) { const n = bytes.readBigUInt64BE(1); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("integer out of range"); len = Number(n); off = 9; }
  else throw new Error("indefinite or reserved head");
  if (major === 0) { if (bytes.length !== off) throw new Error("trailing bytes"); return len; }
  if (major !== 2 && major !== 3) throw new Error(`unsupported CBOR major type ${major}`);
  if (bytes.length !== off + len) throw new Error("length mismatch");
  const body = bytes.subarray(off);
  return major === 2 ? Uint8Array.from(body) : new TextDecoder("utf-8", { fatal: true }).decode(body);
}
const b64 = (term) => Buffer.from(hexToBytes(encodeTerm(term))).toString("base64");

/** Decode one base64 CBOR item; throws with a reason unless the item is the canonical encoding of the term it decodes to. */
function termOf(s) {
  const raw = Buffer.from(s, "base64");
  if (raw.toString("base64") !== s) throw new Error("non-canonical base64");
  if (raw.length === 0) throw new Error("empty item");
  const term = decodeTerm(raw);
  if (encodeTerm(term) !== raw.toString("hex")) throw new Error("not the shortest CBOR form");
  return term;
}

/**
 * @param {{poolId: string, cell: {subject, predicate: string, object}, side?: "for"|"against", witnessAccount: string, money?: boolean}} x
 * `money` defaults to the predicate's class; a value that contradicts the class is refused.
 */
export function encodeCellOp({ poolId, cell, side = "for", witnessAccount, money }) {
  const { subject, predicate, object } = cell;
  if (!KNOWN.has(predicate)) throw new Error(`unknown predicate: ${predicate}`);
  const klass = MONEY_PREDICATES.has(predicate);
  if (money !== undefined && money !== klass) throw new Error(`predicate ${predicate} is ${klass ? "a money" : "a non-money"} predicate; money=${money}`);
  const pid = String(poolId).toLowerCase().replace(/^0x/, "");
  const payload = { v: 1, p: pid, c: cellId(subject, predicate, object), s: side, w: witnessAccount, t: [b64(subject), b64(predicate), b64(object)] };
  const bad = validate(PAYLOAD_SCHEMA, payload);
  if (bad) throw new Error(`payload fails the schema at ${bad}`);
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json) > MAX_PAYLOAD_BYTES) throw new Error(`payload over ${MAX_PAYLOAD_BYTES} bytes`);
  return { id: OP_ID, required_auths: klass ? [witnessAccount] : [], required_posting_auths: klass ? [] : [witnessAccount], json };
}

/** @returns {{ok: true, telling}|{ok: false, refusal: {field, reason}}}; telling is the `encodeCellOp` input plus `cellId`. */
export function decodeCellOp(op) {
  const top = validate(CUSTOM_JSON_SCHEMA, op ?? null);
  if (top) return refuse(top === "json" && typeof op?.json === "string" ? "json" : top, top === "json" && typeof op?.json === "string" ? `payload over ${MAX_PAYLOAD_BYTES} bytes` : "malformed operation");
  let payload;
  try { payload = JSON.parse(op.json); } catch { return refuse("json", "not valid JSON"); }
  const bad = validate(PAYLOAD_SCHEMA, payload);
  if (bad) return refuse(bad, "payload fails the schema");
  const w = payload.w;
  let subject, predicate, object;
  try { subject = termOf(payload.t[0]); } catch (e) { return refuse("t[0]", `non-canonical term: ${e.message}`); }
  try { predicate = termOf(payload.t[1]); } catch (e) { return refuse("t[1]", `non-canonical term: ${e.message}`); }
  try { object = termOf(payload.t[2]); } catch (e) { return refuse("t[2]", `non-canonical term: ${e.message}`); }
  if (typeof predicate !== "string" || !KNOWN.has(predicate)) return refuse("t[1]", "predicate is not in the Tidepool vocabulary");
  if (cellId(subject, predicate, object) !== payload.c) return refuse("c", "cell id is not the content address of t");
  const money = MONEY_PREDICATES.has(predicate);
  const [active, posting] = [op.required_auths, op.required_posting_auths];
  const [want, forbid, wantName, forbidName] = money ? [active, posting, "required_auths", "required_posting_auths"] : [posting, active, "required_posting_auths", "required_auths"];
  if (forbid.length !== 0) return refuse(forbidName, `${money ? "money" : "non-money"} predicate ${predicate} must leave ${forbidName} empty (wrong authority class)`);
  if (want.length !== 1 || want[0] !== w) return refuse(wantName, `signer must equal w (${w}); ${wantName} is [${want.join(",")}]`);
  return { ok: true, telling: { poolId: "0x" + payload.p, cell: { subject, predicate, object }, side: payload.s, witnessAccount: w, money, cellId: payload.c } };
}

/** The accounts whose ops may enter the Hive section: the pool account and members linked by both cells of the pair. */
export function rosterAccounts(roster) {
  const set = new Set([roster.poolAccount]);
  for (const l of roster.links ?? []) if (l.hiveAccount && l.evmLinkCell && l.hiveLinkCell) set.add(l.hiveAccount);
  return set;
}

/** @returns {{kept: object[], ignored: {op, witness: string|null, reason: string}[]}}; order preserved. */
export function rosterFilter(ops, roster) {
  const allowed = rosterAccounts(roster);
  const kept = [], ignored = [];
  for (const op of ops) {
    let w = null;
    try { w = JSON.parse(op.json).w ?? null; } catch { /* unreadable */ }
    if (typeof w === "string" && allowed.has(w)) kept.push(op);
    else ignored.push({ op, witness: w, reason: w === null ? "witness unreadable" : `witness ${w} is not in the pool's Hive roster` });
  }
  return { kept, ignored };
}

/** Decode, then roster-filter: `{cells, refused, ignored}` where cells are tellings in input order. */
export function readOps(ops, roster) {
  const { kept, ignored } = rosterFilter(ops, roster);
  const cells = [], refused = [];
  for (const op of kept) { const r = decodeCellOp(op); if (r.ok) cells.push(r.telling); else refused.push({ op, refusal: r.refusal }); }
  return { cells, refused, ignored };
}

/**
 * Digest of the surviving cells, ascending. Entries are `{cell, value}` (value a FOUR value as signstuff-evm's
 * section takes it) or bare 64-hex cell ids (told "for": value 1). A repeated id is refused: a section is a set.
 */
export function sectionDigest(cells) {
  const entries = cells.map((c) => (typeof c === "string" ? { cell: c, value: 1 } : { cell: c.cell ?? c.cellId, value: c.value ?? 1 }));
  const seen = new Set();
  for (const e of entries) { if (seen.has(e.cell)) throw new Error(`cell repeated in section: ${e.cell}`); seen.add(e.cell); }
  return sectionDigestHex(entries);
}
