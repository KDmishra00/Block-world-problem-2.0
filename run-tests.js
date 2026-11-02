/**
 * Logic tests for the Block World planner.
 *
 *   node tests/run-tests.js
 *
 * The browser files are plain scripts, so they are loaded here into one
 * shared JavaScript context exactly like the browser does it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const context = vm.createContext({ console });

for (const file of ['js/arrangement.js', 'js/predicates.js', 'js/actions.js', 'js/planner.js']) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(code, context, { filename: file });
}

const { Arrangement, Predicates, StripsActions, GoalStackPlanner } =
  vm.runInContext('({ Arrangement, Predicates, StripsActions, GoalStackPlanner })', context);

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

/** fromStacks([['C','B','A'], ['D']]) => C on table, B on C, A on B, D on table */
function fromStacks(stacks) {
  const blocks = stacks.flat();
  const arrangement = Arrangement.create(blocks);
  arrangement.onTable = stacks.map((stack) => stack[0]);
  arrangement.on = {};
  for (const stack of stacks) {
    for (let i = 1; i < stack.length; i += 1) {
      arrangement.on[stack[i]] = stack[i - 1];
    }
  }
  return arrangement;
}

/** Copy values out of the test VM so deep comparisons compare plain data. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function show(arrangement) {
  return arrangement.onTable
    .map((base) => Arrangement.stackFrom(arrangement, base).join('-on-'))
    .join(' | ');
}

/** Check that a predicate state is a legal Blocks World state. */
function checkState(state, blocks, label) {
  for (const block of blocks) {
    const places =
      (state.has(`OnTable(${block})`) ? 1 : 0) +
      (state.has(`Holding(${block})`) ? 1 : 0) +
      [...state].filter((p) => p.startsWith(`On(${block},`)).length;
    assert.strictEqual(places, 1, `${label}: block ${block} must be in exactly one place`);

    const covered = [...state].some((p) => p.startsWith('On(') && p.endsWith(`,${block})`));
    const held = state.has(`Holding(${block})`);
    assert.strictEqual(
      state.has(`Clear(${block})`),
      !covered && !held,
      `${label}: Clear(${block}) must match the picture`
    );
  }

  const holdingCount = [...state].filter((p) => p.startsWith('Holding(')).length;
  assert.strictEqual(state.has('HandEmpty'), holdingCount === 0, `${label}: HandEmpty consistency`);
  if (holdingCount > 1) assert.fail(`${label}: the hand holds more than one block`);
}

/**
 * Replay a generated plan from the initial state, checking every
 * precondition, and confirm that the goal is really reached.
 */
function verifyPlan(initial, goal, result, label) {
  assert.strictEqual(result.success, true, `${label}: planning failed (${result.failure})`);

  const initialState = Predicates.stateFromArrangement(initial);
  let state = initialState;
  let executed = 0;

  for (const action of result.plan) {
    assert.strictEqual(
      StripsActions.preconditionsSatisfied(state, action),
      true,
      `${label}: action ${StripsActions.describe(action)} has false preconditions`
    );
    state = StripsActions.applyEffects(state, action);
    executed += 1;
    checkState(state, initial.blocks, `${label} after ${StripsActions.describe(action)}`);
  }

  const goals = Predicates.goalPredicatesFromArrangement(goal);
  for (const predicate of goals) {
    assert.strictEqual(state.has(predicate), true, `${label}: goal ${predicate} not reached`);
  }
  assert.strictEqual(Predicates.isGoalSatisfied(state, goals), true, `${label}: goal check failed`);
  assert.strictEqual(executed, result.plan.length, `${label}: plan length mismatch`);
  assert.deepStrictEqual(
    plain(Predicates.sortedList(state)),
    plain(Predicates.sortedList(result.finalState)),
    `${label}: planner state and replayed state differ`
  );

  // No action may repeat a pointless cycle of moving the very same block
  // back and forth more than a few times.
  if (result.plan.length > 0) {
    assert.ok(result.plan.length <= 6 * initial.blocks.length, `${label}: plan looks too long`);
  }
  return executed;
}

function planFor(initial, goal) {
  return GoalStackPlanner.plan(
    Predicates.stateFromArrangement(initial),
    Predicates.goalPredicatesFromArrangement(goal)
  );
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Test 1: same initial and goal state                                */
/* ------------------------------------------------------------------ */
test('Test 1 – identical arrangements produce an empty plan', () => {
  const initial = fromStacks([['C', 'B'], ['A']]);
  const goal = fromStacks([['A'], ['C', 'B']]); // same predicates, other column order
  const result = planFor(initial, goal);
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(plain(result.plan), []);
  assert.strictEqual(result.alreadyAchieved, true);
});

/* ------------------------------------------------------------------ */
/* Test 2: one block has to move                                      */
/* ------------------------------------------------------------------ */
test('Test 2 – one block moved onto another', () => {
  const initial = fromStacks([['A'], ['B'], ['C']]);
  const goal = fromStacks([['C'], ['B', 'A']]);
  const result = planFor(initial, goal);
  const steps = verifyPlan(initial, goal, result, 'test 2');
  assert.deepStrictEqual(
    plain(result.plan.map(StripsActions.describe)),
    ['PICKUP(A)', 'STACK(A, B)'],
    'test 2: expected the shortest natural sequence'
  );
  assert.strictEqual(steps, 2);
});

/* ------------------------------------------------------------------ */
/* Test 3: two blocks have to be rearranged                           */
/* ------------------------------------------------------------------ */
test('Test 3 – two blocks rearranged', () => {
  const initial = fromStacks([['B', 'A'], ['C']]);
  const goal = fromStacks([['A'], ['C', 'B']]);
  const result = planFor(initial, goal);
  verifyPlan(initial, goal, result, 'test 3');
  assert.ok(result.plan.length >= 3);
});

/* ------------------------------------------------------------------ */
/* Test 4: tower – blocks have to be cleared before moving            */
/* ------------------------------------------------------------------ */
test('Test 4 – tower reversed (clear constraint respected)', () => {
  const initial = fromStacks([['C', 'B', 'A']]);
  const goal = fromStacks([['A', 'B', 'C']]);
  const result = planFor(initial, goal);
  verifyPlan(initial, goal, result, 'test 4');

  // The very first action cannot touch a covered block.
  const first = result.plan[0];
  assert.ok(['UNSTACK', 'PICKUP'].includes(first.name), 'test 4: first action must free a block');
  if (first.name === 'UNSTACK') assert.strictEqual(first.args[0], 'A');
});

/* ------------------------------------------------------------------ */
/* Test 5: multiple independent stacks                                */
/* ------------------------------------------------------------------ */
test('Test 5 – multiple independent stacks', () => {
  const initial = fromStacks([['A'], ['B'], ['C'], ['D']]);
  const goal = fromStacks([['D', 'C'], ['B'], ['A']]);
  const result = planFor(initial, goal);
  verifyPlan(initial, goal, result, 'test 5');
});

test('Test 5b – three towers reorganised', () => {
  const initial = fromStacks([['C', 'A'], ['D', 'B'], ['E']]);
  const goal = fromStacks([['E', 'D', 'C'], ['B'], ['A']]);
  const result = planFor(initial, goal);
  verifyPlan(initial, goal, result, 'test 5b');
});

/* ------------------------------------------------------------------ */
/* Test 6: invalid arrangements are rejected                          */
/* ------------------------------------------------------------------ */
test('Test 6 – invalid arrangements are rejected', () => {
  const selfOn = { blocks: ['A', 'B'], onTable: ['A'], on: { B: 'B' } };
  assert.strictEqual(Arrangement.validate(selfOn).valid, false);

  const occupied = { blocks: ['A', 'B', 'C'], onTable: ['C'], on: { A: 'C', B: 'C' } };
  assert.strictEqual(Arrangement.validate(occupied).valid, false);

  const cycle = { blocks: ['A', 'B'], onTable: [], on: { A: 'B', B: 'A' } };
  assert.strictEqual(Arrangement.validate(cycle).valid, false);

  const missing = { blocks: ['A', 'B', 'C'], onTable: ['A'], on: { B: 'A' } };
  assert.strictEqual(Arrangement.validate(missing).valid, false);

  const duplicate = { blocks: ['A', 'A'], onTable: ['A'], on: {} };
  assert.strictEqual(Arrangement.validate(duplicate).valid, false);

  const empty = { blocks: [], onTable: [], on: {} };
  assert.strictEqual(Arrangement.validate(empty).valid, false);

  assert.strictEqual(Arrangement.validate(fromStacks([['A', 'B'], ['C']])).valid, true);
});

test('Test 6b – illegal placement helpers refuse bad drops', () => {
  const arrangement = fromStacks([['A'], ['B'], ['C']]);
  assert.strictEqual(Arrangement.placeOnBlock(arrangement, 'A', 'A'), null, 'no self placement');

  const occupied = Arrangement.placeOnBlock(arrangement, 'C', 'A'); // A becomes covered by C
  assert.ok(occupied);
  assert.strictEqual(Arrangement.placeOnBlock(occupied, 'B', 'A'), null, 'target not clear');
  assert.strictEqual(Arrangement.isClear(occupied, 'A'), false);
  Arrangement.removeBlock(arrangement, 'A');
  assert.ok(Arrangement.validate(Arrangement.removeBlock(arrangement, 'A')).valid);
});

/* ------------------------------------------------------------------ */
/* Test 7: goal already achieved -> no unnecessary actions            */
/* ------------------------------------------------------------------ */
test('Test 7 – goal partly already true needs no extra actions', () => {
  const initial = fromStacks([['C', 'B', 'A'], ['D']]);
  const goal = fromStacks([['C', 'B', 'A'], ['D']]);
  const result = planFor(initial, goal);
  assert.deepStrictEqual(plain(result.plan), []);
  assert.strictEqual(result.alreadyAchieved, true);
});

/* ------------------------------------------------------------------ */
/* Tests 8, 9, 10: reset / pause-resume / single step                 */
/* ------------------------------------------------------------------ */
test('Test 8 – resetting and replaying gives the same final state', () => {
  const initial = fromStacks([['C', 'A'], ['B']]);
  const goal = fromStacks([['A', 'B', 'C']]);
  const result = planFor(initial, goal);

  const replay = (label) => {
    let state = Predicates.stateFromArrangement(initial);
    for (const action of result.plan) {
      const outcome = StripsActions.execute(state, action);
      assert.strictEqual(outcome.ok, true, `${label}: ${outcome.error}`);
      state = outcome.state;
    }
    return state;
  };

  const first = replay('first run');
  const afterReset = replay('after reset');
  assert.deepStrictEqual(
    plain(Predicates.sortedList(first)),
    plain(Predicates.sortedList(afterReset))
  );
  assert.strictEqual(
    Predicates.isGoalSatisfied(afterReset, Predicates.goalPredicatesFromArrangement(goal)),
    true
  );
});

test('Test 9 – executing one action at a time matches the whole plan', () => {
  const initial = fromStacks([['A'], ['B'], ['C'], ['D']]);
  const goal = fromStacks([['A', 'B'], ['C', 'D']]);
  const result = planFor(initial, goal);

  let stepwise = Predicates.stateFromArrangement(initial);
  const executed = [];
  let index = 0;
  while (index < result.plan.length) {
    stepwise = StripsActions.execute(stepwise, result.plan[index]).state;
    executed.push(result.plan[index]);
    index += 1;
  }
  assert.deepStrictEqual(
    plain(executed.map(StripsActions.describe)),
    plain(result.plan.map(StripsActions.describe))
  );
  assert.deepStrictEqual(
    plain(Predicates.sortedList(stepwise)),
    plain(Predicates.sortedList(result.finalState))
  );
});

test('Test 10 – actions with false preconditions are refused', () => {
  const state = Predicates.stateFromArrangement(fromStacks([['A', 'B'], ['C']]));
  const illegal = StripsActions.pickUp('A'); // A is covered by B, so Clear(A) is false
  const outcome = StripsActions.execute(state, illegal);
  assert.strictEqual(outcome.ok, false);
  assert.ok(outcome.error.includes('Clear(A)'), outcome.error);

  // A block that is NOT on the table cannot be picked up from it.
  assert.strictEqual(StripsActions.execute(state, StripsActions.pickUp('B')).ok, false);
  // A clear block on the table can be picked up.
  assert.strictEqual(StripsActions.execute(state, StripsActions.pickUp('C')).ok, true);
  // STACK needs a block in the hand.
  assert.strictEqual(StripsActions.execute(state, StripsActions.stack('B', 'C')).ok, false);
  assert.deepStrictEqual(Predicates.sortedList(outcome.state), Predicates.sortedList(state));
});

/* ------------------------------------------------------------------ */
/* Randomised verification                                            */
/* ------------------------------------------------------------------ */
function randomArrangement(blocks) {
  const shuffled = blocks.slice().sort(() => Math.random() - 0.5);
  const arrangement = Arrangement.create(shuffled);
  arrangement.onTable = [];
  arrangement.on = {};
  const clear = [];
  for (const block of shuffled) {
    if (clear.length === 0 || Math.random() < 0.55) {
      arrangement.onTable.push(block);
    } else {
      const support = clear[Math.floor(Math.random() * clear.length)];
      arrangement.on[block] = support;
      clear.splice(clear.indexOf(support), 1);
    }
    clear.push(block);
  }
  return arrangement;
}

test('Randomised – 120 random problems all produce valid plans', () => {
  let solved = 0;
  let alreadyDone = 0;
  let longest = 0;
  for (const count of [3, 4, 5]) {
    const blocks = ['A', 'B', 'C', 'D', 'E'].slice(0, count);
    for (let i = 0; i < 40; i += 1) {
      const initial = randomArrangement(blocks);
      const goal = randomArrangement(blocks);
      const label = `${count} blocks #${i}: ${show(initial)}  ->  ${show(goal)}`;
      const result = planFor(initial, goal);
      verifyPlan(initial, goal, result, label);
      longest = Math.max(longest, result.plan.length);
      if (result.alreadyAchieved) alreadyDone += 1;
      solved += 1;
    }
  }
  console.log(`      solved ${solved} random problems (${alreadyDone} already satisfied, longest plan ${longest} actions)`);
});

test('Planner terminates quickly and reports failure instead of looping', () => {
  // A goal that needs a block that is not part of the world cannot be solved.
  const state = Predicates.stateFromArrangement(fromStacks([['A'], ['B']]));
  const result = GoalStackPlanner.plan(state, ['On(C,A)']);
  assert.strictEqual(result.success, false);
  assert.ok(result.failure.length > 0);
  assert.ok(result.operations < 100, 'must stop early');
});

/* ------------------------------------------------------------------ */
/* Goal stack snapshots the UI draws                                 */
/* ------------------------------------------------------------------ */

test('Goal stack snapshots line up with the executed plan', () => {
  const initial = fromStacks([['A'], ['B'], ['C']]);
  const goal = fromStacks([['C', 'B', 'A']]);
  const result = planFor(initial, goal);

  // The stack before anything happens: the goal conditions, top first.
  assert.deepStrictEqual(
    plain(result.initialStack),
    plain(['OnTable(C)', 'On(B,C)', 'On(A,B)']),
    'initial stack must list the goal conditions top first'
  );

  assert.strictEqual(
    result.frames.length,
    result.plan.length,
    'one snapshot per executed action'
  );

  result.frames.forEach((frame, index) => {
    assert.strictEqual(frame.planIndex, index);
    assert.strictEqual(frame.action, result.plan[index], 'frame must belong to its action');
    assert.ok(Array.isArray(frame.stack), 'frame.stack must be an array of labels');

    const label = StripsActions.describe(result.plan[index]);
    assert.ok(
      !frame.stack.includes(label),
      `the action ${label} was popped before it ran, so it cannot still be on the stack`
    );
    assert.strictEqual(frame.added.length > 0, true, 'every action adds something');
    assert.deepStrictEqual(plain(frame.added), plain(result.plan[index].addEffects));
    assert.deepStrictEqual(plain(frame.deleted), plain(result.plan[index].deleteEffects));
    assert.ok(
      frame.note.some((line) => line.includes('EXECUTE ' + label)),
      'the note must explain the action'
    );
  });

  // After the last action nothing is left to do.
  assert.deepStrictEqual(plain(result.frames[result.frames.length - 1].stack), []);
});

test('Every frame carries the predicate set of that step', () => {
  const initial = fromStacks([['A'], ['B'], ['C']]);
  const goal = fromStacks([['C', 'B', 'A']]);
  const result = planFor(initial, goal);

  let replay = Predicates.stateFromArrangement(initial);
  result.frames.forEach((frame, index) => {
    replay = StripsActions.applyEffects(replay, result.plan[index]);

    assert.deepStrictEqual(
      plain(frame.state),
      plain(Predicates.sortedList(replay)),
      `frame ${index} must expose the state after its action`
    );
    // Sorted, so the UI can print the chips in a stable order.
    assert.deepStrictEqual(plain(frame.state), plain(frame.state).slice().sort());
    assert.ok(frame.state.length >= 2, 'the state list is never empty');
  });

  // The last frame is the goal state, which is what the success banner shows.
  const last = new Set(result.frames[result.frames.length - 1].state);
  assert.strictEqual(
    Predicates.isGoalSatisfied(last, Predicates.goalPredicatesFromArrangement(goal)),
    true,
    'the final snapshot must satisfy the goal'
  );
});

test('Already satisfied goals report an empty plan and no frames', () => {
  const same = fromStacks([['A'], ['B']]);
  const result = planFor(same, same);
  assert.strictEqual(result.alreadyAchieved, true);
  assert.strictEqual(result.frames.length, 0);
  assert.deepStrictEqual(plain(result.initialStack), plain(['OnTable(A)', 'OnTable(B)']));
});

/* ------------------------------------------------------------------ */
/* Dropdown edits are validated                                       */
/* ------------------------------------------------------------------ */

test('setSupport rejects impossible placements', () => {
  const flat = fromStacks([['A'], ['B']]);

  const self = Arrangement.setSupport(flat, 'A', 'A');
  assert.strictEqual(self.ok, false);
  assert.match(self.error, /itself/);

  const occupied = fromStacks([['A', 'C'], ['B']]);
  const blocked = Arrangement.setSupport(occupied, 'B', 'A');
  assert.strictEqual(blocked.ok, false, 'a block cannot support two blocks');
  assert.match(blocked.error, /already has a block/);

  const onA = Arrangement.setSupport(flat, 'B', 'A');
  assert.strictEqual(onA.ok, true);
  assert.strictEqual(onA.arrangement.on.B, 'A');

  const loop = Arrangement.setSupport(onA.arrangement, 'A', 'B');
  assert.strictEqual(loop.ok, false, 'A on B on A must be refused');
  assert.match(loop.error, /loop/);
  // The refused move leaves the arrangement untouched.
  assert.strictEqual(loop.arrangement, onA.arrangement);

  const back = Arrangement.setSupport(onA.arrangement, 'B', Arrangement.TABLE);
  assert.strictEqual(back.ok, true);
  assert.ok(back.arrangement.onTable.includes('B'));
  assert.strictEqual(Arrangement.validate(back.arrangement).valid, true);
});

/* ------------------------------------------------------------------ */

const failed = results.filter((entry) => !entry.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} tests passed`);
if (failed.length > 0) {
  for (const entry of failed) console.log(`- ${entry.name}: ${entry.error.stack}`);
  process.exitCode = 1;
}
