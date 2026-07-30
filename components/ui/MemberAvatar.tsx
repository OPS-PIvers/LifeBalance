import React, { useState } from 'react';
import { cn } from '@/utils/cn';

/**
 * One member's avatar, everywhere in the app.
 *
 * Paper cut (owner): "the member badges [were] different colors than the
 * profile chip... it should be the same Google profile image." Before this,
 * every surface that drew a member badge (Scoreboard, Points drawer, the
 * to-do assignee chip, the Action Queue chip, the habit attribution picker,
 * the flame-ring avatars) hand-rolled its own photo-or-initial circle, so the
 * SAME person rendered with a different look depending on which screen you
 * were on. This is the one place that decides "photo, or initial-on-color".
 *
 * - Renders `photoURL` as an `<img>` when present; falls back to a solid
 *   circle in `color` with the name's initial when absent OR when the image
 *   fails to load (tracked via `onError`, so a 404'd photo degrades instead
 *   of leaving a broken-image glyph).
 * - `color` is the caller's job to resolve — pass
 *   `memberColorFor(colorMap, uid)` from `utils/memberColors.ts` so one
 *   member is one color on every surface that shares a `MemberColorMap`
 *   built from the same roster.
 * - `size` is a plain pixel number so every call site's existing footprint
 *   (30px scoreboard rows, 22px picker rows, 16px chips, ~15px flame-ring
 *   avatars) is reproducible exactly, rather than picking from a fixed set.
 * - Dependency-light on purpose: `TopToolbar` (an always-mounted, boot-path
 *   component) is a consumer, so this must never pull in Drawer/framer-motion
 *   or anything else that would widen the boot bundle.
 *
 * Accessibility: pass `alt` for a MEANINGFUL avatar (the only visual label
 * for who this is, e.g. an assignee chip) — both the photo and the fallback
 * circle then expose that as their accessible name. Omit `alt` for a
 * DECORATIVE avatar (the name is already rendered as adjacent text, e.g. the
 * scoreboard rows) — both states render `aria-hidden`.
 */
export interface MemberAvatarProps {
  /** Display name — source of the fallback initial. */
  name: string;
  /** Google/Firebase profile photo, if any. */
  photoURL?: string | null;
  /** Fallback circle background — resolve via `memberColorFor` so this
   *  matches the member's color on every other surface. */
  color: string;
  /** Diameter in px. */
  size: number;
  /** Overrides the derived initial in the fallback circle (e.g. a kid
   *  profile's chosen `avatarEmoji`). Ignored while a photo is showing. */
  fallbackGlyph?: string;
  /** Accessible name; omit for a decorative avatar (see module doc). */
  alt?: string;
  /** Native tooltip, shown for either state (photo or fallback). */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-testid'?: string;
}

const MemberAvatar: React.FC<MemberAvatarProps> = ({
  name,
  photoURL,
  color,
  size,
  fallbackGlyph,
  alt,
  title,
  className,
  style,
  'data-testid': dataTestId,
}) => {
  // Resets whenever the photo URL itself changes (a different member, or the
  // same member's photo updating) rather than sticking forever once a load
  // has ever failed for this DOM node.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = fallbackGlyph ?? (name.trim().charAt(0).toUpperCase() || '?');
  const showPhoto = !!photoURL && photoURL !== failedUrl;

  const sizeStyle: React.CSSProperties = { width: size, height: size, ...style };

  if (showPhoto) {
    return (
      <img
        src={photoURL}
        alt={alt ?? ''}
        aria-hidden={alt ? undefined : true}
        title={title}
        onError={() => setFailedUrl(photoURL)}
        data-testid={dataTestId}
        className={cn('rounded-full object-cover shrink-0', className)}
        style={sizeStyle}
      />
    );
  }

  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt}
      aria-hidden={alt ? undefined : true}
      title={title}
      data-testid={dataTestId}
      className={cn(
        'flex items-center justify-center rounded-full font-bold text-white shrink-0',
        className
      )}
      style={{ ...sizeStyle, backgroundColor: color, fontSize: Math.round(size * 0.44) }}
    >
      {initial}
    </span>
  );
};

export default MemberAvatar;
