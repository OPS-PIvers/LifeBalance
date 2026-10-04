import React, { useMemo } from 'react';
import { sortShopping } from '@/utils/wall/wallLists';
import { useWallData } from '@/components/wall/data/wallData';
import WallSwipeRow from '@/components/wall/lists/WallSwipeRow';
import { useWallListActions } from '@/components/wall/lists/useWallListActions';

/** The panel's Shopping module: what's still to buy, in two columns. Tap to check off, swipe to delete. */
const ShoppingModule: React.FC = () => {
  const { shoppingList } = useWallData();
  const act = useWallListActions();
  const open = useMemo(() => sortShopping(shoppingList.filter(i => !i.isPurchased)), [shoppingList]);
  if (open.length === 0) return <div className="empty">List is empty</div>;
  return (
    <div className="cols2">
      {open.map(item => (
        <WallSwipeRow
          key={item.id}
          label={item.name}
          done={false}
          onToggle={() => act.toggleShopping(item)}
          onDelete={() => act.deleteShopping(item)}
          meta={item.quantity ? <span className="q">{item.quantity}</span> : undefined}
        />
      ))}
    </div>
  );
};

export default ShoppingModule;
