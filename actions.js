/**
 * StripsActions
 * -------------
 * The four standard Blocks World STRIPS operators.  Every operator is
 * written out with its preconditions, add effects and delete effects, so it
 * can be read like the textbook definition.
 *
 *   PICKUP(x)     OnTable(x), Clear(x), HandEmpty
 *                 add: Holding(x)               delete: OnTable(x), Clear(x), HandEmpty
 *
 *   PUTDOWN(x)    Holding(x)
 *                 add: OnTable(x), Clear(x), HandEmpty   delete: Holding(x)
 *
 *   STACK(x, y)   Holding(x), Clear(y)
 *                 add: On(x,y), Clear(x), HandEmpty      delete: Holding(x), Clear(y)
 *
 *   UNSTACK(x, y) On(x,y), Clear(x), HandEmpty
 *                 add: Holding(x), Clear(y)              delete: On(x,y), Clear(x), HandEmpty
 */
const StripsActions = (function () {
  'use strict';

  const { on, onTable, clear, holding, HAND_EMPTY } = Predicates;

  let nextId = 1;

  /** Build one concrete operator instance for specific blocks. */
  function createAction(name, args, preconditions, addEffects, deleteEffects) {
    return {
      id: nextId++,
      name,
      args: args.slice(),
      preconditions: preconditions.slice(),
      addEffects: addEffects.slice(),
      deleteEffects: deleteEffects.slice()
    };
  }

  function pickUp(x) {
    return createAction(
      'PICKUP',
      [x],
      [onTable(x), clear(x), HAND_EMPTY],
      [holding(x)],
      [onTable(x), clear(x), HAND_EMPTY]
    );
  }

  function putDown(x) {
    return createAction(
      'PUTDOWN',
      [x],
      [holding(x)],
      [onTable(x), clear(x), HAND_EMPTY],
      [holding(x)]
    );
  }

  function stack(x, y) {
    return createAction(
      'STACK',
      [x, y],
      [holding(x), clear(y)],
      [on(x, y), clear(x), HAND_EMPTY],
      [holding(x), clear(y)]
    );
  }

  function unstack(x, y) {
    return createAction(
      'UNSTACK',
      [x, y],
      [on(x, y), clear(x), HAND_EMPTY],
      [holding(x), clear(y)],
      [on(x, y), clear(x), HAND_EMPTY]
    );
  }

  /** "STACK(A, B)" — the label used in the plan list. */
  function describe(action) {
    return `${action.name}(${action.args.join(', ')})`;
  }

  /** A key that ignores the instance id, used to count retries. */
  function key(action) {
    return describe(action);
  }

  /** Every precondition must be present in the state. */
  function preconditionsSatisfied(state, action) {
    return action.preconditions.every((predicate) => state.has(predicate));
  }

  /** The STRIPS state update: state - delete effects + add effects. */
  function applyEffects(state, action) {
    const next = new Set(state);
    for (const predicate of action.deleteEffects) {
      next.delete(predicate);
    }
    for (const predicate of action.addEffects) {
      next.add(predicate);
    }
    return next;
  }

  /**
   * Execute an action on a state after checking its preconditions.
   * An action whose preconditions are not met is never applied.
   */
  function execute(state, action) {
    if (!preconditionsSatisfied(state, action)) {
      const missing = action.preconditions.filter((predicate) => !state.has(predicate));
      return {
        ok: false,
        state,
        error: `Cannot execute ${describe(action)}: ${missing.join(', ')} is not true.`
      };
    }
    return { ok: true, state: applyEffects(state, action), error: null };
  }

  /** Human readable summary of an action, used in the status panel. */
  function detail(action) {
    if (action.name === 'STACK' || action.name === 'UNSTACK') {
      return `Block ${action.args[0]} on block ${action.args[1]}`;
    }
    if (action.name === 'PICKUP') return `Pick up block ${action.args[0]} from the table`;
    return `Put block ${action.args[0]} down on the table`;
  }

  return {
    pickUp,
    putDown,
    stack,
    unstack,
    describe,
    key,
    detail,
    preconditionsSatisfied,
    applyEffects,
    execute
  };
}());
