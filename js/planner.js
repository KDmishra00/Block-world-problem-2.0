/**
 * GoalStackPlanner
 * ----------------
 * Goal Stack Planning (the STRIPS planning procedure from the textbook).
 *
 * The planner keeps one stack that holds two kinds of entries:
 *
 *   { type: 'goal',   predicate }  a condition that still has to become true
 *   { type: 'action', action }     an operator that must be executed
 *
 * The loop always looks only at the TOP of the stack:
 *
 *   1. Goal that is already true      -> pop it (nothing to do).
 *   2. Goal that is false             -> find an operator that adds it, push
 *                                        that operator, then push its
 *                                        unsatisfied preconditions on top of
 *                                        it.  The preconditions are therefore
 *                                        solved before the operator runs.
 *   3. Operator on top of the stack   -> all of its preconditions have been
 *                                        solved, so execute it, update the
 *                                        state and add it to the plan.
 *
 * Because preconditions are pushed above their operator, sub-goals are
 * decomposed automatically and the resulting plan respects the order in
 * which blocks become clear.  If a later sub-goal destroys a precondition of
 * an operator that is still waiting on the stack, the operator finds a false
 * precondition when it is reached and is pushed back together with the
 * conditions that have to be repaired first.
 *
 * The planner only receives the initial state and the goal conditions; the
 * whole action sequence is derived, nothing is hard-coded.
 */
const GoalStackPlanner = (function () {
  'use strict';

  const MAX_STACK_OPERATIONS = 4000;   // terminates even on a stuck problem
  const MAX_PLAN_LENGTH = 80;          // a Blocks World plan is never this long
  const MAX_ATTEMPTS_PER_ACTION = 6;   // guards against repairing forever

  /**
   * Return the operator that can make `predicate` true, or null when no
   * operator applies.  Multi-step cases (for example "put A on the table"
   * while A is on B) are not special-cased: the returned operator's
   * preconditions are solved recursively by the stack.
   */
  function chooseAction(predicate, state) {
    const { name, args } = Predicates.parse(predicate);
    const x = args[0];

    if (name === 'OnTable') {
      // Only PUTDOWN adds OnTable(x); its precondition Holding(x) is solved next.
      return StripsActions.putDown(x);
    }

    if (name === 'On') {
      const y = args[1];
      if (x === y) return null;              // a block cannot be stacked on itself
      return StripsActions.stack(x, y);      // preconditions: Holding(x), Clear(y)
    }

    if (name === 'Clear') {
      if (state.has(Predicates.holding(x))) return StripsActions.putDown(x);
      const above = Predicates.blockAbove(state, x);
      if (above) return StripsActions.unstack(above, x);
      return null;                           // already clear: nothing can be done
    }

    if (name === 'Holding') {
      if (state.has(Predicates.onTable(x))) return StripsActions.pickUp(x);
      const below = Predicates.blockBelow(state, x);
      if (below) return StripsActions.unstack(x, below);
      return null;
    }

    if (name === 'HandEmpty') {
      const held = Predicates.holdingBlock(state);
      if (held) return StripsActions.putDown(held);
      return null;
    }

    return null;
  }

  /** Push a goal/operator entry and its unsatisfied preconditions. */
  function pushActionWithPreconditions(stack, action, state, trace, label) {
    stack.push({ type: 'action', action });
    const unsatisfied = action.preconditions.filter((predicate) => !state.has(predicate));
    // Pushed in reverse so that the first precondition ends up on top.
    for (let i = unsatisfied.length - 1; i >= 0; i -= 1) {
      stack.push({ type: 'goal', predicate: unsatisfied[i] });
    }
    if (trace) {
      const text = StripsActions.describe(action);
      trace.push(`${label}PUSH ACTION ${text}`);
      const satisfied = action.preconditions.filter((predicate) => state.has(predicate));
      for (const predicate of satisfied) {
        trace.push(`  precondition ${predicate} is already true`);
      }
      for (const predicate of unsatisfied) {
        trace.push(`  precondition ${predicate} pushed as a new sub-goal`);
      }
    }
  }

  /**
   * Read-only view of the stack for the UI: labels from top to bottom.
   * Goal entries show their predicate, operator entries show "STACK(A, B)".
   * Used only for display, the planner never reads it back.
   */
  function stackLabels(stack) {
    return stack
      .slice()
      .reverse()
      .map((item) => (item.type === 'goal' ? item.predicate : StripsActions.describe(item.action)));
  }

  /**
   * Run Goal Stack Planning.
   *
   * @param {Set<string>} initialState   STRIPS predicates of the start state
   * @param {string[]}    goalPredicates conditions that must become true
   * @returns {{success:boolean, plan:Array, finalState:Set<string>,
   *            alreadyAchieved:boolean, failure:string|null, trace:string[],
   *            operations:number, initialStack:string[], frames:Array}}
   *
 * `initialStack` and `frames` are viewer data for the UI, not part of the
 * algorithm.  `frames[i]` describes what happened while the i-th plan
 * action was executed: the stack right after it, the trace lines that led
 * to it, the predicates it added/deleted, and the whole predicate set it
 * left behind (so the UI can show the state at every step without
deriving it itself).
   */
  function plan(initialState, goalPredicates) {
    let state = new Set(initialState);
    const stack = [];
    const plan = [];
    const trace = [];
    const frames = [];          // per plan action, for the UI
    const attempts = new Map();
    let failure = null;
    let operations = 0;
    let status = 'ok';
    let noteStart = 0;          // first trace line not yet copied into a frame

    const goalsMet = () => Predicates.isGoalSatisfied(state, goalPredicates);

    // Push the goal conditions in reverse order, so the first goal is on top.
    for (let i = goalPredicates.length - 1; i >= 0; i -= 1) {
      stack.push({ type: 'goal', predicate: goalPredicates[i] });
    }
    if (trace) {
      trace.push('INITIAL STATE:');
      for (const predicate of Predicates.sortedList(state)) trace.push(`  ${predicate}`);
      trace.push(`GOAL STACK (top first): ${goalPredicates.join(' | ')}`);
    }
    noteStart = trace.length;   // notes start with the first stack operation

    const initialStack = stackLabels(stack);

    if (goalsMet()) {
      trace.push('All goal conditions are already true: the plan is empty.');
      return {
        success: true,
        plan,
        finalState: state,
        alreadyAchieved: true,
        failure: null,
        trace,
        operations,
        initialStack,
        frames
      };
    }

    while (stack.length > 0) {
      operations += 1;
      if (operations > MAX_STACK_OPERATIONS) {
        failure = 'The planner stopped: too many stack operations. The problem seems unsolvable.';
        status = 'limit';
        break;
      }

      const item = stack.pop();

      /* ---------- case 1 & 2: a goal condition ---------- */
      if (item.type === 'goal') {
        const predicate = item.predicate;

        if (state.has(predicate)) {
          trace.push(`POP GOAL ${predicate} — already satisfied`);
          continue;
        }

        const action = chooseAction(predicate, state);
        if (!action) {
          failure = `No action can achieve ${predicate} from the current state.`;
          status = 'dead-end';
          trace.push(`POP GOAL ${predicate} — no applicable action`);
          break;
        }

        trace.push(`POP GOAL ${predicate} — not satisfied, choose ${StripsActions.describe(action)}`);
        pushActionWithPreconditions(stack, action, state, trace, '  ');
        continue;
      }

      /* ---------- case 3: an operator ---------- */
      const action = item.action;
      const label = StripsActions.describe(action);

      if (!StripsActions.preconditionsSatisfied(state, action)) {
        // A sub-goal that was solved earlier was undone by a later action.
        const tries = (attempts.get(StripsActions.key(action)) || 0) + 1;
        attempts.set(StripsActions.key(action), tries);
        const missing = action.preconditions.filter((p) => !state.has(p));
        trace.push(`TOP ACTION ${label} — precondition ${missing.join(', ')} lost, repair (attempt ${tries})`);

        if (tries > MAX_ATTEMPTS_PER_ACTION) {
          failure = `The planner kept losing the preconditions of ${label}. No valid plan was found.`;
          status = 'stuck';
          break;
        }

        // Put the operator back first, then push the conditions to repair,
        // so they are solved before the operator is tried again.
        stack.push(item);
        for (let i = missing.length - 1; i >= 0; i -= 1) {
          stack.push({ type: 'goal', predicate: missing[i] });
        }
        continue;
      }

      state = StripsActions.applyEffects(state, action);
      plan.push(action);
      trace.push(`EXECUTE ${label} — state updated (${plan.length} action${plan.length === 1 ? '' : 's'} in plan)`);

      // Viewer data: the note lines that produced this action, and the stack
      // that is left once the action has run (its sub-goals are popped).
      frames.push({
        planIndex: plan.length - 1,
        action,
        stack: stackLabels(stack),
        note: trace.slice(noteStart),
        added: action.addEffects.slice(),
        deleted: action.deleteEffects.slice(),
        state: Predicates.sortedList(state)   // predicates right after this action
      });
      noteStart = trace.length;

      if (plan.length > MAX_PLAN_LENGTH) {
        failure = 'The planner stopped: the plan became longer than expected.';
        status = 'limit';
        break;
      }
    }

    if (!failure && !goalsMet()) {
      failure = 'The planner finished but the goal conditions are not all satisfied.';
      status = 'incomplete';
    }

    if (failure) {
      trace.push(`FAILED: ${failure}`);
    } else {
      trace.push(`DONE: ${plan.length} action(s), all goal conditions satisfied.`);
    }

    return {
      success: !failure,
      plan: failure ? [] : plan,
      finalState: state,
      alreadyAchieved: false,
      failure,
      trace,
      operations,
      status,
      initialStack,
      frames
    };
  }

  return { plan, chooseAction };
}());
