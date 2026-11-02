/**
 * Arrangement
 * -----------
 * An "arrangement" describes where every block is placed in one picture
 * (the initial picture, the goal picture, ...).  It is plain data, so the
 * dropdowns can edit it and the diagram can draw it without either one
 * knowing about the other.
 *
 *   {
 *     blocks:  ['A', 'B', 'C'],   // every block that is used
 *     onTable: ['A', 'C'],        // blocks on the table, left to right
 *     on:      { B: 'A' }         // on[B] = the block directly below B
 *   }
 *
 * A block is either on the table (listed in onTable) or on exactly one
 * other block (a key of `on`).  The functions below keep that invariant
 * and `validate` re-checks it, which protects the planner from bad input.
 *
 * This file does NOT import anything.  The STRIPS state (predicates) is
 * derived from an arrangement in predicates.js.
 */
const Arrangement = (function () {
  'use strict';

  const TABLE = 'TABLE'; // a pseudo-block name meaning "the table"

  /** Create a fresh arrangement with every block standing on the table. */
  function create(blocks) {
    return {
      blocks: blocks.slice(),
      onTable: blocks.slice(),
      on: {}
    };
  }

  /** Deep copy so that editing never mutates a saved arrangement. */
  function clone(arrangement) {
    return {
      blocks: arrangement.blocks.slice(),
      onTable: arrangement.onTable.slice(),
      on: Object.assign({}, arrangement.on)
    };
  }

  /** The block directly on top of `name`, or null when nothing is there. */
  function blockAbove(arrangement, name) {
    for (const block of Object.keys(arrangement.on)) {
      if (arrangement.on[block] === name) return block;
    }
    return null;
  }

  /** Clear(x): there is no block directly on top of x. */
  function isClear(arrangement, name) {
    return blockAbove(arrangement, name) === null;
  }

  /** The support of a block: another block name, TABLE, or null if invalid. */
  function supportOf(arrangement, name) {
    if (arrangement.on[name]) return arrangement.on[name];
    if (arrangement.onTable.indexOf(name) !== -1) return TABLE;
    return null;
  }

  /** All blocks of one stack, starting at the table. */
  function stackFrom(arrangement, base) {
    const stack = [];
    let current = base;
    let guard = 0;
    while (current && guard < arrangement.blocks.length + 1) {
      stack.push(current);
      current = blockAbove(arrangement, current);
      guard += 1;
    }
    return stack;
  }

  /** Remove a block from its current place (its own pieces stay behind). */
  function detach(arrangement, name) {
    const next = clone(arrangement);
    delete next.on[name];
    next.onTable = next.onTable.filter((block) => block !== name);
    return next;
  }

  /** Place `name` on top of `target`.  Returns null when the move is illegal. */
  function placeOnBlock(arrangement, name, target) {
    if (name === target) return null;
    if (arrangement.blocks.indexOf(target) === -1) return null;
    const above = blockAbove(arrangement, target);
    if (above !== null && above !== name) return null; // target is occupied
    const next = detach(arrangement, name);
    next.on[name] = target;
    return next;
  }

  /**
   * Move one block with a single call: support is TABLE or a block name.
   * Everything is checked here, so the dropdowns can never build an
   * impossible picture.  Returns { ok, arrangement, error }.
   */
  function setSupport(arrangement, name, support) {
    if (arrangement.blocks.indexOf(name) === -1) {
      return { ok: false, arrangement, error: `Block ${name} does not exist.` };
    }
    if (support === name) {
      return { ok: false, arrangement, error: `${name} cannot rest on itself.` };
    }

    let next = detach(arrangement, name);
    if (support === TABLE) {
      next.onTable.push(name);
    } else {
      next.on[name] = support;
    }

    const check = validate(next);
    if (!check.valid) {
      return { ok: false, arrangement, error: describeError(check.errors[0], name, support) };
    }
    return { ok: true, arrangement: next, error: null };
  }

  /** Turn a validator message into a short sentence for the card. */
  function describeError(message, name, support) {
    if (/cycle/i.test(message)) return `${name} cannot go on ${support} — that would make a loop.`;
    if (/supports more than one/i.test(message)) {
      return `Block ${support} already has a block on it.`;
    }
    return message;
  }

  /** Add a new block standing on the table. */
  function addBlock(arrangement, name) {
    if (arrangement.blocks.indexOf(name) !== -1) return clone(arrangement);
    const next = clone(arrangement);
    next.blocks.push(name);
    next.blocks.sort();
    next.onTable.push(name);
    return next;
  }

  /**
   * Remove a block.  A block that was standing on it is moved to the table so
   * the picture stays valid (nothing is left floating in the air).
   */
  function removeBlock(arrangement, name) {
    const next = clone(arrangement);
    const onTop = blockAbove(arrangement, name);
    const columnIndex = next.onTable.indexOf(name);
    next.blocks = next.blocks.filter((block) => block !== name);
    next.onTable = next.onTable.filter((block) => block !== name);
    delete next.on[name];

    if (onTop) {
      delete next.on[onTop];
      const index = columnIndex === -1 ? next.onTable.length : columnIndex;
      next.onTable.splice(index, 0, onTop);
    }
    return next;
  }

  /**
   * Check every Blocks World rule for an arrangement.
   * Returns { valid, errors }.  `errors` holds short, user readable messages.
   */
  function validate(arrangement) {
    const errors = [];

    if (!arrangement || !Array.isArray(arrangement.blocks)) {
      return { valid: false, errors: ['Arrangement data is missing.'] };
    }
    if (arrangement.blocks.length === 0) {
      return { valid: false, errors: ['No blocks were selected.'] };
    }

    const seen = new Set();
    for (const block of arrangement.blocks) {
      if (seen.has(block)) errors.push(`Block ${block} is selected twice.`);
      seen.add(block);
    }

    if (!Array.isArray(arrangement.onTable)) {
      return { valid: false, errors: errors.concat(['Table positions are missing.']) };
    }

    const supportCount = {};
    for (const block of Object.keys(arrangement.on)) {
      const support = arrangement.on[block];
      if (arrangement.blocks.indexOf(block) === -1) {
        errors.push(`Block ${block} is not part of the selection.`);
      }
      if (arrangement.blocks.indexOf(support) === -1) {
        errors.push(`Block ${block} rests on unknown block ${support}.`);
      }
      if (block === support) errors.push(`Block ${block} cannot rest on itself.`);
      if (arrangement.onTable.indexOf(block) !== -1) {
        errors.push(`Block ${block} is on the table and on another block at the same time.`);
      }
      supportCount[support] = (supportCount[support] || 0) + 1;
    }

    for (const support of Object.keys(supportCount)) {
      if (supportCount[support] > 1) {
        errors.push(`Block ${support} supports more than one block.`);
      }
    }

    for (const block of arrangement.onTable) {
      if (arrangement.blocks.indexOf(block) === -1) {
        errors.push(`Block ${block} is on the table but was not selected.`);
      }
      if (arrangement.on[block]) {
        errors.push(`Block ${block} appears in two places.`);
      }
    }
    if (new Set(arrangement.onTable).size !== arrangement.onTable.length) {
      errors.push('A block is listed on the table more than once.');
    }

    // Every block must appear exactly once.
    for (const block of arrangement.blocks) {
      const isOnTable = arrangement.onTable.indexOf(block) !== -1;
      const isOnBlock = Boolean(arrangement.on[block]);
      if (!isOnTable && !isOnBlock) errors.push(`Block ${block} has no position.`);
    }

    // No cycles (A on B, B on A, ...).
    for (const block of arrangement.blocks) {
      const visited = new Set([block]);
      let current = arrangement.on[block];
      while (current) {
        if (visited.has(current)) {
          errors.push(`Blocks ${block} and ${current} form a cycle.`);
          break;
        }
        visited.add(current);
        current = arrangement.on[current];
      }
    }

    return { valid: errors.length === 0, errors };
  }

  return {
    TABLE,
    create,
    clone,
    blockAbove,
    isClear,
    supportOf,
    stackFrom,
    detach,
    placeOnBlock,
    setSupport,
    addBlock,
    removeBlock,
    validate
  };
}());
