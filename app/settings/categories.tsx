import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  X, Check, Plus, LayoutGrid, Utensils, ShoppingCart, Car, ShoppingBag, Film, Heart, Zap, MoreHorizontal,
  Coffee, Book, Music, Dumbbell, Plane, Home, Smartphone, Tv,
  Gift, Wrench, CreditCard, Wifi, Droplet, Wind, Sun, Moon,
  Briefcase, GraduationCap, PawPrint, Leaf, Truck, Bus, Tag,
} from 'lucide-react-native';
import { Colors } from '../../constants/tokens';
import { useTheme } from '../../components/ui/ThemeProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { databaseService } from '../../services/DatabaseService';
import { PeachButton } from '../../components/ui/PeachButton';
import * as Haptics from 'expo-haptics';

const PRESET_COLORS = ['#FFD2C4', '#FFAB91', '#81C784', '#CF6679', '#FBBF24', '#60A5FA', '#A78BFA', '#34D399', '#F472B6', '#F97316', '#14B8A6', '#94A3B8'];

const PRESET_ICONS = [
  'utensils', 'shopping-cart', 'car', 'shopping-bag', 'film', 'heart', 'zap', 'more-horizontal',
  'coffee', 'book', 'music', 'dumbbell', 'plane', 'home', 'smartphone', 'tv',
  'gift', 'tool', 'credit-card', 'wifi', 'droplet', 'wind', 'sun', 'moon',
  'briefcase', 'graduation-cap', 'paw-print', 'leaf', 'truck', 'bus'
];

const ICON_MAP: Record<string, any> = {
  'utensils': Utensils, 'shopping-cart': ShoppingCart, 'car': Car, 'shopping-bag': ShoppingBag,
  'film': Film, 'heart': Heart, 'zap': Zap, 'more-horizontal': MoreHorizontal,
  'coffee': Coffee, 'book': Book, 'music': Music, 'dumbbell': Dumbbell,
  'plane': Plane, 'home': Home, 'smartphone': Smartphone, 'tv': Tv,
  'gift': Gift, 'tool': Wrench, 'wrench': Wrench, 'credit-card': CreditCard, 'wifi': Wifi,
  'droplet': Droplet, 'wind': Wind, 'sun': Sun, 'moon': Moon,
  'briefcase': Briefcase, 'graduation-cap': GraduationCap, 'paw-print': PawPrint, 'leaf': Leaf,
  'truck': Truck, 'bus': Bus, 'tag': Tag,
};

const renderIcon = (iconName: string, size: number, color: string) => {
  const IconComp = ICON_MAP[iconName];
  if (IconComp) return <IconComp size={size} color={color} />;
  return <LayoutGrid size={size} color={color} />;
};

export default function ManageCategoriesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const ts = useThemeStyles();
  const [categories, setCategories] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newIcon, setNewIcon] = useState(PRESET_ICONS[0]);
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);
  const [showIconPicker, setShowIconPicker] = useState<string | null>(null);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    const cats = await databaseService.getCategories();
    setCategories(cats);
  };

  const startEdit = (cat: any) => {
    setEditingId(cat.id);
    setEditTitle(cat.title);
    setEditColor(cat.color);
    setEditIcon(cat.icon_name);
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    await databaseService.renameCategory(editingId, editTitle.trim());
    if (editColor) {
      await databaseService.runAsync('UPDATE categories SET color = ? WHERE id = ?', [editColor, editingId]);
    }
    if (editIcon) {
      await databaseService.runAsync('UPDATE categories SET icon_name = ? WHERE id = ?', [editIcon, editingId]);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEditingId(null);
    loadCategories();
  };

  const addCategory = async () => {
    if (!newTitle.trim()) return;
    await databaseService.addCategory(newTitle.trim(), newIcon, newColor);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setNewTitle('');
    setNewColor(PRESET_COLORS[0]);
    setNewIcon(PRESET_ICONS[0]);
    setShowAddForm(false);
    loadCategories();
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
      <View className="flex-row justify-between items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} style={{ backgroundColor: ts.bg.white5 }} className="p-3 rounded-2xl">
          <X color={ts.icon.default} size={20} />
        </TouchableOpacity>
        <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-lg">Manage Categories</Text>
        <View className="w-10" />
      </View>

      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 40 }}>
        {categories.map((cat) => (
          <View key={cat.id} style={{ backgroundColor: ts.bg.white5, borderColor: ts.border.subtle, borderWidth: 1 }} className="mb-3 p-4 rounded-3xl">
            {editingId === cat.id ? (
              <View>
                <TextInput
                  value={editTitle}
                  onChangeText={setEditTitle}
                  style={{ color: ts.text.onSurface, borderColor: ts.border.card, borderWidth: 1, backgroundColor: ts.bg.screen }}
                  className="font-manrope-bold text-base px-4 py-3 rounded-2xl mb-4"
                  selectionColor={Colors.primary}
                />
                {/* Color Picker */}
                <Text style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-2">Colour</Text>
                <View className="flex-row flex-wrap gap-2 mb-4">
                  {PRESET_COLORS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      onPress={() => setEditColor(c)}
                      style={{ backgroundColor: c, width: 32, height: 32, borderRadius: 16, borderWidth: editColor === c ? 3 : 0, borderColor: 'white' }}
                    />
                  ))}
                </View>
                {/* Icon Picker */}
                <Text style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-2">Icon</Text>
                <View className="flex-row flex-wrap gap-2 mb-4">
                  {PRESET_ICONS.slice(0, 16).map((icon) => (
                    <TouchableOpacity
                      key={icon}
                      onPress={() => setEditIcon(icon)}
                      style={{ backgroundColor: editIcon === icon ? editColor + '30' : ts.bg.card, borderColor: editIcon === icon ? editColor : 'transparent', borderWidth: 1 }}
                      className="w-10 h-10 rounded-xl items-center justify-center"
                    >
                      {renderIcon(icon, 18, editIcon === icon ? editColor : ts.icon.muted)}
                    </TouchableOpacity>
                  ))}
                </View>
                <View className="flex-row gap-3">
                  <TouchableOpacity onPress={saveEdit} className="flex-1 bg-primary py-3 rounded-2xl items-center">
                    <Text className="text-black font-manrope-bold">Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditingId(null)} style={{ backgroundColor: ts.bg.card, borderColor: ts.border.subtle, borderWidth: 1 }} className="py-3 px-6 rounded-2xl items-center">
                    <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold">Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1">
                  <View style={{ backgroundColor: cat.color + '20' }} className="w-10 h-10 rounded-xl items-center justify-center mr-3">
                    {renderIcon(cat.icon_name, 18, cat.color)}
                  </View>
                  <View className="flex-1">
                    <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-base">{cat.title}</Text>
                    {cat.is_default === 1 && (
                      <Text style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-medium text-[10px] uppercase tracking-widest">Default</Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity onPress={() => startEdit(cat)} style={{ backgroundColor: ts.bg.card }} className="px-4 py-2 rounded-xl">
                  <Text style={{ color: Colors.primary }} className="font-manrope-bold text-xs uppercase tracking-wider">Edit</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}

        {/* Add Category Button */}
        {showAddForm ? (
          <View style={{ backgroundColor: ts.bg.white5, borderColor: Colors.primary + '40', borderWidth: 1 }} className="p-5 rounded-3xl mb-6">
            <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-lg mb-4">New Category</Text>
            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Category name"
              placeholderTextColor={ts.text.onSurfaceVariant60}
              style={{ color: ts.text.onSurface, borderColor: ts.border.card, borderWidth: 1, backgroundColor: ts.bg.screen }}
              className="font-manrope-medium text-base px-4 py-3 rounded-2xl mb-4"
              selectionColor={Colors.primary}
            />
            <Text style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-2">Colour</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {PRESET_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setNewColor(c)}
                  style={{ backgroundColor: c, width: 32, height: 32, borderRadius: 16, borderWidth: newColor === c ? 3 : 0, borderColor: 'white' }}
                />
              ))}
            </View>
            <Text style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-2">Icon</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {PRESET_ICONS.map((icon) => (
                  <TouchableOpacity
                    key={icon}
                    onPress={() => setNewIcon(icon)}
                    style={{ backgroundColor: newIcon === icon ? newColor + '30' : ts.bg.card, borderColor: newIcon === icon ? newColor : 'transparent', borderWidth: 1 }}
                    className="w-10 h-10 rounded-xl items-center justify-center"
                  >
                    {renderIcon(icon, 18, newIcon === icon ? newColor : ts.icon.muted)}
                  </TouchableOpacity>
              ))}
            </View>
            <View className="flex-row gap-3">
              <TouchableOpacity onPress={addCategory} className="flex-1 bg-primary py-3 rounded-2xl items-center">
                <Text className="text-black font-manrope-bold">Add Category</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowAddForm(false)} style={{ backgroundColor: ts.bg.card, borderColor: ts.border.subtle, borderWidth: 1 }} className="py-3 px-6 rounded-2xl items-center">
                <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold">Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setShowAddForm(true)}
            style={{ borderColor: ts.border.card, borderWidth: 2, borderStyle: 'dashed' }}
            className="flex-row items-center justify-center p-5 rounded-3xl mb-6"
          >
            <Plus color={Colors.primary} size={20} />
            <Text style={{ color: ts.text.onSurfaceVariant60 }} className="font-manrope-semibold text-base ml-2">Add Category</Text>
          </TouchableOpacity>
        )}

        <Text style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-medium text-xs text-center leading-5">
          Category deletion is not yet supported. Deletion support is coming in a future update.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}