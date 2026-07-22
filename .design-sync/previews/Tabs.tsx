import { Tabs, TabsList, TabsTrigger, TabsContent } from 'lifebalance';

const panel: React.CSSProperties = { padding: '16px 4px', fontSize: 14, color: 'var(--color-brand-600, #6b6558)' };

export const PlanTabs = () => (
  <div style={{ width: 360 }}>
    <Tabs defaultValue="todos">
      <TabsList>
        <TabsTrigger value="todos">To-dos</TabsTrigger>
        <TabsTrigger value="meals">Meals</TabsTrigger>
        <TabsTrigger value="shopping">Shopping</TabsTrigger>
      </TabsList>
      <TabsContent value="todos"><div style={panel}>3 tasks due today · 1 overdue</div></TabsContent>
      <TabsContent value="meals"><div style={panel}>Dinner planned for 5 of 7 nights this week.</div></TabsContent>
      <TabsContent value="shopping"><div style={panel}>12 items on the list · 4 already in the cart.</div></TabsContent>
    </Tabs>
  </div>
);

export const EqualWidth = () => (
  <div style={{ width: 300 }}>
    <Tabs defaultValue="spending">
      <TabsList equalWidth>
        <TabsTrigger value="spending">Spending</TabsTrigger>
        <TabsTrigger value="income">Income</TabsTrigger>
      </TabsList>
      <TabsContent value="spending"><div style={panel}>$1,240 spent this period.</div></TabsContent>
      <TabsContent value="income"><div style={panel}>$3,100 expected next paycheck.</div></TabsContent>
    </Tabs>
  </div>
);
