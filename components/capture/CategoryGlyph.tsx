import React from 'react';
import {
  Utensils, ShoppingCart, Car, ShoppingBag, Film, Heart, Zap, MoreHorizontal,
  Coffee, Book, Music, Dumbbell, Plane, Home, Smartphone, Tv,
  Gift, Wrench, CreditCard, Wifi, Droplet, Wind, Sun, Moon,
  Briefcase, GraduationCap, PawPrint, Leaf, Truck, Bus, Tag,
  LayoutGrid, type LucideIcon,
} from 'lucide-react-native';

// Single source of truth for category icon-name rendering. Consumed by the
// category picker and the Manage Categories screen so the map is not duplicated.
export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  utensils: Utensils, 'shopping-cart': ShoppingCart, car: Car, 'shopping-bag': ShoppingBag,
  film: Film, heart: Heart, zap: Zap, 'more-horizontal': MoreHorizontal,
  coffee: Coffee, book: Book, music: Music, dumbbell: Dumbbell,
  plane: Plane, home: Home, smartphone: Smartphone, tv: Tv,
  gift: Gift, tool: Wrench, wrench: Wrench, 'credit-card': CreditCard, wifi: Wifi,
  droplet: Droplet, wind: Wind, sun: Sun, moon: Moon,
  briefcase: Briefcase, 'graduation-cap': GraduationCap, 'paw-print': PawPrint, leaf: Leaf,
  truck: Truck, bus: Bus, tag: Tag,
};

// The 30-icon authoring set offered by S-16 Manage Categories (FR-16.4, unchanged
// from v1). Every name resolves through CATEGORY_ICON_MAP above, so the picker and
// the renderer share one catalogue instead of a second icon list.
export const CATEGORY_ICON_PICKER: string[] = [
  'utensils', 'shopping-cart', 'car', 'shopping-bag', 'film', 'heart', 'zap', 'more-horizontal',
  'coffee', 'book', 'music', 'dumbbell', 'plane', 'home', 'smartphone', 'tv',
  'gift', 'tool', 'credit-card', 'wifi', 'droplet', 'wind', 'sun', 'moon',
  'briefcase', 'graduation-cap', 'paw-print', 'leaf', 'truck', 'bus',
];

export function CategoryGlyph({ iconName, size, color, strokeWidth = 2 }: { iconName?: string; size: number; color: string; strokeWidth?: number }) {
  const Icon = iconName ? CATEGORY_ICON_MAP[iconName] : undefined;
  const Glyph = Icon ?? LayoutGrid;
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} />;
}
