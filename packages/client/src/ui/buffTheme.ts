// Colours shared by the build strip and the world effects, so a buff looks the same everywhere. A buff takes its zone's colour
// (the five zones, FACTIONS[zone].color), which is the minimap's and the planning map's colour too. Colour is never the only
// code: the strip also draws the zone's marker shape (mapPainter ZONE_SHAPE) and names the zone in the tooltip.
import { BUFFS, FACTIONS, buffDef, isFactionId, type BuffId, type FactionId } from "@raid/shared";

/** The colour of a buff id that is not in this build's catalog (newer server content): a neutral grey. */
export const UNKNOWN_BUFF_COLOR = 0x9e9e9e;

/** A zone's colour (0xRRGGBB); grey for anything that is not a zone. */
export function zoneColorOf(zone: string): number {
  return isFactionId(zone) ? FACTIONS[zone].color : UNKNOWN_BUFF_COLOR;
}

/** Every buff's colour: its zone's. */
export const BUFF_COLOR: Readonly<Record<BuffId, number>> = Object.fromEntries(
  BUFFS.map((b) => [b.id, zoneColorOf(b.zone)]),
) as Record<BuffId, number>;

/** The colour of the buff `id`; grey for an id this build does not know. */
export function buffColor(id: string): number {
  return (BUFF_COLOR as Readonly<Record<string, number>>)[id] ?? UNKNOWN_BUFF_COLOR;
}

/** The zone of a buff id, or undefined for an id this build does not know. */
export function buffZone(id: string): FactionId | undefined {
  return buffDef(id)?.zone;
}

/** The barrier (a shield of hp on the body): a pale blue, apart from the zone colours and the teleport shield's 0x4fc3f7. */
export const BARRIER_COLOR = 0x81d4fa;

/** A mob a notch above the rest; an elite's buff chip carries it as its border. */
export const ELITE_COLOR = 0xffd54f;
