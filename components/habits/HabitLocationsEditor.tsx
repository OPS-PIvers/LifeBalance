import React, { useState } from 'react';
import { MapPin, Trash2, LocateFixed } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { HabitLocationTrigger, DEFAULT_LOCATION_RADIUS_METERS } from '@/types/schema';
import { generateId } from '@/utils/id';

/**
 * Habit Automations (PRD #1065) — the geolocation half of a habit's
 * Automations section. "Use my location" takes ONE `navigator.geolocation`
 * snapshot (no maps SDK, no address search, no geocoding), then the member
 * names it and picks a radius before it's added to the habit's saved
 * locations list. Firing itself (the foreground confirm-prompt) lives in
 * `useHabitLocationPrompt` — this component only edits the saved list.
 */

const RADIUS_OPTIONS_METERS = [100, 150, 250, 500] as const;

interface PendingCapture {
  lat: number;
  lng: number;
}

interface HabitLocationsEditorProps {
  locations: HabitLocationTrigger[];
  onChange: (locations: HabitLocationTrigger[]) => void;
}

const HabitLocationsEditor: React.FC<HabitLocationsEditorProps> = ({ locations, onChange }) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [name, setName] = useState('');
  const [radiusMeters, setRadiusMeters] = useState<number>(DEFAULT_LOCATION_RADIUS_METERS);

  const handleUseMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error("This device doesn't support location.");
      return;
    }
    setIsCapturing(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsCapturing(false);
        setPending({ lat: position.coords.latitude, lng: position.coords.longitude });
        setName('');
        setRadiusMeters(DEFAULT_LOCATION_RADIUS_METERS);
      },
      (error) => {
        setIsCapturing(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied. Enable it in your browser/device settings to save a location.'
            : "Couldn't get your location. Try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const handleSaveCapture = () => {
    if (!pending) return;
    if (!name.trim()) {
      toast.error('Give this location a name');
      return;
    }
    const newLocation: HabitLocationTrigger = {
      id: generateId(),
      name: name.trim(),
      lat: pending.lat,
      lng: pending.lng,
      radiusMeters,
    };
    onChange([...locations, newLocation]);
    setPending(null);
    setName('');
    toast.success(`Saved "${newLocation.name}"`);
  };

  const handleCancelCapture = () => {
    setPending(null);
    setName('');
  };

  const handleRemove = (id: string) => {
    onChange(locations.filter((loc) => loc.id !== id));
  };

  return (
    <div className="space-y-3">
      {locations.length > 0 && (
        <ul className="space-y-2">
          {locations.map((loc) => (
            <li
              key={loc.id}
              className="flex items-center gap-2 rounded-card border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800/50 px-3 py-2"
            >
              <MapPin size={15} className="text-warm-500 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-brand-800 dark:text-brand-100 truncate">{loc.name}</p>
                <p className="text-xxs text-brand-400 dark:text-brand-450">Within {loc.radiusMeters} m</p>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(loc.id)}
                className="p-1.5 text-brand-400 dark:text-brand-450 hover:text-money-neg dark:hover:text-money-negDark rounded-full focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
                aria-label={`Remove saved location: ${loc.name}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending ? (
        <div className="space-y-3 rounded-card border border-warm-300 dark:border-warm-800/60 bg-warm-50 dark:bg-warm-900/20 p-3">
          <Input
            label="Location name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Target"
            autoFocus
          />
          <div>
            <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-1.5 block">
              Radius
            </label>
            <div className="grid grid-cols-4 gap-2">
              {RADIUS_OPTIONS_METERS.map((meters) => (
                <button
                  key={meters}
                  type="button"
                  onClick={() => setRadiusMeters(meters)}
                  className={`py-2 rounded-card border text-xs font-bold transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 ${
                    radiusMeters === meters
                      ? 'bg-warm-500 text-white border-warm-500'
                      : 'bg-white dark:bg-brand-700/50 border-brand-200 dark:border-brand-700 text-brand-600 dark:text-brand-450 hover:bg-brand-50 dark:hover:bg-brand-700'
                  }`}
                >
                  {meters} m
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={handleCancelCapture}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" className="flex-1" onClick={handleSaveCapture}>
              Save location
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="dashed"
          size="sm"
          className="w-full"
          leftIcon={<LocateFixed size={15} />}
          onClick={handleUseMyLocation}
          isLoading={isCapturing}
        >
          Use my location
        </Button>
      )}

      <p className="text-xxs text-brand-400 dark:text-brand-450">
        Opening the app near a saved spot asks before logging — it never logs automatically.
      </p>
    </div>
  );
};

export default HabitLocationsEditor;
