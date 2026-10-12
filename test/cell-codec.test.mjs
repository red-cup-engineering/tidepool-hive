import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { P, idTerm, memberTerm, siteId, hiveTerm } from "@red-cup-engineering/tidepool-evm/terms";
import { envelopeDigest } from "@red-cup-engineering/tidepool-evm/relay-envelope";
import { decodeCellOp, encodeCellOp, readOps, rosterFilter, sectionDigest, MAX_PAYLOAD_BYTES } from "../src/cell-codec.mjs";
import { envelopeFor, toRelayEnvelope } from "../src/envelope.mjs";
import { emitSchemas } from "../src/schema.mjs";

const vec = (name) => JSON.parse(readFileSync(new URL(import.meta.resolve(`@red-cup-engineering/tidepool-evm/vectors/${name}`)), "utf8"));
const f = vec("hive-release-payload.json");
const relay = vec("relay-envelope.json");
const releaseCell = { subject: idTerm(f.drawId), predicate: P.RELEASED_TO, object: memberTerm(f.memberAddress) };
const repayCell = { subject: idTerm(f.drawId), predicate: P.DRAW_SETTLED_BY, object: memberTerm(f.memberAddress) };
const release = () => encodeCellOp({ poolId: f.poolId, cell: releaseCell, side: "for", witnessAccount: f.poolAccount, money: true });
const repay = () => encodeCellOp({ poolId: f.poolId, cell: repayCell, side: "for", witnessAccount: f.memberHiveAccount, money: true });
const roster = { poolAccount: f.poolAccount, links: [{ member: f.memberAddress, hiveAccount: f.memberHiveAccount, evmLinkCell: "aa".repeat(32), hiveLinkCell: "bb".repeat(32) }] };

test("encode matches the fixture ops byte for byte", () => {
  assert.deepEqual(release(), f.release.op);
  assert.deepEqual(repay(), f.repayment.op);
});

test("decode(encode(x)) == x, money and non-money", () => {
  const x = { poolId: f.poolId, cell: releaseCell, side: "for", witnessAccount: f.poolAccount, money: true };
  const r = decodeCellOp(encodeCellOp(x));
  assert.ok(r.ok);
  const { cellId, ...rest } = r.telling;
  assert.deepEqual(rest, x);
  assert.equal(cellId, f.release.cellId);
  const y = { poolId: f.poolId, cell: { subject: "member:0xabc", predicate: P.ASSENTED_TO, object: 7 }, side: "against", witnessAccount: "alice", money: false };
  const op = encodeCellOp(y);
  assert.deepEqual(op.required_posting_auths, ["alice"]);
  assert.deepEqual(op.required_auths, []);
  const { cellId: _c, ...rest2 } = decodeCellOp(op).telling;
  assert.deepEqual(rest2, y);
});

test("a stranger's op is excluded and listed under ignored", () => {
  const stranger = encodeCellOp({ poolId: f.poolId, cell: releaseCell, witnessAccount: "mallory" });
  const { kept, ignored } = rosterFilter([release(), stranger, repay()], roster);
  assert.deepEqual(kept, [release(), repay()]);
  assert.equal(ignored.length, 1);
  assert.equal(ignored[0].witness, "mallory");
  assert.equal(ignored[0].op, stranger);
  // a member with only half the link pair is not on the roster
  const half = { ...roster, links: [{ ...roster.links[0], hiveLinkCell: null }] };
  assert.equal(rosterFilter([repay()], half).ignored.length, 1);
  const read = readOps([release(), stranger, repay()], roster);
  assert.equal(read.cells.length, 2); assert.equal(read.ignored.length, 1); assert.equal(read.refused.length, 0);
});

test("posting authority on a money predicate is refused, naming the field", () => {
  const op = { ...release(), required_auths: [], required_posting_auths: [f.poolAccount] };
  const r = decodeCellOp(op);
  assert.equal(r.ok, false);
  assert.equal(r.refusal.field, "required_posting_auths");
  const both = { ...release(), required_posting_auths: [f.poolAccount] };
  assert.equal(decodeCellOp(both).refusal.field, "required_posting_auths");
  // and the other direction: active authority on a non-money predicate
  const np = encodeCellOp({ poolId: f.poolId, cell: { subject: "q", predicate: P.ASSENTED_TO, object: "x" }, witnessAccount: "alice" });
  assert.equal(decodeCellOp({ ...np, required_auths: ["alice"], required_posting_auths: [] }).refusal.field, "required_auths");
  assert.throws(() => encodeCellOp({ poolId: f.poolId, cell: releaseCell, witnessAccount: "x1y", money: false }));
});

test("signer different from w is refused", () => {
  const r = decodeCellOp({ ...release(), required_auths: ["mallory"] });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.field, "required_auths");
  assert.equal(decodeCellOp({ ...release(), required_auths: [f.poolAccount, "mallory"] }).ok, false);
});

test("oversize payload is refused on decode and on encode", () => {
  const op = release();
  const big = { ...op, json: JSON.stringify({ ...JSON.parse(op.json), pad: "x".repeat(MAX_PAYLOAD_BYTES) }) };
  const r = decodeCellOp(big);
  assert.equal(r.ok, false); assert.equal(r.refusal.field, "json");
  assert.throws(() => encodeCellOp({ poolId: f.poolId, cell: { subject: "q", predicate: P.ASSENTED_TO, object: "y".repeat(MAX_PAYLOAD_BYTES) }, witnessAccount: "alice" }), /8192/);
  assert.ok(Buffer.byteLength(op.json) <= MAX_PAYLOAD_BYTES);
});

test("non-canonical terms and mismatched cell ids are refused naming the field", () => {
  const p = JSON.parse(release().json);
  const put = (patch) => ({ ...release(), json: JSON.stringify({ ...p, ...patch }) });
  // non-shortest head for the predicate text (length 0x18 form for a short string)
  const long = Buffer.concat([Buffer.from([0x78, 0x15]), Buffer.from("tidepool:releasedTo")]); // wrong length too
  assert.equal(decodeCellOp(put({ t: [p.t[0], long.toString("base64"), p.t[2]] })).refusal.field, "t[1]");
  const nonShortest = Buffer.concat([Buffer.from([0x78, 0x13]), Buffer.from("tidepool:releasedTo")]); // 19 bytes with the 1-byte head: valid form needs 0x73
  assert.equal(decodeCellOp(put({ t: [p.t[0], nonShortest.toString("base64"), p.t[2]] })).refusal.field, "t[1]");
  assert.equal(decodeCellOp(put({ t: ["!!", p.t[1], p.t[2]] })).refusal.field, "t[0]");
  assert.equal(decodeCellOp(put({ t: [p.t[0], p.t[1], "gA=="] })).refusal.field, "t[2]"); // major type 4
  assert.equal(decodeCellOp(put({ c: "00".repeat(32) })).refusal.field, "c");
  assert.equal(decodeCellOp(put({ s: "maybe" })).refusal.field, "s");
  assert.equal(decodeCellOp(put({ v: 2 })).refusal.field, "v");
  assert.equal(decodeCellOp({ ...release(), id: "other" }).refusal.field, "id");
});

test("cell ids, witnesses and the two-cell digest equal hive-release-payload.json", () => {
  const ops = [release(), repay()];
  const cells = readOps(ops, roster).cells;
  assert.deepEqual(cells.map((c) => c.cellId), [f.release.cellId, f.repayment.cellId]);
  assert.equal(sectionDigest(cells.map((c) => c.cellId)), f.section.digest);
  assert.equal(sectionDigest([...cells].reverse().map((c) => ({ cell: c.cellId, value: 1 }))), f.section.digest);
  assert.throws(() => sectionDigest([f.release.cellId, f.release.cellId]), /repeated/);
  assert.equal(f.section.cells.length, 2);
});

test("envelopeFor equals the fixture envelopes and the relay digests", () => {
  const legs = [[release(), f.release.envelope, { blockNum: 94000001, blockId: "0x" + "c3".repeat(20), trxId: "a1".repeat(20), opIndex: 0 }, 1],
                [repay(), f.repayment.envelope, { blockNum: 94000912, blockId: "d4".repeat(20), trxId: "0x" + "b2".repeat(20), opIndex: 2 }, 2]];
  for (const [op, want, block, nonce] of legs) {
    const env = envelopeFor(op, block);
    assert.deepEqual(Object.keys(env).sort(), ["blockId", "blockNum", "hiveChainId", "opIndex", "payloadNi", "srcSite", "trxId"]);
    assert.equal(env.srcSite, "0x" + siteId(f.srcSite));
    const full = toRelayEnvelope(env, { dstChainId: want.dstChainId, dstContract: want.dstContract, poolId: f.poolId, nonce });
    assert.deepEqual(full, want);
  }
  const valid = relay.cases.find((c) => c.label === "valid release envelope");
  const full = toRelayEnvelope(envelopeFor(release(), legs[0][2]), { dstChainId: relay.chainId, dstContract: relay.dstContract, poolId: f.poolId, nonce: 1 });
  assert.equal(envelopeDigest(full), valid.digest);
  assert.throws(() => envelopeFor({ ...release(), required_auths: [] }, legs[0][2]), /refused/);
  assert.throws(() => envelopeFor(release(), { ...legs[0][2], blockId: "12" }), /Hive id/);
});

test("schemas are emitted from code", () => {
  const s = JSON.parse(emitSchemas());
  assert.equal(s.payload.properties.t.minItems, 3);
  assert.equal(s.envelope.required.includes("hiveChainId"), true);
  assert.ok(hiveTerm("alice"));
});
