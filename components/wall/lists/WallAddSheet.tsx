import React, { useMemo, useState } from 'react';
import { Mic, Plus } from 'lucide-react';
import { NO_STORE, catalogSuggestions, dueDateFor, newShoppingItem, type DueChoice } from '@/utils/wall/wallLists';
import { addDaysTo, longDateText } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallListActions } from './useWallListActions';

export type AddKind = 'shopping' | 'todo';

interface WallAddSheetProps {
  kind: AddKind;
  today: string;
  people: WallPeople;
  onDone: () => void;
  /** A to-do's starting due date (Day view adds for the day it shows). Defaults to today. */
  dueDate?: string;
  /** "Speak instead": closes the sheet and starts listening. Absent when voice is off. */
  onVoice?: () => void;
}

const DUE: { key: DueChoice; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'This week' },
];

/**
 * The entry sheet (plan §3 "Add"): anchored to the top because the iPad
 * keyboard covers the bottom ~40% in landscape. Stays open for the next item
 * until Done. Shopping offers grocery-catalog suggestions and store chips;
 * to-dos offer For and Due chips.
 */
const WallAddSheet: React.FC<WallAddSheetProps> = ({ kind, today, people, onDone, dueDate, onVoice }) => {
  const { groceryCatalog, stores } = useWallData();
  const act = useWallListActions();
  const [text, setText] = useState('');
  // null = the catalog's usual store (or none).
  const [store, setStore] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('family');
  const [due, setDue] = useState<DueChoice | 'date'>(() =>
    !dueDate || dueDate === today ? 'today' : dueDate === addDaysTo(today, 1) ? 'tomorrow' : 'date'
  );
  const [date, setDate] = useState(dueDate ?? today);
  const suggestions = useMemo(
    () => (kind === 'shopping' ? catalogSuggestions(groceryCatalog, text) : []),
    [kind, groceryCatalog, text]
  );
  const storeNames = useMemo(() => stores.map(s => s.name), [stores]);
  const shopping = kind === 'shopping';

  const addShopping = (name: string) => {
    if (!name.trim()) return;
    act.addShopping([newShoppingItem(name, groceryCatalog, store)]);
    setText('');
  };
  const addTodo = () => {
    const t = text.trim();
    if (!t) return;
    act.addTodo({
      text: t,
      completeByDate: due === 'date' ? date : dueDateFor(due, today),
      isCompleted: false,
      source: 'manual',
      ...(assignee === 'family' ? {} : { assignedTo: assignee }),
    });
    setText('');
  };
  const submit = () => (shopping ? addShopping(text) : addTodo());

  return (
    <>
      <div className="scrim" onClick={onDone} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-label={shopping ? 'Add to Shopping' : 'Add a to-do'}>
        <div className="top2">
          <b>{shopping ? 'Add to Shopping' : 'Add a to-do'}</b>
          <button type="button" className="btn" onClick={onDone}>
            Done
          </button>
        </div>
        <form
          className="inp"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            // The sheet exists to type into: focusing raises the iPad keyboard.
            autoFocus
            aria-label={shopping ? 'Item' : 'To-do'}
            placeholder={shopping ? 'Milk, eggs…' : 'What needs doing?'}
            value={text}
            enterKeyHint="done"
            autoComplete="off"
            onChange={e => setText(e.target.value)}
          />
          <button type="submit" className="btn pri" disabled={!text.trim()}>
            <Plus className="wi" size="1em" aria-hidden="true" />
            Add
          </button>
          {onVoice && (
            <button type="button" className="micb" aria-label="Speak instead" onClick={onVoice}>
              <Mic className="wi" size="1em" aria-hidden="true" />
            </button>
          )}
        </form>
        {suggestions.length > 0 && (
          <div className="sugs" role="group" aria-label="Suggestions">
            {suggestions.map(s => (
              <button key={s.id} type="button" className="sug" onClick={() => addShopping(s.name)}>
                {s.name}
                {(s.defaultStore || s.defaultQuantity) && (
                  <small>{[s.defaultStore, s.defaultQuantity && `usually ${s.defaultQuantity}`].filter(Boolean).join(' · ')}</small>
                )}
              </button>
            ))}
          </div>
        )}
        {shopping ? (
          <div className="opts" role="group" aria-label="Store">
            <span className="lab">Store</span>
            {[...storeNames, NO_STORE].map(name => (
              <button key={name} type="button" className="pchip" aria-pressed={store === name} onClick={() => setStore(store === name ? null : name)}>
                {name}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="opts" role="group" aria-label="For">
              <span className="lab">For</span>
              {[{ uid: 'family', name: 'Family' }, ...people.members].map(m => (
                <button key={m.uid} type="button" className="pchip" aria-pressed={assignee === m.uid} onClick={() => setAssignee(m.uid)}>
                  {m.uid !== 'family' && <span className="dot" style={{ background: people.color(m.uid) }} />}
                  {m.name}
                </button>
              ))}
            </div>
            <div className="opts" role="group" aria-label="Due">
              <span className="lab">Due</span>
              {DUE.map(d => (
                <button key={d.key} type="button" className="pchip" aria-pressed={due === d.key} onClick={() => setDue(d.key)}>
                  {d.label}
                </button>
              ))}
              <label className={due === 'date' ? 'pchip on' : 'pchip'}>
                <span>{due === 'date' ? longDateText(date) : 'Pick a date'}</span>
                <input
                  type="date"
                  aria-label="Due date"
                  min={today}
                  value={date}
                  onChange={e => {
                    if (!e.target.value) return;
                    setDate(e.target.value);
                    setDue('date');
                  }}
                />
              </label>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default WallAddSheet;
