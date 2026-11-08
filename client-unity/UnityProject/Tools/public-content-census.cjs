// A bounded census of finite public codes already decoded/applied by the browser proof.
// Excludes positions, actor/prop handles, bodies and tokens; Hello intent stays separate from delivered facts.
const EVENT_KIND_NAMES = Object.freeze({
  death: 'death', bounty: 'bounty', ended: 'ended', result: 'result',
  pickupRefused: 'pickupRefused', chestRefused: 'chestRefused', potionNotice: 'potionNotice',
  windEmblem: 'windEmblem', cannonNotice: 'cannonNotice', toast: 'toast',
});

class PublicContentCensus {
  constructor() { this.connections = []; this.nextSocketSequence = 0; this.nextWelcomeOrdinal = 0; }

  openConnection() {
    const connection = {
      socketSequence: ++this.nextSocketSequence,
      requestedHello: null,
      totals: { decodedMessages: 0 },
      segments: [],
      current: null,
    };
    this.connections.push(connection);
    return connection;
  }

  received(connection, message) {
    // The helper is called only after the probe decoder has accepted the frame.
    connection.totals.decodedMessages++;
  }

  hello(connection, message) {
    connection.requestedHello = { protocol: message.protocol, faction: message.faction, resumed: message.resume !== null };
  }

  welcome(connection, message) {
    // A new Welcome starts a new observation segment even on the same socket.
    connection.current = {
      welcomeOrdinal: ++this.nextWelcomeOrdinal,
      welcomePlayerId: Number.isSafeInteger(message.player) ? message.player : null,
      totals: { appliedSnapshots: 0, stateMessages: 0, eventRows: 0, fxRows: 0 },
      categories: Object.create(null),
    };
    connection.segments.push(connection.current);
  }

  segment(connection) {
    if (!connection.current) {
      connection.current = { welcomeOrdinal: null, welcomePlayerId: null,
        totals: { appliedSnapshots: 0, stateMessages: 0, eventRows: 0, fxRows: 0 }, categories: Object.create(null) };
      connection.segments.push(connection.current);
    }
    return connection.current;
  }

  add(connection, category, value) {
    // Only scalar finite protocol codes and small protocol-defined code tuples enter these sets.
    if (!(typeof value === 'string' || (Number.isSafeInteger(value) && value >= 0))) return;
    const record = this.segment(connection);
    let entry = record.categories[category];
    if (!entry) entry = record.categories[category] = { observations: 0, values: new Set() };
    entry.observations++;
    entry.values.add(value);
  }

  snapshot(connection, snapshot) {
    this.segment(connection).totals.appliedSnapshots++;
    this.add(connection, 'phases', snapshot.phase);
    const actor = (prefix, row) => {
      this.add(connection, `${prefix}Factions`, row.faction);
      this.add(connection, `${prefix}Weapons`, row.weapon);
      this.add(connection, `${prefix}StatusCodes`, row.status);
      this.add(connection, `${prefix}EffectMasks`, row.effects);
      this.add(connection, `${prefix}SignatureCodes`, row.sig);
    };
    if (snapshot.me) actor('me', snapshot.me);
    for (const row of snapshot.actors || []) {
      actor('actor', row);
      this.add(connection, 'actorKindCodes', row.kind);
      // Tracker's mobTypeCode is the protocol's one-based code; 0 is its omitted/default value.
      if (row.mobTypeCode > 0) this.add(connection, 'actorMobTypeCodesOneBased', row.mobTypeCode);
    }
  }

  state(connection, message) {
    this.segment(connection).totals.stateMessages++;
    for (const { key, value } of message.items || []) {
      if (key === 1 && value) {
        for (const weapon of value.slots || []) if (weapon !== null) this.add(connection, 'inventorySlotWeaponsZeroBased', weapon);
      } else if (key === 2 && value) {
        for (const prop of value.rows || []) {
          this.add(connection, 'propKindCodes', prop.kind);
          if (prop.kind === 1) this.add(connection, 'propWeaponCodesZeroBased', prop.weapon);
        }
      } else if (key === 3) {
        for (const field of value || []) { this.add(connection, 'fieldAbilityIdsZeroBased', field.ability); this.add(connection, 'fieldKindCodes', field.kind); }
      } else if (key === 4) {
        for (const chest of value || []) for (const option of chest.options || []) {
          // Each tuple consists only of bounded protocol enums, with no actor/chest identifiers.
          this.add(connection, 'rewardOptionKindId', `${option.kind}:${option.id}`);
        }
      } else if (key === 6) {
        for (const camp of value || []) { this.add(connection, 'campRosterMobTypesZeroBased', camp.mobType); if (camp.elite > 0) this.add(connection, 'campRosterEliteMobCodesOneBased', camp.elite); }
      } else if (key === 7) {
        for (const projectile of value || []) this.add(connection, 'projectileKindCodes', projectile.kind);
      }
    }
  }

  events(connection, message) {
    for (const event of message.events || []) {
      this.segment(connection).totals.eventRows++;
      this.add(connection, 'eventKinds', EVENT_KIND_NAMES[event.k] || event.k);
      if (event.k === 'potionNotice') this.add(connection, 'potionNoticeCodes', event.notice);
      else if (event.k === 'cannonNotice') this.add(connection, 'cannonNoticeCodes', event.code);
    }
  }

  fx(connection, message) {
    for (const fx of message.fx || []) {
      this.segment(connection).totals.fxRows++;
      this.add(connection, 'fxKinds', fx.k);
      if (fx.k === 'swing' || fx.k === 'block') this.add(connection, 'fxWeaponCodes', fx.weapon);
    }
  }

  toJSON() {
    return {
      basis: 'finite codes in decoded Welcome/Events/FX/State frames and applied snapshots only',
      coverage: 'Observed values only; absent categories mean no such fact was observed by this harness, not nonoccurrence or full coverage.',
      actorMobTypeCodesOneBased: 'Applied snapshot Tracker mobTypeCode values; protocol codes are one-based, and omitted/default zero is excluded.',
      campRosterMobTypesZeroBased: 'Decoded publicState key 6 camp roster mobType values; kept distinct from rendered actor mob type codes.',
      inventorySlotWeaponsZeroBased: 'Decoded publicState key 1 slot values after the probe decoder subtracts one from the wire code.',
      propWeaponCodesZeroBased: 'Decoded publicState key 2 ground weapon enum values, zero-based (the probe does not subtract one here).',
      fieldAbilityIdsZeroBased: 'Decoded publicState key 3 ability enum values, zero-based.',
      connections: this.connections.map(connection => ({
        label: `socket-${connection.socketSequence}`,
        socketSequence: connection.socketSequence,
        requestedHello: connection.requestedHello ? { ...connection.requestedHello } : null,
        totals: { ...connection.totals },
        segments: connection.segments.map(segment => ({
          welcomeOrdinal: segment.welcomeOrdinal, welcomePlayerId: segment.welcomePlayerId,
          totals: { ...segment.totals },
          categories: Object.fromEntries(Object.entries(segment.categories).map(([name, entry]) => [name, {
            observations: entry.observations,
            uniqueValues: [...entry.values].sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))),
          }]).sort(([a], [b]) => a.localeCompare(b))),
        })),
      })),
    };
  }
}

module.exports = { PublicContentCensus };
