import type { Point } from '../geometry';

export type { Point };

export interface CardBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Region {
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  highlight?: boolean;
}

export interface PlanLayout {
  cards: CardBox[];
  regions: Region[];
}

/** One card size for all object kinds. */
export const CARD = { width: 220, height: 96 } as const;
export const GAP = 12;
