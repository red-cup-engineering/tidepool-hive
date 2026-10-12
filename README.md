# @red-cup-engineering/tidepool-hive

Tidepool's Hive site. Hive L1 has no general contract execution, so the site is realized as: cells carried in `custom_json` under the `tidepool` id (Appendix D of the master specification), a member's own HBD savings balance as the sleeve, HBD transfers with structured memos as yield routing and draw release, and a head witness that computes the Hive-side section digest for the EVM `SiteWitnessV1`. Projections of the `CellLedger` fold onto Hive-Engine (a Group-run `hivesmartcontracts` sidechain first) and Magi (WASM) follow in later phases.

Depends on `hive-engineering-services-section/services/hive-blockchain-client-service` for reads and operation encoding and on `key-management-services-section` for the signing path; this package never reads a key. Every write is a paper intent (`{paper: true, mandate: null}`) until the founder's mandate is armed, the same shape `pool-service`'s `front-pool-draw` uses.
