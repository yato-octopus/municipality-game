import type { BBox } from '../types/game';
import { OKINAWA_INSET_BOX } from './mapDataLoader';

/**
 * Region jump bounding boxes covering each region's full prefecture `bboxMain`
 * union with ~6-8% cartographic breathing room.
 */
const JAPAN_JUMP_BOXES: Record<string, BBox> = {
  japan: [22, 34, 940, 920],
  hokkaido: [502, 26, 952, 300],
  tohoku: [504, 256, 656, 548],
  kantou: [478, 502, 600, 638],
  tyuubu: [350, 424, 564, 658],
  kansai: [304, 574, 438, 712],
  tyuugoku: [156, 544, 336, 698],
  sikoku: [210, 638, 348, 748],
  kyuusyuu: [54, 624, 236, 1028],
  okinawa: OKINAWA_INSET_BOX,
};

export function getJapanRegionBBox(regionId: string): BBox {
  return JAPAN_JUMP_BOXES[regionId] ?? [22, 34, 940, 920];
}
