import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';
import { describe, it, expect } from 'vitest';

describe('Tabs', () => {
  it('renders default value content', () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    );

    expect(screen.getByText('Content 1')).toBeInTheDocument();
    expect(screen.queryByText('Content 2')).not.toBeInTheDocument();
  });

  it('switches content on click', () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    );

    fireEvent.click(screen.getByText('Tab 2'));

    expect(screen.queryByText('Content 1')).not.toBeInTheDocument();
    expect(screen.getByText('Content 2')).toBeInTheDocument();
  });

  it('supports controlled mode', () => {
    const TestComponent = () => {
      const [val, setVal] = React.useState('tab1');
      return (
        <Tabs value={val} onValueChange={setVal}>
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Content 1</TabsContent>
          <TabsContent value="tab2">Content 2</TabsContent>
        </Tabs>
      );
    };

    render(<TestComponent />);

    expect(screen.getByText('Content 1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Tab 2'));

    expect(screen.getByText('Content 2')).toBeInTheDocument();
  });

  describe('aria linkage', () => {
    function renderTabs() {
      return render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Content 1</TabsContent>
          <TabsContent value="tab2">Content 2</TabsContent>
        </Tabs>
      );
    }

    it('trigger has aria-controls pointing to the active panel id', () => {
      renderTabs();
      const trigger = screen.getByRole('tab', { name: 'Tab 1' });
      const panel = screen.getByRole('tabpanel');

      expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
      expect(panel.id).not.toBe('');
    });

    it('panel has aria-labelledby pointing to its trigger id', () => {
      renderTabs();
      const trigger = screen.getByRole('tab', { name: 'Tab 1' });
      const panel = screen.getByRole('tabpanel');

      expect(panel.getAttribute('aria-labelledby')).toBe(trigger.id);
      expect(trigger.id).not.toBe('');
    });

    it('active trigger has tabIndex 0 and inactive trigger has tabIndex -1', () => {
      renderTabs();
      const trigger1 = screen.getByRole('tab', { name: 'Tab 1' });
      const trigger2 = screen.getByRole('tab', { name: 'Tab 2' });

      expect(trigger1).toHaveAttribute('tabindex', '0');
      expect(trigger2).toHaveAttribute('tabindex', '-1');
    });

    it('id pairs are stable and consistent between trigger and panel', () => {
      renderTabs();
      const trigger = screen.getByRole('tab', { name: 'Tab 1' });
      const panel = screen.getByRole('tabpanel');

      // The trigger's aria-controls should match the panel's id
      expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
      // The panel's aria-labelledby should match the trigger's id
      expect(panel.getAttribute('aria-labelledby')).toBe(trigger.id);
    });

    it('two independent Tabs instances use distinct id prefixes (no collisions)', () => {
      render(
        <>
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">A</TabsTrigger>
            </TabsList>
            <TabsContent value="a">Panel A</TabsContent>
          </Tabs>
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">A2</TabsTrigger>
            </TabsList>
            <TabsContent value="a">Panel A2</TabsContent>
          </Tabs>
        </>
      );

      const triggers = screen.getAllByRole('tab');
      const panels = screen.getAllByRole('tabpanel');
      const trigger1 = triggers[0]!;
      const trigger2 = triggers[1]!;
      const panel1 = panels[0]!;
      const panel2 = panels[1]!;

      expect(trigger1.id).not.toBe(trigger2.id);
      expect(panel1.id).not.toBe(panel2.id);
    });
  });

  describe('sub-view menu ARIA pass-through', () => {
    it('forwards aria-haspopup/aria-expanded to the trigger button and omits them by default', () => {
      render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2" aria-haspopup="menu" aria-expanded={false}>
              Tab 2
            </TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Content 1</TabsContent>
          <TabsContent value="tab2">Content 2</TabsContent>
        </Tabs>
      );

      const plain = screen.getByRole('tab', { name: 'Tab 1' });
      const menuTab = screen.getByRole('tab', { name: 'Tab 2' });
      expect(plain).not.toHaveAttribute('aria-haspopup');
      expect(plain).not.toHaveAttribute('aria-expanded');
      expect(menuTab).toHaveAttribute('aria-haspopup', 'menu');
      expect(menuTab).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('keyboard navigation', () => {
    function renderTabs() {
      return render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
            <TabsTrigger value="tab3">Tab 3</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Content 1</TabsContent>
          <TabsContent value="tab2">Content 2</TabsContent>
          <TabsContent value="tab3">Content 3</TabsContent>
        </Tabs>
      );
    }

    it('ArrowRight moves selection to the next tab', () => {
      renderTabs();
      const tabList = screen.getByRole('tablist');

      fireEvent.keyDown(tabList, { key: 'ArrowRight' });

      expect(screen.getByRole('tab', { name: 'Tab 2' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Content 2')).toBeInTheDocument();
    });

    it('ArrowLeft moves selection to the previous tab', () => {
      renderTabs();
      const tabList = screen.getByRole('tablist');

      // First go to tab2
      fireEvent.keyDown(tabList, { key: 'ArrowRight' });
      // Then go back
      fireEvent.keyDown(tabList, { key: 'ArrowLeft' });

      expect(screen.getByRole('tab', { name: 'Tab 1' })).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowRight wraps around from last to first tab', () => {
      renderTabs();
      const tabList = screen.getByRole('tablist');

      fireEvent.keyDown(tabList, { key: 'ArrowRight' }); // -> tab2
      fireEvent.keyDown(tabList, { key: 'ArrowRight' }); // -> tab3
      fireEvent.keyDown(tabList, { key: 'ArrowRight' }); // -> tab1 (wrap)

      expect(screen.getByRole('tab', { name: 'Tab 1' })).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowLeft wraps around from first to last tab', () => {
      renderTabs();
      const tabList = screen.getByRole('tablist');

      fireEvent.keyDown(tabList, { key: 'ArrowLeft' }); // -> tab3 (wrap)

      expect(screen.getByRole('tab', { name: 'Tab 3' })).toHaveAttribute('aria-selected', 'true');
    });

    it('Home key moves to the first tab', () => {
      renderTabs();
      const tabList = screen.getByRole('tablist');

      fireEvent.keyDown(tabList, { key: 'ArrowRight' }); // -> tab2
      fireEvent.keyDown(tabList, { key: 'Home' });

      expect(screen.getByRole('tab', { name: 'Tab 1' })).toHaveAttribute('aria-selected', 'true');
    });

    it('End key moves to the last tab', () => {
      renderTabs();
      const tabList = screen.getByRole('tablist');

      fireEvent.keyDown(tabList, { key: 'End' });

      expect(screen.getByRole('tab', { name: 'Tab 3' })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
