import React from 'react';
import {
  Sprout, Camera, Repeat, Flame, Diamond, Upload, Tag, Rocket, BarChart2,
  Target, Eye, Crown, Moon, Leaf, Zap, Palette, Map, Trophy, PiggyBank,
  ShoppingCart, Banknote, Recycle, Award, StickyNote, TrendingUp, Brain,
  LayoutGrid, type LucideIcon,
} from 'lucide-react-native';

// Maps the badge icon names returned by getBadgeProgress to lucide components so
// achievements render as vector glyphs. Badge metadata names are not lucide names
// one-for-one (Seedling/Export/Launch/etc), so this is the single translation
// table. Shared by the Profile badge grid and the SH-05a BadgeDetailModal.
export const BADGE_ICON_MAP: Record<string, LucideIcon> = {
  Seedling: Sprout,
  Camera,
  Repeat,
  Flame,
  Diamond,
  Export: Upload,
  Tag,
  Launch: Rocket,
  Chart: BarChart2,
  Goal: Target,
  View: Eye,
  Crown,
  Moon,
  Leaf,
  Lightning: Zap,
  Palette,
  Map,
  Trophy,
  Pig: PiggyBank,
  Shopping: ShoppingCart,
  Money: Banknote,
  Recycle,
  Badge: Award,
  Note: StickyNote,
  Trend: TrendingUp,
  Mindful: Brain,
};

export function BadgeGlyph({
  name,
  size,
  color,
  strokeWidth = 2,
}: {
  name?: string;
  size: number;
  color: string;
  strokeWidth?: number;
}) {
  const Icon = name ? BADGE_ICON_MAP[name] : undefined;
  const Glyph = Icon ?? LayoutGrid;
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} />;
}
