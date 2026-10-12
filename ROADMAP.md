# tidepool-hive roadmap (revision 3)

Spec: master specification revision 3, §2.6, §2.9, §3 A3.3, A7 and Appendix D. Conventions: ESM, `node --test`, no key reads, every broadcast a paper intent (`{paper: true, mandate: null, …}`) until a mandate is armed. Reads through `hive-blockchain-client-service` against **at least two distinct API nodes** from the cross-chain registry's `hive` record, refusing on block-id disagreement at the same height; only blocks `≤ last_irreversible_block_num`; a failure is `unknown`, never a number. Content addressing through `signstuff-evm/scripts/lib/cell-address.mjs` and `tidepool-evm/scripts/lib/tidepool-terms.mjs` (A.0b), so a cell id is identical on Hive, EVM and JS. The Hive site id is the registry's CAIP-2 `hive:beeab0de00000000000000000000000000000000`. **Note rule:** every task's acceptance includes a note at `tidepool-engineering-services-section/content/text/documents/articles/notes/YYYY/MM/DD/YYYY-MM-DD-note-on-<task-id>-<slug>.md`; a task without its note is unfinished.

## Phase 1 (v0.1)

### TP-HIVE-001 `v0.1` Cell codec, authenticity rules, roster filter, section digest
- Goal: `src/cell-codec.mjs`: `encodeCellOp({poolId, cell, side, witnessAccount, money})` → a `custom_json` (`id: "tidepool"`, `json = {v, p, c, s, w, t}` per Appendix D; `required_auths = [w]` when `money`, else `required_posting_auths = [w]`); `decodeCellOp(op)` → the telling or a refusal naming the field (signer ≠ `w`; wrong authority class for the predicate; oversize; non-canonical term); `rosterFilter(ops, roster)` keeping only ops whose `w` is the pool account or a linked member account (the roster is `{poolAccount, links: [{member, hiveAccount, evmLinkCell, hiveLinkCell}]}` from the reconciler); `sectionDigest(cells)` = `sectionDigestHex` over the surviving cells ascending; the evidence envelope encoder `envelopeFor(op, block)` → `{hiveChainId, blockNum, blockId, trxId, opIndex, payloadNi}` matching `tidepool-evm`'s `RelayEnvelopeLib` layout.
- Files: `src/cell-codec.mjs`, `src/envelope.mjs`, `test/cell-codec.test.mjs`, `schemas/tidepool-custom-json.schema.json` (with the envelope sub-schema referenced by cross-chain Phase 4.1/4.2).
- Acceptance: `decode(encode(x)) == x`; a stranger's op (`w` not in roster) is excluded and listed under `ignored`; an op with `required_posting_auths` on a money predicate is refused; the cell ids and the two-cell digest equal the fixtures in `tidepool-evm/test/vectors/js/{tidepool-terms,hive-release-payload}.json`; payload ≤ 8192 bytes asserted.
- Depends: TP-ENG-001, TP-EVM-001 (fixtures), signstuff-evm P1 (frozen).
- Status: done 2026-10-08 (schema is code in `src/schema.mjs`, not a data/records file; see the note `2026-10-08-note-on-tp-hive-001-cell-codec-authenticity-roster-digest.md`).

### TP-HIVE-002 `v0.1` Release and repayment intents and their witnesses
- Goal: `src/release.mjs`: `releaseIntent(drawn)` from an EVM `Drawn` event with `releaseSite == hive` (the member's linked account from the roster; amount `amountUsdE6 / 1e3` HBD; memo `tidepool:<poolIdShort>:draw:<drawId>`; the `releasedTo` money cell op with the pool account as `w`); `repaymentIntent(drawId, member)` (memo `…:settle:<drawId>`; the `drawSettledBy` money cell op with the member account as `w`); `witnessTransfer(txid, expectation)` asserting `type == transfer`, `from`, `to`, `amount.nai == "@@000000013"` and exact amount, memo, `block ≤ LIB`, two-node agreement, and returning the envelope plus the EVM call arguments for `FloatDeskV1.witnessForeignRelease`/`witnessForeignSettle`.
- Files: `src/release.mjs`, `test/release.test.mjs` (recorded-block fixtures).
- Acceptance: negative tests for each asserted field (wrong `from`, wrong `to`, wrong asset, wrong amount, wrong memo, block above LIB, node disagreement); the envelope digest equals `tidepool-evm`'s fixture; no key path imported.
- Depends: TP-HIVE-001.

### TP-HIVE-003 `v0.1` Hive head witness
- Goal: `src/head.mjs`: `readHiveSection({poolId, roster, fromBlock, toBlock})` by `block_api.get_block_range` filtered to id `tidepool`, roster-filtered, folded by knowledge join (`joinKnowledgeWire`), returning `{cells, values, ignored, sectionDigest, height, blockId, hiveFloatE3 (the pool account's HBD balance at that block), lib}`; `headPayload(section)` → `SiteWitnessV1.tellHead` arguments (`Head` with `blockId`, `total = 0` for Hive in v0.1, `hiveFloatE3`) plus the envelope.
- Files: `src/head.mjs`, `test/head.test.mjs`.
- Acceptance: a fixture with a stranger's forged `against` on a release cell is ignored and the digest unchanged; `toBlock > lib` is refused; two-node disagreement is `unknown`; the digest equals TP-HIVE-001's over the same cells.
- Depends: TP-HIVE-001.

### TP-HIVE-004 `v0.1` Member linking cell and roster builder
- Goal: `src/link.mjs`: `linkOp(account, memberAddress)` (the Hive-side `⟨hive:<account>, linksMember, member:<0x…>⟩` money cell signed with the active key) and `buildRoster({evmLinks (from registry HiveLinked events), hiveOps})` producing the roster TP-HIVE-001 filters by (a link counts only when both halves exist).
- Acceptance: a one-sided link is not in the roster; the roster record validates against its schema.
- Depends: TP-HIVE-001.

## Phase 2 (v0.2)

- TP-HIVE-005 HBD savings sleeve reader and routing intent (the v0.1 cut): `readSleeve(account)` (savings balance, chain interest rate), `routeYieldIntent` with memo `tidepool:<poolIdShort>:<cycle>`; a Hive-side principal record is not declared; routable yield is the interest paid by the chain (readable from account history `interest` ops).
- TP-HIVE-006 Hive-Engine projection of the `CellLedger` fold with the Appendix D authenticity rules as a membrane, harnessed like `MARSH.hive-engine.js`.
- TP-HIVE-007 Hive repayment leg maturing lines once k-of-n relaying lands (TP-EVM-024).

## Phase 3 (v0.3)

- TP-HIVE-008 Magi (WASM) projection. TP-HIVE-009 DHF proposal body update (posting is TP-OPS-009).

## Capability-ledger citations

`tp-hive-hbd-rail` (dormant → TP-HIVE-002 as the paper release and repayment legs); `tp-mandate-execution` (keep-off-chain-as-witness: the restored `route-directed-yield-service/src/mandate-execution.mjs` is the signing path; moves under `lib/` in TP-ENG-005); `tp-route-directed-yield-intent` (fold-into `tidepool-sdk`). Cross-chain Phase 1.6 (Hive operation catalogue), 4.1 (Hive relayer) and 4.2 (attestation receiver) consume this package's codec and envelope schema.
