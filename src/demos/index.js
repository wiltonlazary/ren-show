// Every demo, in the order ren-show lists them: rrx-core first, then ren-core.

import signals from './signals.jsx';
import scheduling from './scheduling.jsx';
import ownership from './ownership.jsx';
import context from './context.jsx';
import errors from './errors.jsx';
import tasks from './tasks.jsx';
import async from './async.jsx';
import stores from './stores.jsx';
import lists from './lists.jsx';
import introspection from './introspection.jsx';
import flow from './flow.jsx';
import primitives from './primitives.jsx';
import style from './style.jsx';
import events from './events.jsx';
import resilience from './resilience.jsx';
import roots from './roots.jsx';
import skia from './skia.jsx';
import three from './three.jsx';
import together from './together.jsx';
import workers from './workers.jsx';
import compiler from './compiler.jsx';
import server from './server.jsx';
import transitions from './transitions.jsx';
import table from './table.jsx';
import canvas from './canvas.jsx';
import render from './render.jsx';
import input from './input.jsx';

/**
 * @typedef {object} Demo
 * @property {string} id the section's id, also its URL hash
 * @property {'rrx-core' | 'ren-core'} group
 * @property {string} title
 * @property {string[]} apis the operations and components it shows
 * @property {string} summary
 * @property {() => any} View
 */

/** @type {Demo[]} */
export const demos = /** @type {Demo[]} */ ([
  signals, scheduling, ownership, context, errors, tasks, async, stores, lists, introspection,
  flow, transitions, primitives, style, events, input, resilience, roots, skia, three, together, workers, compiler, server, render, canvas, table,
]);
