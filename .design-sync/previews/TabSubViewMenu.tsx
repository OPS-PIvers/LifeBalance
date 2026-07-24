import React from 'react';
import { TabSubViewMenu, Tabs, TabsList, TabsTrigger } from 'lifebalance';

const MONEY_VIEWS = [
  { value: 'activity', label: 'Activity' },
  { value: 'planned', label: 'Planned' },
  { value: 'budget', label: 'Budget' },
];

const HABIT_VIEWS = [
  { value: 'today', label: 'Today' },
  { value: 'progress', label: 'Progress' },
  { value: 'rewards', label: 'Rewards' },
];

// The `relative` wrapper must HUG the tab bar: the menu positions itself at the
// wrapper's bottom edge (`top-full`) and slides horizontally to sit under the
// trigger whose `data-tabs-value` matches `anchorValue`. A wrapper padded out
// for visual room would push the menu that far down the page.
export const MoneyViews = () => {
  const anchorRef = React.useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} style={{ position: 'relative', width: 320 }}>
      <Tabs defaultValue="money">
        <TabsList>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="money">Money</TabsTrigger>
          <TabsTrigger value="habits">Habits</TabsTrigger>
        </TabsList>
      </Tabs>
      <TabSubViewMenu
        isOpen
        onClose={() => {}}
        options={MONEY_VIEWS}
        value="activity"
        onSelect={() => {}}
        name="Money view"
        anchorValue="money"
        anchorRef={anchorRef}
      />
    </div>
  );
};

export const WarmTone = () => {
  const anchorRef = React.useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} style={{ position: 'relative', width: 320 }}>
      <Tabs defaultValue="habits">
        <TabsList>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="money">Money</TabsTrigger>
          <TabsTrigger value="habits">Habits</TabsTrigger>
        </TabsList>
      </Tabs>
      <TabSubViewMenu
        isOpen
        onClose={() => {}}
        options={HABIT_VIEWS}
        value="rewards"
        onSelect={() => {}}
        name="Habits view"
        anchorValue="habits"
        anchorRef={anchorRef}
        tone="warm"
      />
    </div>
  );
};
