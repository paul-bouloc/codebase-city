/*
 * Copyright (c) Acme. Licensed under the MIT License.
 */

/**
 * Shapes of the harbor.
 */

import { Ship } from './ship'

export class Harbor {}
export abstract class Dock {}
export interface Berth {
  size: number
}
export type Tide = 'high' | 'low'
export enum Wind {
  North,
  South,
}
export function sail(): void
export function sail(speed?: number): void {}
export const MAX_SHIPS = 12
export const dock = () => {}
export const { a, b } = Ship
const anchor = 1
function moor() {}
export { anchor, moor as tie }
export { Ship } from './ship'
export * from './crew'
export default class Port {}
declare function ambient(): void
export declare const VERSION: string
