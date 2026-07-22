// Barrel entry for design-sync — re-exports the 32 scoped components/ui
// primitives as named exports so the converter bundles exactly this set into
// window.LifeBalance. Build input only (see .design-sync/config.json).

// Named exports
export { Badge } from '@/components/ui/Badge';
export { Button } from '@/components/ui/Button';
export { CollapsibleSection } from '@/components/ui/CollapsibleSection';
export { CompactSelect } from '@/components/ui/CompactSelect';
export { ConfirmDialog } from '@/components/ui/ConfirmDialog';
export { Drawer } from '@/components/ui/Drawer';
export { ListRow } from '@/components/ui/ListRow';
export { Menu } from '@/components/ui/Menu';
export { Modal } from '@/components/ui/Modal';
export { Popover } from '@/components/ui/Popover';
export { QuickAddBar } from '@/components/ui/QuickAddBar';
export { Section } from '@/components/ui/Section';
export { SegmentedControl } from '@/components/ui/SegmentedControl';
export { ShowMoreRow } from '@/components/ui/ShowMoreRow';
export { Skeleton } from '@/components/ui/Skeleton';
export { SubViewHint } from '@/components/ui/SubViewHint';
export { SwipeActionRow } from '@/components/ui/SwipeActionRow';
export { Switch } from '@/components/ui/Switch';
export { TabSubViewMenu } from '@/components/ui/TabSubViewMenu';
// Tabs is a compound — TabsList/TabsTrigger/TabsContent bundle onto the global
// for composition but are not carded (absent from componentSrcMap).
export { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';

// Default exports normalized to named
export { default as Card } from '@/components/ui/Card';
export { default as CountBadge } from '@/components/ui/CountBadge';
export { default as EmptyState } from '@/components/ui/EmptyState';
export { default as Eyebrow } from '@/components/ui/Eyebrow';
export { default as Input } from '@/components/ui/Input';
export { default as PageHeader } from '@/components/ui/PageHeader';
export { default as ProgressBar } from '@/components/ui/ProgressBar';
export { default as ProgressRing } from '@/components/ui/ProgressRing';
export { default as SectionActionLink } from '@/components/ui/SectionActionLink';
export { default as SectionHeading } from '@/components/ui/SectionHeading';
export { default as Select } from '@/components/ui/Select';
export { default as Textarea } from '@/components/ui/Textarea';
