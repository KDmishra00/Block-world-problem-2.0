# Block World Planning Simulator

An interactive Blocks World planner for a university AI course: **STRIPS**
operators plus **Goal Stack Planning**, with a browser interface that shows the
goal stack, the plan and the logical state at every step.

No build step, no framework, no dependencies. Plain HTML, CSS and JavaScript.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://127.0.0.1:8000/
```

Run the logic tests with Node:

```bash
node tests/run-tests.js
```

## Pages

| Page | What it shows |
|---|---|
| **Planner** | Set up the states, generate a plan, step or run it, and watch the stack, plan and predicates |
| **How It Works** | Blocks World, the five predicates, the four operators, Goal Stack Planning in five steps |

The navbar switches views in place; there is no router and no page reload.

## Files

```
index.html          two views: planner and how it works
styles.css          design tokens, layout, diagrams, toasts, responsive rules

js/arrangement.js   where each block stands (plain data + validation)
js/predicates.js    arrangement <-> STRIPS predicates, goal extraction
js/actions.js       the four STRIPS operators and execute()
js/planner.js       Goal Stack Planning + per-step viewer snapshots
js/render.js        drawing only: towers, robot arm, chips, stack, plan
js/ui.js            app state, views, dropdowns, playback, messages

tests/run-tests.js  logic tests (planner, replay, validation, snapshots)
```

The four `js/` modules below `ui.js` never touch the DOM; `render.js` never
touches app state. That split is what keeps the planner explainable.

## How a plan is produced

1. Each card is an arrangement: a table order plus `on[block] = support`.
2. `Predicates.stateFromArrangement` turns it into a `Set` of `On`, `OnTable`,
   `Clear` and `HandEmpty` predicates.
3. The goal card becomes a goal list, bottom-up per tower.
4. `GoalStackPlanner.plan(state, goals)` runs the textbook procedure: pop
   satisfied goals, otherwise push an operator and its unmet preconditions;
   execute an operator only when its preconditions hold.
5. The planner returns the actions plus a snapshot per action: the stack, the
   added/deleted predicates and the whole predicate set at that step.
6. The UI replays the plan. Each step calls `StripsActions.execute`, which
   refuses any action whose preconditions are false, and redraws the diagram
   from the new state.

## Notes

- Predicates are displayed as `ON(A,B)`, `ONTABLE(A)`, `CLEAR(A)`,
  `HOLDING(A)` and `ARMEMPTY` everywhere.
- Plans are valid but not guaranteed shortest: Goal Stack Planning is
  goal-driven, it does not search the state space.
- Dropdown edits are validated (`setSupport`), so impossible pictures — a block
  on itself, two blocks on one block, a cycle — are refused with a short
  message under the field.
- The Examples menu loads Simple Tower, Reverse Tower and Sussman Anomaly.
