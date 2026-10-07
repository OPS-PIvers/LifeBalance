import React from 'react';
import { Row, SurfaceList } from '@/components/ui/Section';
import Select from '@/components/ui/Select';
import { cn } from '@/utils/cn';
import {
  MODULE_TITLES,
  addModule,
  autoScrolls,
  dayModule,
  removeModule,
  setAutoScroll,
  setDayModule,
  shownModules,
  switchModule,
  withTopModule,
} from '@/utils/wall/wallModules';
import { WALL_MODULE_KEYS, effectiveLayout } from '@/utils/wall/wallSettings';
import type { WallDisplay, WallLayout, WallModuleKey, WallSettings } from '@/types/schema';

const NONE = 'none';

const label = 'text-sm font-semibold text-brand-900 dark:text-brand-100';
const hint = 'text-xs text-brand-500 dark:text-brand-400';

/** The modules a slot can pick: its own, plus any not showing elsewhere. */
function choices(layout: WallLayout, current: WallModuleKey | null | undefined): WallModuleKey[] {
  const shown = shownModules(layout);
  return WALL_MODULE_KEYS.filter(k => k === current || !shown.includes(k));
}

interface WallDisplayLayoutProps {
  display: WallDisplay;
  settings: WallSettings;
  onSave: (layout: WallLayout) => void;
}

/**
 * One paired wall's Week screen, arranged from the phone: the same three
 * slots and auto scroll the wall's Arrange mode, swipes and pause / play
 * change, saved to the display's own layout so the wall follows at once.
 */
export const WallDisplayLayout: React.FC<WallDisplayLayoutProps> = ({ display, settings, onSave }) => {
  const base = withTopModule(effectiveLayout(display.layout, settings));
  const day = dayModule(base);
  // The slot under today is saved as shown, so a change to the panel never hides or brings back Due today.
  const layout: WallLayout = base.day === undefined ? { ...base, day } : base;
  const [top, bottom] = layout.modules;

  const setBottom = (value: string) => {
    if (value === NONE) onSave(removeModule(layout, 1));
    else {
      const key = value as WallModuleKey;
      onSave(bottom ? switchModule(layout, 1, key) : addModule(layout, key));
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="px-1 text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">{display.name}</p>
      <SurfaceList>
        <Row className="flex-wrap">
          <p className={cn('flex-1 min-w-0', label)}>Top of the panel</p>
          <div className="w-44">
            <Select
              aria-label={`${display.name}: top of the panel`}
              value={top}
              onChange={e => onSave(switchModule(layout, 0, e.target.value as WallModuleKey))}
            >
              {choices(layout, top).map(key => (
                <option key={key} value={key}>
                  {MODULE_TITLES[key]}
                </option>
              ))}
            </Select>
          </div>
        </Row>
        <Row className="flex-wrap">
          <div className="flex-1 min-w-0">
            <p className={label}>Bottom of the panel</p>
            <p className={hint}>A quarter of its height</p>
          </div>
          <div className="w-44">
            <Select aria-label={`${display.name}: bottom of the panel`} value={bottom ?? NONE} onChange={e => setBottom(e.target.value)}>
              <option value={NONE}>Nothing</option>
              {choices(layout, bottom).map(key => (
                <option key={key} value={key}>
                  {MODULE_TITLES[key]}
                </option>
              ))}
            </Select>
          </div>
        </Row>
        <Row className="flex-wrap">
          <div className="flex-1 min-w-0">
            <p className={label}>Under today</p>
            <p className={hint}>Below today’s events</p>
          </div>
          <div className="w-44">
            <Select
              aria-label={`${display.name}: under today`}
              value={day ?? NONE}
              onChange={e => onSave(setDayModule(layout, e.target.value === NONE ? null : (e.target.value as WallModuleKey)))}
            >
              <option value={NONE}>Nothing</option>
              {choices(layout, day).map(key => (
                <option key={key} value={key}>
                  {MODULE_TITLES[key]}
                </option>
              ))}
            </Select>
          </div>
        </Row>
        <Row className="flex-col items-stretch gap-2">
          <div>
            <p className={label}>Auto scroll</p>
            <p className={hint}>A list longer than its space moves by itself. Pause or play it on the wall too.</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={`${display.name}: auto scroll`}>
            {/* Due today under today shows every item at its natural height, so it has nothing to scroll. */}
            {shownModules(layout)
              .filter(key => !(key === 'due' && day === 'due'))
              .map(key => {
                const on = autoScrolls(layout, key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSave(setAutoScroll(layout, key, !on))}
                    className={cn(
                      'min-h-11 rounded-full px-4 text-sm font-semibold border transition-colors',
                      on
                        ? 'bg-accent-600 border-accent-600 text-white dark:bg-accent-500 dark:border-accent-500'
                        : 'border-brand-300 text-brand-700 dark:border-brand-600 dark:text-brand-200'
                    )}
                  >
                    {MODULE_TITLES[key]}
                  </button>
                );
              })}
          </div>
        </Row>
      </SurfaceList>
    </div>
  );
};
