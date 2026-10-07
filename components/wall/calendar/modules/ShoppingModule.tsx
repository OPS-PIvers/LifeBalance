import React, { useMemo } from 'react';
import { sortShopping } from '@/utils/wall/wallLists';
import { useWallData } from '@/components/wall/data/wallData';
import WallSwipeRow from '@/components/wall/lists/WallSwipeRow';
import { useWallListActions } from '@/components/wall/lists/useWallListActions';
import WallAutoScroll from './WallAutoScroll';

/** The panel's Shopping module: what's still to buy. Tap to check off (a sideways swipe switches the module; delete on the Shopping screen); a long list turns like a wheel. */
const ShoppingModule: React.FC = () => {
  const { shoppingList } = useWallData();
  const act = useWallListActions();
  const open = useMemo(() => sortShopping(shoppingList.filter(i => !i.isPurchased)), [shoppingList]);
  if (open.length === 0) return <div className="empty">List is empty</div>;
  return (
    <WallAutoScroll>
      <div className="cols2">
        {open.map(item => (
          <WallSwipeRow
            key={item.id}
            label={item.name}
            done={false}
            onToggle={() => act.toggleShopping(item)}
            meta={item.quantity ? <span className="q">{item.quantity}</span> : undefined}
          />
        ))}
      </div>
    </WallAutoScroll>
  );
};

export default ShoppingModule;
