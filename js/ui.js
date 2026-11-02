/**
 * UI
 * --
 * The interface layer. It owns the app state, the views, the dropdowns, the
 * playback and the messages — but it never plans anything.
 *
 *   Arrangement      -> where the blocks are drawn (plain data)
 *   Predicates       -> that picture as STRIPS predicates
 *   GoalStackPlanner -> initial state + goal conditions -> actions + stack frames
 *   StripsActions    -> executes one action on the state
 *   View             -> draws everything
 *   UI (this file)   -> state, events, playback
 */
const UI = (function () {
  'use strict';

  const LETTERS = 'ABCDEF';
  const FLASH_MS = 1000;                        // how long added/deleted chips stay coloured
  const SPEEDS = { 1: 1500, 2: 1000, 3: 700, 4: 420, 5: 220 };

  const TITLES = {
    planner: 'Block World Planner — STRIPS & Goal Stack Planning',
    how: 'How It Works — Block World Planner'
  };

  /* One-click teaching examples. `initial` / `goal` are towers, base first. */
  const EXAMPLES = {
    simple: {
      label: 'Simple Tower',
      blocks: ['A', 'B', 'C', 'D'],
      initial: [['A'], ['B'], ['C'], ['D']],
      goal: [['D', 'C', 'B', 'A']]
    },
    reverse: {
      label: 'Reverse Tower',
      blocks: ['A', 'B', 'C', 'D'],
      initial: [['D', 'C', 'B', 'A']],
      goal: [['A', 'B', 'C', 'D']]
    },
    // A on C, B on the table -> A on B, B on C. The classic case where the
    // two goals interfere, so Goal Stack Planning has to undo work.
    sussman: {
      label: 'Sussman Anomaly',
      blocks: ['A', 'B', 'C'],
      initial: [['A', 'C'], ['B']],
      goal: [['C', 'B', 'A']]
    }
  };

  const state = {
    view: 'planner',
    blocks: [],
    initial: null,
    goal: null,

    sim: null,               // current STRIPS state
    plan: [],
    frames: [],              // planner snapshot per executed action
    initialStack: [],
    step: 0,
    generated: false,
    planMessage: '',

    running: false,
    timer: null,
    flash: { added: [], deleted: [] },
    flashTimer: null,

    armX: null,              // px centre of the robot arm in the diagram
    fieldErrors: {}          // e.g. { 'initial:B': 'B cannot rest on itself.' }
  };

  let dom = {};
  let resizeTimer = null;

  /* ================================================================
     small helpers
     ================================================================ */

  function blockLetters(count) {
    return LETTERS.slice(0, count).split('');
  }

  function fromStacks(blocks, stacks) {
    const arrangement = Arrangement.create(blocks);
    arrangement.onTable = stacks.map((stack) => stack[0]);
    arrangement.on = {};
    stacks.forEach((stack) => {
      for (let i = 1; i < stack.length; i += 1) {
        arrangement.on[stack[i]] = stack[i - 1];
      }
    });
    return arrangement;
  }

  /** The default goal: neighbouring pairs stacked, a small but real puzzle. */
  function defaultGoal(blocks) {
    let goal = Arrangement.create(blocks);
    for (let i = 1; i + 1 < blocks.length; i += 2) {
      goal = Arrangement.placeOnBlock(goal, blocks[i], blocks[i + 1]) || goal;
    }
    if (blocks.length % 2 === 0 && blocks.length > 2) {
      goal = Arrangement.placeOnBlock(goal, blocks[blocks.length - 1], blocks[0]) || goal;
    }
    return goal;
  }

  function arrangementOf(card) {
    return card === 'initial' ? state.initial : state.goal;
  }

  function setArrangement(card, arrangement) {
    if (card === 'initial') state.initial = arrangement;
    else state.goal = arrangement;
  }

  function matrixLabel(card) {
    return card === 'initial' ? 'Initial state' : 'Goal state';
  }

  /* ================================================================
     toasts and the status line
     ================================================================ */

  function dismissToast(el) {
    if (!el.parentNode) return;
    el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), 200);
  }

  /** A short message that floats in the top-right corner and fades away. */
  function toast(message, kind, title) {
    const el = document.createElement('div');
    el.className = `toast is-${kind || 'info'}`;

    const body = document.createElement('div');
    body.className = 'toast-body';
    const head = document.createElement('strong');
    head.className = 'toast-title';
    head.textContent = title || (kind === 'error' ? 'Not allowed' : kind === 'success' ? 'Done' : 'Heads up');
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    body.appendChild(head);
    body.appendChild(text);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss message');
    close.textContent = '×';

    el.appendChild(body);
    el.appendChild(close);
    dom.toasts.appendChild(el);

    while (dom.toasts.children.length > 3) {
      dom.toasts.firstElementChild.remove();
    }

    const timer = window.setTimeout(() => dismissToast(el), 3800);
    close.addEventListener('click', () => {
      window.clearTimeout(timer);
      dismissToast(el);
    });
  }

  function setStatus(text, kind) {
    dom.status.textContent = text;
    dom.status.className = 'status-line' + (kind === 'ok' ? ' is-ok' : kind === 'error' ? ' is-error' : '');
  }

  /* ================================================================
     the set-up cards
     ================================================================ */

  function buildControls(card) {
    const host = card === 'initial' ? dom.initialControls : dom.goalControls;
    host.textContent = '';

    state.blocks.forEach((block) => {
      const row = document.createElement('div');
      row.className = 'support-row';
      row.dataset.block = block;

      const mini = document.createElement('span');
      mini.className = 'mini';
      mini.style.setProperty('--blk-bg', View.colourOf(block));
      mini.textContent = block;
      mini.setAttribute('aria-hidden', 'true');

      const select = document.createElement('select');
      select.dataset.block = block;
      select.dataset.card = card;
      select.setAttribute('aria-label', `${matrixLabel(card)}: where is block ${block}?`);

      const table = document.createElement('option');
      table.value = Arrangement.TABLE;
      table.textContent = 'Table';
      select.appendChild(table);

      state.blocks
        .filter((other) => other !== block)
        .forEach((other) => {
          const option = document.createElement('option');
          option.value = other;
          option.textContent = `On ${other}`;
          select.appendChild(option);
        });

      const error = document.createElement('p');
      error.className = 'field-error';
      error.hidden = true;

      select.addEventListener('change', () => changeSupport(card, block, select));

      row.appendChild(mini);
      row.appendChild(select);
      row.appendChild(error);
      host.appendChild(row);
    });

    syncControls(card);
  }

  function syncControls(card) {
    const host = card === 'initial' ? dom.initialControls : dom.goalControls;
    const arrangement = arrangementOf(card);
    host.querySelectorAll('select').forEach((select) => {
      const support = Arrangement.supportOf(arrangement, select.dataset.block);
      select.value = support === null ? Arrangement.TABLE : support;
    });
    renderFieldErrors(card);
  }

  /** Show (or hide) the red line under the select that is wrong. */
  function renderFieldErrors(card) {
    const host = card === 'initial' ? dom.initialControls : dom.goalControls;
    host.querySelectorAll('.support-row').forEach((row) => {
      const key = `${card}:${row.dataset.block}`;
      const message = state.fieldErrors[key] || '';
      const error = row.querySelector('.field-error');
      error.textContent = message;
      error.hidden = !message;
      row.classList.toggle('is-invalid', Boolean(message));
    });
  }

  /** Errors belong to one field, so one successful change clears them all. */
  function clearFieldErrors() {
    state.fieldErrors = {};
    renderFieldErrors('initial');
    renderFieldErrors('goal');
  }

  function changeSupport(card, block, select) {
    const result = Arrangement.setSupport(arrangementOf(card), block, select.value);

    if (!result.ok) {
      state.fieldErrors = {};
      state.fieldErrors[`${card}:${block}`] = result.error;
      renderFieldErrors(card);
      select.value = Arrangement.supportOf(arrangementOf(card), block) || Arrangement.TABLE;
      toast(result.error, 'error', 'Not a valid move');
      setStatus(result.error, 'error');
      return;
    }

    clearFieldErrors();
    setArrangement(card, result.arrangement);
    invalidatePlan(`${matrixLabel(card)} updated — generate a new plan.`);
  }

  /* ================================================================
     plan lifecycle
     ================================================================ */

  /** Any change to the two states makes the old plan meaningless. */
  function invalidatePlan(message) {
    stopRun();
    clearFlash();
    state.plan = [];
    state.frames = [];
    state.initialStack = [];
    state.step = 0;
    state.generated = false;
    state.planMessage = '';
    state.armX = null;
    state.sim = new Set(Predicates.stateFromArrangement(state.initial));
    refresh();
    if (message) setStatus(message, 'info');
  }

  function generatePlan() {
    stopRun();
    clearFlash();
    closeAllFieldErrors();
    state.armX = null;

    const initialCheck = Arrangement.validate(state.initial);
    const goalCheck = Arrangement.validate(state.goal);
    if (!initialCheck.valid || !goalCheck.valid) {
      const message = (initialCheck.valid ? goalCheck : initialCheck).errors[0];
      toast(message, 'error', 'These states are not valid');
      setStatus(message, 'error');
      return;
    }

    state.step = 0;
    state.sim = new Set(Predicates.stateFromArrangement(state.initial));

    const goals = Predicates.goalPredicatesFromArrangement(state.goal);
    const result = GoalStackPlanner.plan(state.sim, goals);

    state.plan = result.plan;
    state.frames = result.frames;
    state.initialStack = result.initialStack;
    state.generated = result.success;
    state.planMessage = '';

    if (!result.success) {
      state.planMessage = result.failure;
      toast(result.failure, 'error', 'No plan found');
      setStatus(result.failure, 'error');
    } else if (result.alreadyAchieved) {
      toast('The initial state already matches the goal — nothing to do.', 'info', 'Already at the goal');
      setStatus('Already at the goal: the plan is empty.', 'ok');
    } else {
      toast(`${result.plan.length} actions found by Goal Stack Planning.`, 'success', 'Plan generated');
      setStatus(`Plan ready: ${result.plan.length} actions. Press Step or Run All.`, 'info');
    }

    refresh();
  }

  function closeAllFieldErrors() {
    state.fieldErrors = {};
    renderFieldErrors('initial');
    renderFieldErrors('goal');
  }

  /* ================================================================
     playback
     ================================================================ */

  function canStep() {
    return state.plan.length > 0 && state.step < state.plan.length;
  }

  /** Execute exactly one action of the plan. */
  function stepOnce() {
    if (!canStep()) return false;

    const action = state.plan[state.step];
    const name = StripsActions.describe(action);

    // Where the arm should be for this action, read from the screen as it is now.
    const pickupX = action.name === 'PICKUP' ? View.blockCentre(dom.currentDiagram, action.args[0]) : null;
    const targetX = action.name === 'STACK' || action.name === 'UNSTACK'
      ? View.towerCentre(dom.currentDiagram, action.args[1])
      : null;

    const outcome = StripsActions.execute(state.sim, action);
    if (!outcome.ok) {
      stopRun();
      toast(outcome.error, 'error', 'Action blocked');
      setStatus(outcome.error, 'error');
      return false;
    }

    state.sim = outcome.state;
    state.step += 1;
    if (pickupX !== null) state.armX = pickupX;
    else if (targetX !== null) state.armX = targetX;

    state.flash = { added: action.addEffects.slice(), deleted: action.deleteEffects.slice() };
    restartFlashTimer();

    if (state.step === state.plan.length) {
      const reached = Predicates.isGoalSatisfied(
        state.sim,
        Predicates.goalPredicatesFromArrangement(state.goal)
      );
      if (reached) {
        toast(`${state.plan.length} actions executed, goal satisfied.`, 'success', 'Goal reached');
        setStatus(`Done — goal reached in ${state.plan.length} actions.`, 'ok');
      } else {
        setStatus('All actions executed, but the goal is not satisfied.', 'error');
      }
    } else {
      setStatus(`Step ${state.step} of ${state.plan.length}: ${name}`, 'info');
    }

    refresh();
    return true;
  }

  function startRun() {
    if (!canStep() || state.running) return;
    state.running = true;
    refresh();
    tick();
  }

  function tick() {
    if (!state.running) return;
    stepOnce();

    if (state.running && canStep()) {
      const delay = SPEEDS[Number(dom.speed.value)] || 700;
      state.timer = window.setTimeout(tick, delay);
    } else if (state.running) {
      state.running = false;
      refresh();
    }
  }

  function stopRun() {
    state.running = false;
    if (state.timer !== null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function toggleRun() {
    if (state.running) {
      stopRun();
      setStatus(`Paused at step ${state.step} of ${state.plan.length}.`, 'info');
      refresh();
    } else {
      startRun();
    }
  }

  function resetSimulation() {
    stopRun();
    clearFlash();
    state.step = 0;
    state.armX = null;
    state.sim = new Set(Predicates.stateFromArrangement(state.initial));
    refresh();
    setStatus('Reset — the current state is the initial state again.', 'info');
  }

  function restartFlashTimer() {
    if (state.flashTimer !== null) window.clearTimeout(state.flashTimer);
    state.flashTimer = window.setTimeout(() => {
      state.flash = { added: [], deleted: [] };
      state.flashTimer = null;
      renderPredicates();
    }, FLASH_MS);
  }

  function clearFlash() {
    if (state.flashTimer !== null) {
      window.clearTimeout(state.flashTimer);
      state.flashTimer = null;
    }
    state.flash = { added: [], deleted: [] };
  }

  /* ================================================================
     drawing
     ================================================================ */

  /** Stack rows for the current step, or null when no plan was generated. */
  function stackItems() {
    if (!state.generated) return null;
    // No frames means the goal was already satisfied, so the goal stack never
    // moved past its starting state.
    if (!state.frames.length) return state.initialStack.map((label) => ({ label }));
    const labels = state.step === 0 ? state.initialStack : state.frames[state.step - 1].stack;
    return labels.map((label) => ({ label }));
  }

  /** The stack decisions that explain what just happened. */
  function stackNote() {
    if (!state.frames.length) return '';
    const frame = state.step === 0 ? state.frames[0] : state.frames[state.step - 1];
    const decisions = frame.note.filter((line) => /^(POP GOAL|TOP ACTION|EXECUTE)/.test(line));
    return decisions.slice(-2).map(View.traceLine).join('\n');
  }

  function renderStack() {
    if (!state.generated) {
      View.emptyState(dom.goalStack, {
        icon: 'stack',
        title: 'No plan generated yet',
        hint: 'Press Generate Plan to watch the goal stack fill up.'
      });
      dom.stackNote.hidden = true;
      return;
    }

    const items = stackItems();
    if (!items || !items.length) {
      View.emptyState(dom.goalStack, {
        icon: 'stack',
        title: 'Stack empty',
        hint: state.plan.length ? 'Every goal on the stack has been solved.' : (state.planMessage || 'Nothing to solve.')
      });
      dom.stackNote.hidden = true;
      return;
    }

    View.goalStack(dom.goalStack, items);
    const note = state.frames.length
      ? stackNote()
      : 'Every goal was already true — the stack was never popped.';
    dom.stackNote.textContent = note;
    dom.stackNote.hidden = !note;
  }

  function renderPlan() {
    dom.planCount.textContent = `${state.plan.length} action${state.plan.length === 1 ? '' : 's'}`;

    if (!state.plan.length) {
      View.emptyState(dom.planList, {
        icon: 'list',
        title: state.generated ? 'Plan is empty' : 'No plan yet',
        hint: state.planMessage || (state.generated
          ? 'The initial state already satisfies the goal.'
          : 'Press Generate Plan to run Goal Stack Planning.')
      });
      return;
    }

    View.plan(dom.planList, state.plan.map((action, index) => ({
      label: StripsActions.describe(action),
      status: index < state.step ? 'done' : index === state.step ? 'current' : 'pending'
    })));
  }

  function renderPredicates() {
    const frame = state.step > 0 ? state.frames[state.step - 1] : null;
    // The planner's own snapshot of the state at this step.
    const predicates = frame ? new Set(frame.state) : state.sim;
    View.predicates(dom.predicates, predicates, state.flash);
    dom.predicateCount.textContent = `${predicates.size}`;
  }

  function renderBanner() {
    const finished = state.plan.length > 0 && state.step === state.plan.length;
    const already = state.generated && state.plan.length === 0 && Boolean(state.initialStack.length);

    if (!finished && !already) {
      dom.banner.hidden = true;
      return;
    }

    const frame = state.frames.length ? state.frames[state.frames.length - 1] : null;
    const predicates = frame ? new Set(frame.state) : state.sim;

    dom.banner.hidden = false;
    dom.banner.classList.toggle('is-info', already);
    dom.bannerTitle.textContent = already
      ? 'Goal already satisfied'
      : `Goal reached in ${state.plan.length} action${state.plan.length === 1 ? '' : 's'}`;
    dom.bannerText.textContent = already
      ? 'The initial state already matches the goal, so no actions are needed.'
      : 'Every goal condition is satisfied — this is the final state.';

    View.predicates(dom.bannerChips, predicates, null);
  }

  function hintText() {
    if (!state.generated) return 'Generate a plan to start.';
    if (!state.plan.length) return state.planMessage || 'The plan is empty.';
    if (state.step < state.plan.length) return `Next: ${StripsActions.describe(state.plan[state.step])}`;
    return 'Plan complete — the goal is satisfied.';
  }

  function renderButtons() {
    const hasPlan = state.plan.length > 0;
    dom.btnGenerate.disabled = state.running;
    dom.btnStep.disabled = state.running || !canStep();
    dom.btnRun.disabled = !hasPlan || (!state.running && !canStep());
    dom.btnRun.textContent = state.running ? 'Pause ⏸' : 'Run All ▶▶';
    dom.btnReset.disabled = state.running || (!hasPlan && state.step === 0);
  }

  function refresh() {
    View.diagram(dom.initialDiagram, Predicates.stacksFromState(Predicates.stateFromArrangement(state.initial)), {});
    View.diagram(dom.goalDiagram, Predicates.stacksFromState(Predicates.stateFromArrangement(state.goal)), {});

    const used = View.diagram(
      dom.currentDiagram,
      Predicates.stacksFromState(state.sim),
      { arm: true, handX: state.armX }
    );
    if (state.armX === null && used !== null) state.armX = used;

    syncControls('initial');
    syncControls('goal');

    dom.stepBadge.textContent = `Step ${state.step} of ${state.plan.length}`;
    dom.currentAction.textContent = state.step === 0
      ? 'No action executed yet'
      : StripsActions.describe(state.plan[state.step - 1]);
    dom.currentHint.textContent = hintText();

    renderStack();
    renderPlan();
    renderPredicates();
    renderBanner();
    renderButtons();
  }

  /* ================================================================
     setup actions
     ================================================================ */

  function changeBlockCount(count) {
    // Keep what the user already arranged, add or drop the extra blocks.
    let initial = Arrangement.clone(state.initial);
    let goal = Arrangement.clone(state.goal);

    state.blocks
      .filter((block) => blockLetters(count).indexOf(block) === -1)
      .sort()
      .reverse()
      .forEach((block) => {
        initial = Arrangement.removeBlock(initial, block);
        goal = Arrangement.removeBlock(goal, block);
      });
    blockLetters(count).forEach((block) => {
      initial = Arrangement.addBlock(initial, block);
      goal = Arrangement.addBlock(goal, block);
    });

    state.blocks = blockLetters(count);
    state.initial = initial;
    state.goal = goal;

    buildControls('initial');
    buildControls('goal');
    clearFieldErrors();
    invalidatePlan(`Now using ${count} blocks — generate a plan.`);
  }

  function loadExample(key) {
    const example = EXAMPLES[key];
    if (!example) return;

    state.blocks = example.blocks.slice();
    dom.blockCount.value = String(state.blocks.length);
    state.initial = fromStacks(example.blocks, example.initial);
    state.goal = fromStacks(example.blocks, example.goal);

    buildControls('initial');
    buildControls('goal');
    clearFieldErrors();
    invalidatePlan('');
    toast(`${example.label} loaded — press Generate Plan.`, 'info', 'Example ready');
    setStatus(`${example.label} loaded. Press Generate Plan.`, 'info');
    dom.exampleSelect.value = '';
  }

  /* ================================================================
     views and events
     ================================================================ */

  function showView(name, options) {
    const opts = options || {};
    state.view = name;

    Object.keys(TITLES).forEach((key) => {
      const view = document.getElementById(`view-${key}`);
      if (view) view.hidden = key !== name;
    });

    document.querySelectorAll('.nav-link').forEach((link) => {
      const active = link.dataset.nav === name;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    document.title = TITLES[name] || TITLES.planner;
    closeMenu();
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
    // The stage sizes depend on layout, so redraw once the new view is visible.
    if (name === 'planner') refresh();
  }

  function closeMenu() {
    dom.navLinks.classList.remove('is-open');
    dom.navToggle.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    const open = dom.navLinks.classList.toggle('is-open');
    dom.navToggle.setAttribute('aria-expanded', String(open));
  }

  function wireEvents() {
    dom.btnGenerate.addEventListener('click', generatePlan);
    dom.btnStep.addEventListener('click', () => {
      if (!state.running) stepOnce();
    });
    dom.btnRun.addEventListener('click', toggleRun);
    dom.btnReset.addEventListener('click', resetSimulation);

    dom.blockCount.addEventListener('change', () => changeBlockCount(Number(dom.blockCount.value)));
    dom.exampleSelect.addEventListener('change', () => loadExample(dom.exampleSelect.value));

    dom.navToggle.addEventListener('click', toggleMenu);

    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        showView(el.dataset.nav);
      });
    });

    // Right arrow = one step, handy during a demo.
    document.addEventListener('keydown', (event) => {
      const tag = event.target && event.target.tagName;
      const typing = tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA';

      if (event.key === 'Escape') {
        closeMenu();
        return;
      }
      if (typing || state.view !== 'planner') return;
      if (event.key === 'ArrowRight' && !state.running && canStep()) {
        event.preventDefault();
        stepOnce();
      }
    });

    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (state.view === 'planner') refresh();
      }, 150);
    });
  }

  /* ================================================================
     start
     ================================================================ */

  function init() {
    dom = {
      initialDiagram: document.getElementById('initial-diagram'),
      goalDiagram: document.getElementById('goal-diagram'),
      currentDiagram: document.getElementById('current-diagram'),
      initialControls: document.getElementById('initial-controls'),
      goalControls: document.getElementById('goal-controls'),
      goalStack: document.getElementById('goal-stack'),
      stackNote: document.getElementById('stack-note'),
      planList: document.getElementById('plan-list'),
      planCount: document.getElementById('plan-count'),
      predicates: document.getElementById('predicates'),
      predicateCount: document.getElementById('predicate-count'),
      stepBadge: document.getElementById('step-badge'),
      currentAction: document.getElementById('current-action'),
      currentHint: document.getElementById('current-hint'),
      banner: document.getElementById('banner'),
      bannerTitle: document.getElementById('banner-title'),
      bannerText: document.getElementById('banner-text'),
      bannerChips: document.getElementById('banner-chips'),
      btnGenerate: document.getElementById('btn-generate'),
      btnStep: document.getElementById('btn-step'),
      btnRun: document.getElementById('btn-run'),
      btnReset: document.getElementById('btn-reset'),
      speed: document.getElementById('speed'),
      blockCount: document.getElementById('block-count'),
      exampleSelect: document.getElementById('example-select'),
      status: document.getElementById('status'),
      toasts: document.getElementById('toasts'),
      navLinks: document.getElementById('nav-links'),
      navToggle: document.getElementById('nav-toggle')
    };

    state.blocks = blockLetters(Number(dom.blockCount.value));
    state.initial = Arrangement.create(state.blocks);
    state.goal = defaultGoal(state.blocks);
    state.sim = new Set(Predicates.stateFromArrangement(state.initial));

    buildControls('initial');
    buildControls('goal');
    wireEvents();

    const year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());

    showView('planner', { scroll: false });
    refresh();
    setStatus('Ready — set both states, then generate a plan.', 'info');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, showView };
}());
