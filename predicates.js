/**
 * Predicates
 * ----------
 * The logical STRIPS state of the Blocks World.
 *
 * A state is a Set of predicate strings, exactly the way STRIPS describes a
 * world model:
 *
 *      On(A, B)      block A is directly on block B
 *      OnTable(C)    block C is directly on the table
 *      Clear(A)      nothing is on top of A
 *      Holding(B)    the robot hand holds block B
 *      HandEmpty     the robot hand holds nothing
 *
 * Effects are then nothing more than "remove these strings, add those
 * strings", which is the whole point of the STRIPS representation.
 *
 * The picture on the screen is built from this state (see stacksFromState),
 * so the drawing can never disagree with the logical state.
 */
const Predicates = (function () {
  'use strict';

  const HAND_EMPTY = 'HandEmpty';

  /* ---------- building predicates ---------- */

  function on(x, y) {
    return `On(${x},${y})`;
  }

  function onTable(x) {
    return `OnTable(${x})`;
  }

  function clear(x) {
    return `Clear(${x})`;
  }

  function holding(x) {
    return `Holding(${x})`;
  }

  /* ---------- reading predicates ---------- */

  /** Split "On(A,B)" into { name: 'On', args: ['A','B'] }. */
  function parse(predicate) {
    const open = predicate.indexOf('(');
    if (open === -1) return { name: predicate, args: [] };
    return {
      name: predicate.slice(0, open),
      args: predicate.slice(open + 1, predicate.length - 1).split(',')
    };
  }

  /** The block the hand is holding, or null. */
  function holdingBlock(state) {
    for (const predicate of state) {
      if (predicate.startsWith('Holding(')) return parse(predicate).args[0];
    }
    return null;
  }

  /** The block directly on top of `name` in a logical state, or null. */
  function blockAbove(state, name) {
    for (const predicate of state) {
      if (!predicate.startsWith('On(')) continue;
      const args = parse(predicate).args;
      if (args[1] === name) return args[0];
    }
    return null;
  }

  /** The block directly below `name` in a logical state, or null. */
  function blockBelow(state, name) {
    for (const predicate of state) {
      if (!predicate.startsWith('On(')) continue;
      const args = parse(predicate).args;
      if (args[0] === name) return args[1];
    }
    return null;
  }

  /* ---------- arrangement -> state ---------- */

  /**
   * Build the STRIPS state that belongs to an arrangement.
   * The blocks are walked in table order, so the saved state also remembers
   * the left-to-right column order used when drawing.
   */
  function stateFromArrangement(arrangement) {
    const state = new Set();

    for (const base of arrangement.onTable) {
      state.add(onTable(base));
    }

    // Add the On(...) predicates stack by stack, from the table upwards.
    for (const base of arrangement.onTable) {
      let current = base;
      let above = Arrangement.blockAbove(arrangement, current);
      while (above) {
        state.add(on(above, current));
        current = above;
        above = Arrangement.blockAbove(arrangement, current);
      }
    }

    // Clear(x) holds for every block that supports nothing.
    const supports = new Set(Object.values(arrangement.on));
    for (const block of arrangement.blocks) {
      if (!supports.has(block)) state.add(clear(block));
    }

    state.add(HAND_EMPTY);
    return state;
  }

  /**
   * The goal conditions of an arrangement, in a sensible order:
   * table positions first, then each tower from the bottom upwards.
   * This ordering alone avoids many unnecessary moves, and the planner
   * still re-plans if a later goal would destroy an earlier one.
   */
  function goalPredicatesFromArrangement(arrangement) {
    const goals = [];
    for (const base of arrangement.onTable) {
      goals.push(onTable(base));
      let current = base;
      let above = Arrangement.blockAbove(arrangement, current);
      while (above) {
        goals.push(on(above, current));
        current = above;
        above = Arrangement.blockAbove(arrangement, current);
      }
    }
    return goals;
  }

  /* ---------- state -> picture ---------- */

  /**
   * Turn a logical state into the structure the renderer needs:
   *   bases  : blocks standing on the table, left to right
   *   above  : above[x] = the block on top of x
   *   on     : on[x]    = the block below x
   *   holding: the block in the hand, or null
   */
  function stacksFromState(state) {
    const bases = [];
    const on = {};
    const above = {};
    let held = null;

    for (const predicate of state) {
      if (predicate.startsWith('OnTable(')) {
        bases.push(parse(predicate).args[0]);
      } else if (predicate.startsWith('On(')) {
        const args = parse(predicate).args;
        on[args[0]] = args[1];
        above[args[1]] = args[0];
      } else if (predicate.startsWith('Holding(')) {
        held = parse(predicate).args[0];
      }
    }

    return { bases, on, above, holding: held };
  }

  /** True when every goal condition is present in the state. */
  function isGoalSatisfied(state, goalPredicates) {
    return goalPredicates.every((predicate) => state.has(predicate));
  }

  /** Sorted predicate list, used for the "logical state" panel. */
  function sortedList(state) {
    return Array.from(state).sort((a, b) => a.localeCompare(b));
  }

  return {
    HAND_EMPTY,
    on,
    onTable,
    clear,
    holding,
    parse,
    holdingBlock,
    blockAbove,
    blockBelow,
    stateFromArrangement,
    goalPredicatesFromArrangement,
    stacksFromState,
    isGoalSatisfied,
    sortedList
  };
}());
