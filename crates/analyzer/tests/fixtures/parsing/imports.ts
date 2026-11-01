import type { Harbor } from './harbor'
import { type Berth, type Dock } from './berth'
import { type Tide, sail } from './tide'
import Ship, { Mast as Pole } from "./ship"
import * as wind from './wind'
import './polyfill'
import fs = require('node:fs')
export * from './anchor'
export * as knots from './knots'
export { Rope as Line } from './rope'
export type { Chart } from './chart'
const crew = require('./crew')

export function load(name: string) {
  const cargo = require('./cargo')
  return import('./holds/' + name)
}

export const lazyMap = () => import(`./map`)
const computed = require(name)
