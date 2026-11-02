/**
 * View
 * ----
 * Drawing only. Every function here receives plain data and returns DOM; it
 * holds no app state and listens to no events.
 *
 *   ui.js     -> "what state are we in, what happens on a click"
 *   render.js -> "what does a tower / a chip / a stack row look like"
 */
const View = (function () {
  'use strict';

  /* Fixed pastel per block letter, so a block keeps its colour everywhere. */
  const PALETTE = ['#8fb6f2', '#f6b0a8', '#9ed8ac', '#f7d188', '#c4b2ec', '#93d3d6'];

  /* The one and only display form of a predicate. */
  const PREDICATE_NAMES = {
    On: 'ON',
    OnTable: 'ONTABLE',
    Clear: 'CLEAR',
    Holding: 'HOLDING',
    HandEmpty: 'ARMEMPTY'
  };

  const ACTION_LABEL = /^(PICKUP|PUTDOWN|STACK|UNSTACK)\(/;

  const ICONS = {
    stack:
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z"/><path d="M3 12.5 12 17l9-4.5"/><path d="M3 17 12 21.5 21 17"/></svg>',
    list:
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>'
  };

  function colourOf(name) {
    const index = (name.charCodeAt(0) - 65 + PALETTE.length * 10) % PALETTE.length;
    return PALETTE[index];
  }

  /* ------------------------------------------------------------ predicates */

  /** "On(C,A)" -> "ON(C,A)", "HandEmpty" -> "ARMEMPTY". */
  function predicateLabel(predicate) {
    const open = predicate.indexOf('(');
    if (open === -1) return PREDICATE_NAMES[predicate] || predicate.toUpperCase();
    const name = predicate.slice(0, open);
    return `${PREDICATE_NAMES[name] || name.toUpperCase()}${predicate.slice(open)}`;
  }

  /** A goal-stack entry is either a predicate or an action like "STACK(A, B)". */
  function labelInfo(label) {
    return ACTION_LABEL.test(label) ? { text: label, type: 'action' } : { text: predicateLabel(label), type: 'goal' };
  }

  /** Planner trace lines also mention predicates, so they get the same format. */
  function traceLine(line) {
    return line
      .replace(/\b(OnTable|On|Clear|Holding)\(([^)]*)\)/g, (match, name, args) => predicateLabel(`${name}(${args})`))
      .replace(/\bHandEmpty\b/g, PREDICATE_NAMES.HandEmpty);
  }

  /* --------------------------------------------------------------- diagram */

  function buildBlock(name, extraClass) {
    const el = document.createElement('div');
    el.className = `blk${extraClass ? ` ${extraClass}` : ''}`;
    el.dataset.block = name;
    el.style.setProperty('--blk-bg', colourOf(name));
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `Block ${name}`);
    el.textContent = name;
    return el;
  }

  /** Remember where every block sits, so it can glide to its new place. */
  function captureRects(container) {
    const rects = {};
    const box = container.getBoundingClientRect();
    container.querySelectorAll('.tower .blk').forEach((el) => {
      const rect = el.getBoundingClientRect();
      rects[el.dataset.block] = { x: rect.left - box.left, y: rect.top - box.top };
    });
    return rects;
  }

  /** FLIP animation: start at the old spot, transition to the new one. */
  function glideFrom(rects, container) {
    const box = container.getBoundingClientRect();
    container.querySelectorAll('.tower .blk').forEach((el) => {
      const old = rects[el.dataset.block];
      if (!old) return;
      const rect = el.getBoundingClientRect();
      const dx = old.x - (rect.left - box.left);
      const dy = old.y - (rect.top - box.top);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.getBoundingClientRect();            // force a reflow
      el.style.transition = 'transform 400ms cubic-bezier(.3,.7,.3,1)';
      el.style.transform = '';
    });
  }

  /**
   * Towers of a state, base first. The visited set stops a broken state from
   * being walked forever, and — unlike a length limit — it never drops a
   * block off the top of a tall stack.
   */
  function towerNames(model, base) {
    const names = [];
    const seen = new Set();
    let current = base;
    while (current && !seen.has(current)) {
      seen.add(current);
      names.push(current);
      current = model.above[current];
    }
    return names;
  }

  /**
   * The robot arm: a rail across the top, a short rod and a gripper that holds
   * a block when the state says HOLDING(x). The stage reserves a block of
   * headroom (see styles.css), so the arm always travels above the stacks.
   */
  function drawArm(container, model, handX) {
    const sample = container.querySelector('.blk');
    const blockSize = sample ? sample.offsetHeight : 56;

    const arm = document.createElement('div');
    arm.className = 'arm';
    arm.style.width = `${blockSize}px`;

    const centre = handX === null || handX === undefined ? container.clientWidth / 2 : handX;
    arm.style.setProperty('--x', `${Math.round(centre - blockSize / 2)}px`);

    const rodEl = document.createElement('div');
    rodEl.className = 'arm-rod';
    const grip = document.createElement('div');
    grip.className = 'arm-grip';
    arm.appendChild(rodEl);
    arm.appendChild(grip);
    if (model.holding) arm.appendChild(buildBlock(model.holding, 'is-held'));

    container.appendChild(arm);
    return centre;
  }

  /**
   * Draw one arrangement.
   *
   * @param {HTMLElement} container
   * @param {{bases:string[], on:Object, above:Object, holding:string|null}} model
   *        from Predicates.stacksFromState
   * @param {{arm?:boolean, handX?:number|null}} options
   * @returns {number|null} the arm centre that was used, so the UI can store it
   */
  function diagram(container, model, options) {
    const opts = options || {};
    const previous = captureRects(container);

    container.textContent = '';

    model.bases.forEach((base) => {
      const column = document.createElement('div');
      column.className = 'tower';
      column.dataset.base = base;
      // Top block first: the column is a flex column, so it grows upwards
      // visually while still sitting on the table line at the bottom.
      towerNames(model, base).reverse().forEach((name) => column.appendChild(buildBlock(name)));
      container.appendChild(column);
    });

    const handCentre = opts.arm ? drawArm(container, model, opts.handX) : null;
    glideFrom(previous, container);
    return handCentre;
  }

  /** Horizontal centre of a block inside a diagram, or null when it is gone. */
  function blockCentre(container, name) {
    const el = container.querySelector(`.blk[data-block="${name}"]`);
    if (!el) return null;
    const box = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return rect.left - box.left + rect.width / 2;
  }

  /** Horizontal centre of the tower that stands on `name`. */
  function towerCentre(container, name) {
    const el = container.querySelector(`.tower[data-base="${name}"]`);
    if (!el) return null;
    const box = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return rect.left - box.left + rect.width / 2;
  }

  /* ----------------------------------------------------------- empty state */

  function emptyState(container, options) {
    container.textContent = '';
    const box = document.createElement('div');
    box.className = 'empty';
    const icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.innerHTML = ICONS[options.icon] || ICONS.stack;
    const title = document.createElement('p');
    title.className = 'empty-title';
    title.textContent = options.title;
    box.appendChild(icon);
    box.appendChild(title);
    if (options.hint) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = options.hint;
      box.appendChild(hint);
    }
    container.appendChild(box);
  }

  /* ------------------------------------------------------------- predicates */

  /**
   * Chips of one state. Predicates the last action added are green, the ones
   * it deleted are red (struck through), everything else is neutral.
   */
  function predicates(container, state, flash) {
    const added = flash ? flash.added : [];
    const deleted = flash ? flash.deleted : [];
    // Sorted by the label the user reads (ARMEMPTY before CLEAR), not by the
    // internal predicate name.
    const rest = Predicates.sortedList(state)
      .filter((predicate) => added.indexOf(predicate) === -1)
      .sort((a, b) => predicateLabel(a).localeCompare(predicateLabel(b)));

    container.textContent = '';
    [
      ...added.map((predicate) => ({ predicate, kind: 'is-added' })),
      ...deleted.map((predicate) => ({ predicate, kind: 'is-deleted' })),
      ...rest.map((predicate) => ({ predicate, kind: '' }))
    ].forEach(({ predicate, kind }) => {
      const chip = document.createElement('span');
      chip.className = `chip${kind ? ` ${kind}` : ''}`;
      chip.textContent = predicateLabel(predicate);
      container.appendChild(chip);
    });
  }

  /* ------------------------------------------------------------------ stack */

  /** Goal stack, top item first and highlighted. items = [{label, type}] */
  function goalStack(container, items) {
    container.textContent = '';
    items.forEach((item, index) => {
      const info = labelInfo(item.label);
      const row = document.createElement('div');
      row.className = `stack-item is-${info.type}${index === 0 ? ' is-top' : ''}`;

      const badge = document.createElement('span');
      badge.className = 'stack-badge';
      badge.textContent = info.type === 'goal' ? 'G' : 'A';
      badge.title = info.type === 'goal' ? 'Goal condition' : 'Operator';

      const label = document.createElement('span');
      label.className = 'stack-label';
      label.textContent = info.text;

      row.appendChild(badge);
      row.appendChild(label);
      if (index === 0) {
        const top = document.createElement('span');
        top.className = 'stack-top';
        top.textContent = 'next';
        row.appendChild(top);
      }
      container.appendChild(row);
    });
  }

  /* ------------------------------------------------------------------- plan */

  /** Plan rows: finished (tick), current (highlighted), pending (dimmed). */
  function plan(container, items) {
    container.textContent = '';
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `plan-item is-${item.status}`;
      row.setAttribute('role', 'listitem');

      const num = document.createElement('span');
      num.className = 'plan-num';
      num.textContent = index + 1;

      const name = document.createElement('span');
      name.className = 'plan-name';
      name.textContent = item.label;

      row.appendChild(num);
      row.appendChild(name);

      if (item.status === 'done') {
        const tick = document.createElement('span');
        tick.className = 'plan-tick';
        tick.innerHTML = ICONS.check;
        row.appendChild(tick);
      } else if (item.status === 'current') {
        const now = document.createElement('span');
        now.className = 'plan-now';
        now.textContent = 'now';
        row.appendChild(now);
      }
      container.appendChild(row);
    });
  }

  return {
    colourOf,
    predicateLabel,
    traceLine,
    diagram,
    blockCentre,
    towerCentre,
    emptyState,
    predicates,
    goalStack,
    plan
  };
}());
