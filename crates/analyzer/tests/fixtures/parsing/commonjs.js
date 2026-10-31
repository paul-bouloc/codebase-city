#!/usr/bin/env node
/* eslint-disable no-console */
// Command line entry: starts the server.
// Run it with `node commonjs.js`.

'use strict'

function createApplication() {}
class Router {}
const settings = {}

exports = module.exports = createApplication
exports.Router = Router
exports.json = function json() {}
module.exports.VERSION = '1.0'
module.exports = {
  createApplication,
  helper: () => 1,
  settings,
  parse(text) {
    return text
  },
}
