import React, { useMemo } from 'react';
import { groupShoppingByStore } from '@/utils/wall/wallLists';
import { useWallData } from '@/components/wall/data/wallData';
import WallSwipeRow from './WallSwipeRow';
import { useWallListActions } from './useWallListActions';

/**
 * Shopping (plan §3): one list flowing in two columns, grouped by store.
 * Checking an item moves it to "In the cart" under its store.
 */
const WallShopping: React.FC = () => {
  const { shoppingList, stores } = useWallData();
  const act = useWallListActions();
  const groups = useMemo(() => groupShoppingByStore(shoppingList, stores), [shoppingList, stores]);

  if (groups.length === 0) {
    return (
      <div className="lists">
        <div className="empty">List is empty</div>
      </div>
    );
  }
  const row = (item: (typeof shoppingList)[number]) => (
    <WallSwipeRow
      key={item.id}
      label={item.name}
      done={item.isPurchased}
      onToggle={() => act.toggleShopping(item)}
      onDelete={() => act.deleteShopping(item)}
      meta={item.quantity ? <span className="q">{item.quantity}</span> : undefined}
    />
  );
  return (
    <div className="lists">
      <div className="flow2">
        {groups.map(g => (
          <section className="sec" key={g.store} aria-label={g.store}>
            <h3>
              {g.store}
              <span>{g.open.length} left</span>
            </h3>
            {g.open.map(row)}
            {g.cart.length > 0 && (
              <div className="cart">
                <div className="lab">In the cart</div>
                {g.cart.map(row)}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
};

export default WallShopping;
