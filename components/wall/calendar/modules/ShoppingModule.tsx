import React, { useMemo } from 'react';
import { sortShopping } from '@/utils/wall/wallLists';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallToaster } from '@/components/wall/wallToast';

/** The panel's Shopping module: what's still to buy, in two columns. Tap to check off. */
const ShoppingModule: React.FC = () => {
  const { shoppingList, actions } = useWallData();
  const toaster = useWallToaster();
  const open = useMemo(() => sortShopping(shoppingList.filter(i => !i.isPurchased)), [shoppingList]);
  if (open.length === 0) return <div className="empty">List is empty</div>;
  return (
    <div className="cols2">
      {open.map(item => (
        <div className="row" key={item.id}>
          <button
            type="button"
            className="in"
            onClick={() =>
              toaster.run(actions.toggleShoppingItemPurchased(item.id), `Checked off ${item.name}`, () =>
                actions.toggleShoppingItemPurchased(item.id)
              )
            }
          >
            <span className="bx" />
            <span className="tx">{item.name}</span>
            {item.quantity && <span className="q">{item.quantity}</span>}
          </button>
        </div>
      ))}
    </div>
  );
};

export default ShoppingModule;
