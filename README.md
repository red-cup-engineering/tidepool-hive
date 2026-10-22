# @red-cup-engineering/tidepool-hive

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Tidepool's Hive site. Hive L1 has no general contract execution, so the site is realized as: cells carried in `custom_json` under the `tidepool` id (Appendix D of the master specification), a member's own HBD savings balance as the sleeve, HBD transfers with structured memos as yield routing and draw release, and a head witness that computes the Hive-side section digest for the EVM `SiteWitnessV1`. Projections of the `CellLedger` fold onto Hive-Engine (a Group-run `hivesmartcontracts` sidechain first) and Magi (WASM) follow in later phases.

Depends on `hive-engineering-services-section/services/hive-blockchain-client-service` for reads and operation encoding and on `key-management-services-section` for the signing path; this package never reads a key. Every write is a paper intent (`{paper: true, mandate: null}`) until the founder's mandate is armed, the same shape `pool-service`'s `front-pool-draw` uses.
