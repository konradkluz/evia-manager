import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { classNames } from './class-names.ts';

export interface TabItem {
  readonly id: string;
  /** The label of the tab (`text.label-lg`); the panel of the selected tab is `children`. */
  readonly label: string;
}

export interface TabsProps {
  /** Accessible name of the tab list ("Sekcje zlecenia"). */
  readonly label: string;
  readonly tabs: readonly TabItem[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  /** The content of the selected tab. */
  readonly children: ReactNode;
}

/**
 * Tabs (styleguide § 3.17): a `tablist` of `tab` buttons and one `tabpanel`. The selected tab has the indicator
 * `border-width.indicator` in `color.border.selected` and a semibold label (the state is not carried by colour alone);
 * only the selected tab is in the tab order, the arrows (and Home / End) move to the neighbour and select it (automatic
 * activation, WAI-ARIA authoring practices). The panel is focusable so a keyboard user can reach content that has no
 * focusable element of its own. Texts come as props.
 */
export function Tabs({ label, tabs, selectedId, onSelect, children }: TabsProps) {
  const base = useId();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    const next = target === undefined ? undefined : tabs[target];
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next.id);
    refs.current.get(next.id)?.focus();
  };
  return (
    <div className="flex flex-col gap-stack-md">
      <div role="tablist" aria-label={label} className="flex gap-inline-md border-b-default">
        {tabs.map((tab, index) => {
          const selected = tab.id === selectedId;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node === null) refs.current.delete(tab.id);
                else refs.current.set(tab.id, node);
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                onSelect(tab.id);
              }}
              onKeyDown={(event) => {
                move(event, index);
              }}
              className={classNames(
                'min-h-control-height-web-md px-inset-sm text-label-lg text-text-primary hover:bg-bg-surface-hover active:bg-bg-surface-pressed focus-visible:focus-ring-inner',
                selected ? 'border-b-indicator font-semibold' : 'border-b-transparent',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) =>
        tab.id === selectedId ? (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${base}-panel-${tab.id}`}
            aria-labelledby={`${base}-tab-${tab.id}`}
            tabIndex={0}
            className="flex flex-col gap-stack-lg focus-visible:focus-ring"
          >
            {children}
          </div>
        ) : null,
      )}
    </div>
  );
}
