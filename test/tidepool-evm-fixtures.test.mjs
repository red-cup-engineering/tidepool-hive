import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cellId, encodeTerm, hiveTerm, hiveWitness, idTerm, memberTerm, poolCycleSite, scoped, memberLabel, sectionDigestHex, siteId, witnessId, P } from "@red-cup-engineering/tidepool-evm/terms";

// tidepool-hive consumes the same fixture files as Foundry and the SDK, through the tidepool-evm package exports.
const vec = (name) => JSON.parse(readFileSync(new URL(import.meta.resolve(`@red-cup-engineering/tidepool-evm/vectors/${name}`)), "utf8"));

test("hive account terms and witnesses equal tidepool-terms.json", () => {
  const rows = vec("tidepool-terms.json").hives;
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(encodeTerm(hiveTerm(r.account)), r.encoded);
    assert.equal(encodeTerm(hiveWitness(r.account)), r.witness);
    assert.equal(witnessId(hiveWitness(r.account)), r.witnessId);
  }
});

test("pool-cycle-site and scoped subjects equal tidepool-terms.json", () => {
  for (const r of vec("tidepool-terms.json").poolCycleSites) assert.equal(encodeTerm(poolCycleSite(r.poolId, r.cycle, r.caip2)), r.encoded);
  for (const r of vec("tidepool-terms.json").scoped.filter((x) => x.kind === "member")) assert.equal(encodeTerm(scoped(memberLabel(r.arg), r.n)), r.encoded);
});

test("the Hive release and repayment cell ids, witnesses and two-cell digest equal hive-release-payload.json", () => {
  const f = vec("hive-release-payload.json");
  const legs = [[f.release, P.RELEASED_TO, f.poolAccount], [f.repayment, P.DRAW_SETTLED_BY, f.memberHiveAccount]];
  for (const [leg, predicate, account] of legs) {
    assert.equal(cellId(idTerm(f.drawId), predicate, memberTerm(f.memberAddress)), leg.cellId);
    assert.equal(encodeTerm(hiveWitness(account)), leg.witnessCbor);
    assert.equal(leg.envelope.payloadNi, "0x" + leg.cellId);
    assert.equal(leg.envelope.srcSite, "0x" + siteId(f.srcSite));
    assert.ok(Buffer.byteLength(leg.op.json) <= 8192);
    assert.deepEqual(leg.op.required_auths, [account]);
    assert.deepEqual(leg.op.required_posting_auths, []);
  }
  assert.equal(sectionDigestHex(legs.map(([leg]) => ({ cell: leg.cellId, value: 1 }))), f.section.digest);
});
