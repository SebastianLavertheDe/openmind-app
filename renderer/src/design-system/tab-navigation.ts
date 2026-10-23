const CANDIDATES = 'a[href], area[href], button, input, select, textarea, summary, [contenteditable="true"], [tabindex]';

/** Sequential keyboard targets, shared by popups and modal focus scopes. */
export function tabStops(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter(element => {
    if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]')
      || element.closest('[hidden], [inert], [aria-hidden="true"]')
      || element.classList.contains('ui-select-native-proxy')) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (node instanceof HTMLDetailsElement && !node.open
        && !node.querySelector('summary')?.contains(element)) return false;
    }
    return true;
  }).sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}

export function focusAfterTrigger(trigger: HTMLElement | null): void {
  if (!trigger) return;
  const scope = trigger.closest<HTMLElement>('[aria-modal="true"]');
  const targets = tabStops(scope || document).filter(element => !element.closest('.ui-dropdown-menu, .ui-select-menu'));
  const index = targets.indexOf(trigger);
  if (index < 0) return;
  const next = targets[index + 1] || (scope ? targets[0] : null);
  if (next) next.focus();
  else trigger.blur();
}
