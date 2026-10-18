/**
 * The package versions NavCom keeps from a frozen key [interchange spec §3, rev 7].
 *
 * Mecha Jono's old key `6301c4d0…` had its secret exposed on 2026-09-28. Every package NavCom has
 * read under it is dated after that, so no date separates a genuine one from one planted with the
 * stolen secret. Only an id on this list is kept from that key — and a version that closes one of
 * these missions, since closing sends nobody anywhere.
 *
 * **Written by `web/scripts/frozen-set.mjs`, which the owner runs; never edited by hand.** Until
 * Mecha Jono's own signed list of the `30079` ids it signed arrives, this is the newest version of
 * each mission NavCom read on the day it was taken, and every package on it shows at its
 * jurisdiction only and cannot be taken. Then it is cut down to that list, and the registry marks
 * it confirmed.
 *
 * The registry pins this list's digest beside the key [package.ts, `frozen.sha256`], and the build
 * refuses a list whose digest differs [registry-rules.ts, `frozenDigest`]. It is checked there, where
 * it can mean something: anybody able to change this list inside a built bundle could change the pin
 * beside it too, so a phone re-checking it would prove nothing.
 */
export interface FrozenSet {
  /** The frozen key, 64 hex. */
  key: string;
  /** When the list was taken, `YYYY-MM-DD`, and from what. */
  taken: string;
  source: string;
  /** One per mission: the version kept, and its `d`. */
  packages: readonly { id: string; d: string }[];
}

export const FROZEN_SETS: readonly FrozenSet[] = [
  {
    key: '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692',
    taken: '2026-10-18',
    source: 'the newest version of each mission NavCom read from The Record and its mirror on 2026-10-18, signatures checked; not yet confirmed by Mecha Jono',
    packages: [
      { id: '03bc823963ddc525c6b33b4159b90453f9e112f17a52ca2e5335d0540b1fb992', d: 'starcom_mission_package_field-smoke_relief-CA-2026-10-02' },
      { id: '25fc9f568b2a079d37202bff940f71df4171c93f1c6fdc0e442dfdf126862277', d: 'starcom_mission_package_field-recall_check-vehicles-2026-W40' },
      { id: '3615b08834c33a8d71b8c03471785bf411660cefd0f72e1e7697b3272b7116a9', d: 'starcom_mission_package_field-recall_check-2026-10-14' },
      { id: '41dba9e446ef3afa3018892bf8915dfff18546b4a28309deead2131395cf5083', d: 'starcom_mission_package_field-smoke_relief-CA-2026-10-16' },
      { id: '4ac960aaeb2c75e30548880147cc9ba48012ce4a443d92881754da90bcf08301', d: 'starcom_mission_package_field-scam_shield-2026-W40' },
      { id: '59f4335ec16a4a16e142f503f2b63522cc0e8188b059519137da034bf3767d6f', d: 'starcom_mission_package_field-recall_check-2026-10-12' },
      { id: '60d14e809541207abd142daea46c3f6ff75b6f0088f6890e1656aa628db23eb6', d: 'starcom_mission_package_field-weekend_harm_reduction-2026-10-02' },
      { id: '6532ec71bb47c879bafebc237b51b059cc5cfdda51718f36a3bd40c85dd198df', d: 'starcom_mission_package_field-refunds_owed-ag-068352e07f5f9576' },
      { id: '79455ff8e5d8279200ebdab596712266a4bc531909a3cd20ee2885c6b2c286d6', d: 'starcom_mission_package_field-heat_relief-CA-2026-10-15' },
      { id: '82aed418e18b66340b6c17255d96dea2bb9a21bd34e6b457493fce841364819a', d: 'starcom_mission_package_field-recall_check-2026-10-08' },
      { id: '8319d3d78fef558930aaa84aefeac0629acabcfefc5bdbf11d6e2e5f4b39b03e', d: 'starcom_mission_package_field-scam_shield-2026-W42' },
      { id: '906b959535c3df9f14a401519948c7253b5bd7ba6f2e21b877508c6a163061c1', d: 'starcom_mission_package_field-naloxone-NM' },
      { id: '9685dc776851c10ae8abb1308781790748a326b1679647bf40e88cb9859e35e8', d: 'starcom_mission_package_field-recall_check-home-2026-W40' },
      { id: 'ae54303b39bc0f3fbc8a52380712bb1008d87e63ae995e036f1c8055a9b11f74', d: 'starcom_mission_package_field-naloxone-NE' },
      { id: 'b7e40ab5ca6137b13a23a53acb11a57cf73b458593e985954deb1cd1eaa8b8ad', d: 'starcom_mission_package_field-heat_relief-CA-2026-10-02' },
      { id: 'c8986d9e9c7fc5fd1a3b74572aad1065c3b3334e10ec40ace33b8aedced2dee9', d: 'starcom_mission_package_field-scam_shield-2026-W41' },
      { id: 'd6a8787c951c06df168e4eb1b6364db779a471de7834e6aa99b73ee71ff73090', d: 'starcom_mission_package_field-refunds_owed-ag-50582362a3e7b0e3' },
      { id: 'de9f2710cdc9bc7113c6494247edfb5f4ea29274d9d9561140dffb5295ba3801', d: 'starcom_mission_package_field-recall_check-2026-10-01' },
      { id: 'f278bcbaeae11d580d668f845b8a4d4255b3c035db43d6a962fe184aeaeda50e', d: 'starcom_mission_package_field-weekend_harm_reduction-2026-10-09' },
      { id: 'f279fe807ae01583c49f1a67cc1ca789cabd9974eb2045dc9c9862591732396c', d: 'starcom_mission_package_field-naloxone-CO' },
      { id: 'fb259fbb9d4bc6ced9751add7f8282b347ca09076d8c977f31ae08f61e1bc919', d: 'starcom_mission_package_field-refunds_owed-ag-7b298eba5740b5de' }
    ]
  }
];
