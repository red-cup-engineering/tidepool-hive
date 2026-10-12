/**
 * tidepool-hive - the evidence envelope (spec 2.9) for one Hive op, in the layout of tidepool-evm's RelayEnvelopeLib.
 * The destination fields (dstChainId, dstContract, nonce) belong to the relayer; `toRelayEnvelope` adds them.
 */
import { siteId } from "@red-cup-engineering/tidepool-evm/terms";
import { decodeCellOp } from "./cell-codec.mjs";
import { ENVELOPE_SCHEMA, HIVE_SITE, validate } from "./schema.mjs";

/** Hive ids are 160-bit (40 hex); the EVM carries them as bytes32 right-padded with zeros. */
export function padHiveId(id) {
  const h = String(id).toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(h) || (h.length !== 40 && h.length !== 64)) throw new Error(`not a Hive id: ${id}`);
  return "0x" + h.padEnd(64, "0");
}

/**
 * @param op a custom_json op (must decode)
 * @param block {blockNum, blockId, trxId, opIndex}: where the reader found it, from irreversible blocks only.
 */
export function envelopeFor(op, block) {
  const r = decodeCellOp(op);
  if (!r.ok) throw new Error(`op refused at ${r.refusal.field}: ${r.refusal.reason}`);
  const env = {
    hiveChainId: HIVE_SITE,
    srcSite: "0x" + siteId(HIVE_SITE),
    blockNum: String(block.blockNum),
    blockId: padHiveId(block.blockId),
    trxId: padHiveId(block.trxId),
    opIndex: block.opIndex,
    payloadNi: "0x" + r.telling.cellId,
  };
  const bad = validate(ENVELOPE_SCHEMA, env);
  if (bad) throw new Error(`envelope fails the schema at ${bad}`);
  return env;
}

/** The full RelayEnvelopeLib struct: the Hive-side evidence plus the relayer's destination and nonce. */
export const toRelayEnvelope = (env, { dstChainId, dstContract, poolId, nonce }) => ({
  dstChainId: String(dstChainId), dstContract: dstContract.toLowerCase(), poolId, srcSite: env.srcSite,
  blockNum: env.blockNum, blockId: env.blockId, trxId: env.trxId, opIndex: env.opIndex, payloadNi: env.payloadNi, nonce: String(nonce),
});
