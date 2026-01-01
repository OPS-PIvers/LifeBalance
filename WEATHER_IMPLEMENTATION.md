# Weather Bonus Feature Implementation Guide

This document outlines the plan to implement weather-based point bonuses for habits in LifeBalance.

## Overview

Weather-sensitive habits will receive a **+1.0x multiplier bonus** on "nice weather" days. The feature will use the OpenWeather API to fetch real-time weather data based on the household's location.

## Prerequisites

### API Keys Required

1. **OpenWeather API Key**
   - Sign up at: https://openweathermap.org/api
   - Free tier allows 1,000 calls/day (sufficient for this use case)
   - Store in GitHub Secrets as: `OPENWEATHER_API_KEY`

2. **Gemini API Key** (already configured)
   - Available in GitHub Secrets as: `VITE_GEMINI_API_KEY`
   - May be used for AI-powered weather interpretation (optional)

### GitHub Secrets Configuration

Add the following secret to your GitHub repository:
```
Settings → Secrets and variables → Actions → New repository secret
Name: OPENWEATHER_API_KEY
Value: <your_openweather_api_key>
```

### Environment Variables

Update `.env.local.example` to include:
```bash
# OpenWeather API (for weather-sensitive habits)
VITE_OPENWEATHER_API_KEY=your_openweather_api_key
```

Update `.env.local` with your actual key:
```bash
VITE_OPENWEATHER_API_KEY=your_actual_openweather_api_key
```

## Implementation Steps

### 1. Create Weather Service (`services/weatherService.ts`)

```typescript
import { Household } from '@/types/schema';

export interface WeatherData {
  temperature: number; // Celsius
  condition: string; // e.g., "Clear", "Clouds", "Rain"
  description: string; // e.g., "clear sky", "few clouds"
  humidity: number; // Percentage
  windSpeed: number; // m/s
  timestamp: number; // Unix timestamp
  isNiceDay: boolean; // Calculated result
}

/**
 * Fetch current weather data from OpenWeather API
 * @param lat - Latitude
 * @param lon - Longitude
 * @returns Weather data or null if error
 */
export async function fetchWeather(
  lat: number,
  lon: number
): Promise<WeatherData | null> {
  const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY;

  if (!apiKey) {
    console.warn('OpenWeather API key not configured');
    return null;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      temperature: data.main.temp,
      condition: data.weather[0].main,
      description: data.weather[0].description,
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      timestamp: data.dt,
      isNiceDay: calculateIsNiceDay(data),
    };
  } catch (error) {
    console.error('Failed to fetch weather:', error);
    return null;
  }
}

/**
 * Determine if current weather qualifies as "nice day"
 * Criteria:
 * - Temperature: 15-28°C (59-82°F)
 * - Conditions: Clear or few clouds
 * - No precipitation (rain, snow, etc.)
 * - Wind speed < 10 m/s (< 22 mph)
 */
function calculateIsNiceDay(data: any): boolean {
  const temp = data.main.temp;
  const condition = data.weather[0].main.toLowerCase();
  const windSpeed = data.wind.speed;

  // Temperature range
  const goodTemp = temp >= 15 && temp <= 28;

  // Weather conditions
  const goodConditions = [
    'clear',
    'clouds',
  ].includes(condition);

  // Check description for heavy clouds
  const description = data.weather[0].description.toLowerCase();
  const notHeavyClouds = !description.includes('overcast');

  // Wind not too strong
  const calmWind = windSpeed < 10;

  return goodTemp && goodConditions && notHeavyClouds && calmWind;
}

/**
 * Get cached weather or fetch new data
 * Caches weather for 30 minutes to avoid excessive API calls
 */
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
let weatherCache: { data: WeatherData; timestamp: number } | null = null;

export async function getCachedWeather(
  household: Household
): Promise<WeatherData | null> {
  // Check if household has location configured
  if (!household.location) {
    console.warn('Household location not configured');
    return null;
  }

  const now = Date.now();

  // Return cached data if still valid
  if (weatherCache && (now - weatherCache.timestamp) < CACHE_DURATION) {
    return weatherCache.data;
  }

  // Fetch fresh data
  const freshData = await fetchWeather(
    household.location.lat,
    household.location.lon
  );

  if (freshData) {
    weatherCache = {
      data: freshData,
      timestamp: now,
    };
  }

  return freshData;
}
```

### 2. Update Habit Logic (`utils/habitLogic.ts`)

```typescript
import { WeatherData } from '@/services/weatherService';

/**
 * Get the point multiplier based on streak, habit type, and weather
 * @param streak - Current streak count
 * @param isPositive - Whether this is a positive habit
 * @param weatherSensitive - Whether this habit is affected by weather
 * @param weatherData - Current weather data (optional)
 * @returns The multiplier to apply to base points
 */
export const getMultiplier = (
  streak: number,
  isPositive: boolean,
  weatherSensitive: boolean = false,
  weatherData: WeatherData | null = null
): number => {
  let multiplier = 1.0;

  // Streak bonuses (positive habits only)
  if (isPositive) {
    if (streak >= 7) multiplier = 2.0;
    else if (streak >= 3) multiplier = 1.5;
  }

  // Weather bonus (positive habits only)
  if (isPositive && weatherSensitive && weatherData?.isNiceDay) {
    multiplier += 1.0;
  }

  return multiplier;
};
```

Update all calls to `getMultiplier()` to pass weather data:
- In `processToggleHabit()`: Add `weatherData` parameter and pass to `getMultiplier()`
- In `calculateResetPoints()`: Add `weatherData` parameter and pass to `getMultiplier()`

### 3. Update Firebase Household Context (`contexts/FirebaseHouseholdContext.tsx`)

Add weather state and fetching:

```typescript
import { getCachedWeather, WeatherData } from '@/services/weatherService';

// Add to context state
const [weatherData, setWeatherData] = useState<WeatherData | null>(null);

// Add effect to fetch weather periodically
useEffect(() => {
  if (!household) return;

  const fetchWeatherData = async () => {
    const data = await getCachedWeather(household);
    setWeatherData(data);
  };

  // Fetch immediately
  fetchWeatherData();

  // Refresh every 30 minutes
  const interval = setInterval(fetchWeatherData, 30 * 60 * 1000);

  return () => clearInterval(interval);
}, [household]);

// Pass weatherData to getMultiplier calls in toggleHabit and resetHabit
```

### 4. Update UI Components

#### HabitCard.tsx

Re-add the weather badge (removed in this commit):

```typescript
import { CloudSun } from 'lucide-react';

// In component:
const { toggleHabit, deleteHabit, resetHabit, activeChallenge, weatherData } = useHousehold();

// Update multiplier calculation
const weatherBonus = habit.weatherSensitive && weatherData?.isNiceDay;
const totalMultiplier = streakMultiplier + (weatherBonus ? 1.0 : 0);

// Add badge back to render
{/* Weather Bonus (Positive Only) */}
{isPositive && habit.weatherSensitive && (
  <span className={cn(
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold",
    weatherData?.isNiceDay ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-400"
  )}>
    <CloudSun size={10} />
    {weatherData?.isNiceDay ? 'Nice Day!' : 'Weather'}
  </span>
)}
```

#### Dashboard.tsx (Optional)

Add a weather widget showing current conditions:

```typescript
import { getCachedWeather } from '@/services/weatherService';

// Display weather card
{weatherData && (
  <div className="bg-white rounded-card p-4 shadow-soft">
    <h3 className="font-bold text-sm mb-2">Current Weather</h3>
    <div className="flex items-center gap-2">
      <CloudSun size={24} className={weatherData.isNiceDay ? 'text-sky-500' : 'text-gray-400'} />
      <div>
        <p className="text-lg font-bold">{Math.round(weatherData.temperature)}°C</p>
        <p className="text-xs text-gray-500">{weatherData.description}</p>
      </div>
    </div>
    {weatherData.isNiceDay && (
      <p className="text-xs text-emerald-600 mt-2">
        Perfect day for weather-sensitive habits! (+1.0x bonus)
      </p>
    )}
  </div>
)}
```

### 5. Settings Page - Location Configuration

Add location input to Settings page ([pages/Settings.tsx](pages/Settings.tsx)):

```typescript
// Add location editing
const [editingLocation, setEditingLocation] = useState(false);
const [lat, setLat] = useState(household?.location?.lat?.toString() || '');
const [lon, setLon] = useState(household?.location?.lon?.toString() || '');

const handleSaveLocation = async () => {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  if (isNaN(latitude) || isNaN(longitude)) {
    toast.error('Invalid coordinates');
    return;
  }

  await updateHousehold({
    location: { lat: latitude, lon: longitude },
  });

  setEditingLocation(false);
  toast.success('Location updated');
};

// UI
<div className="bg-white rounded-card p-4 shadow-soft">
  <h3 className="font-bold text-sm mb-2">Weather Location</h3>
  <p className="text-xs text-gray-500 mb-3">
    Used for weather-sensitive habit bonuses
  </p>

  {editingLocation ? (
    <div className="space-y-2">
      <input
        type="number"
        step="0.0001"
        placeholder="Latitude"
        value={lat}
        onChange={(e) => setLat(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg"
      />
      <input
        type="number"
        step="0.0001"
        placeholder="Longitude"
        value={lon}
        onChange={(e) => setLon(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg"
      />
      <div className="flex gap-2">
        <button onClick={handleSaveLocation} className="btn-primary">Save</button>
        <button onClick={() => setEditingLocation(false)} className="btn-secondary">Cancel</button>
      </div>
    </div>
  ) : (
    <div>
      <p className="text-sm">
        {household?.location
          ? `${household.location.lat.toFixed(4)}, ${household.location.lon.toFixed(4)}`
          : 'Not set'}
      </p>
      <button onClick={() => setEditingLocation(true)} className="text-xs text-brand-500 mt-1">
        {household?.location ? 'Edit' : 'Set Location'}
      </button>
    </div>
  )}

  <p className="text-xs text-gray-400 mt-2">
    💡 Tip: Use Google Maps to find coordinates - right-click on your location
  </p>
</div>
```

### 6. Update CLAUDE.md Documentation

Update the habit tracking section to reflect weather bonuses:

```markdown
**Multipliers:**
- 3-6 days streak: 1.5x points
- 7+ days streak: 2.0x points
- Weather-sensitive habits: +1.0x on nice days (15-28°C, clear/light clouds, calm wind)
```

## Testing

1. **Without API Key**: Verify app works gracefully when `VITE_OPENWEATHER_API_KEY` is not set
2. **With API Key**: Test weather fetching and caching
3. **Location Not Set**: Verify weather bonuses are skipped if household has no location
4. **Nice Day Logic**: Test various weather conditions to ensure `isNiceDay` calculation is accurate
5. **UI Updates**: Verify weather badges show correctly on habit cards
6. **Performance**: Confirm weather is cached and not fetched on every render

## Deployment with GitHub Actions

If using GitHub Actions for deployment, add the OpenWeather API key to your workflow:

```yaml
# .github/workflows/deploy.yml
env:
  VITE_OPENWEATHER_API_KEY: ${{ secrets.OPENWEATHER_API_KEY }}
```

This will make the environment variable available during the build process.

## Future Enhancements

1. **AI-Powered Weather Interpretation**: Use Gemini API to provide natural language weather summaries
2. **Weather Forecasts**: Show upcoming weather to help users plan habits
3. **Historical Weather Data**: Correlate habit completion with past weather conditions
4. **Customizable "Nice Day" Criteria**: Let users define their own ideal weather parameters
5. **Location Auto-Detection**: Use browser geolocation API to automatically set household location
6. **Multiple Locations**: Support different locations for different household members

## Rollback

If you need to remove weather bonuses again:

1. Remove weather service imports from `habitLogic.ts`
2. Update `getMultiplier()` to remove `weatherSensitive` and `weatherData` parameters
3. Remove weather badge from `HabitCard.tsx`
4. Remove weather fetching from `FirebaseHouseholdContext.tsx`

---

**Status**: Not yet implemented (weather bonuses temporarily removed)

**Implementation Effort**: ~2-3 hours

**Dependencies**: OpenWeather API account (free tier)
