import type { BBox } from '../types/game';
import { OKINAWA_INSET_BOX } from './mapDataLoader';

const JAPAN_JUMP_BOXES: Record<string, BBox> = {
  hokkaido: [520, 38, 935, 290],
  tohoku: [500, 280, 625, 490],
  kantou: [490, 505, 600, 635],
  tyuubu: [390, 445, 530, 655],
  kansai: [305, 575, 425, 705],
  tyuugoku: [160, 585, 315, 678],
  sikoku: [210, 665, 330, 748],
  kyuusyuu: [65, 665, 220, 875],
  okinawa: OKINAWA_INSET_BOX,
};

export function getJapanRegionBBox(regionId: string): BBox {
  return JAPAN_JUMP_BOXES[regionId] ?? [22, 34, 940, 920];
}
