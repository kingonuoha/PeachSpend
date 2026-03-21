import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { User, Key, Trash2, Info, ChevronRight, Moon, Bell } from 'lucide-react-native';
import { databaseService } from '../../services/DatabaseService';
import { Strings } from '../../constants/strings';
import { Colors } from '../../constants/tokens';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { logger } from '../../utils/logger';

export default function SettingsScreen() {
  const [apiKey, setApiKey] = useState('');
  const [isThemeDark, setIsThemeDark] = useState(true);
  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      const savedKey = await databaseService.getSetting('gemini_api_key');
      if (savedKey) setApiKey(savedKey);
    };
    loadSettings();
  }, []);

  const handleSaveApiKey = async () => {
    try {
      await databaseService.updateSetting('gemini_api_key', apiKey);
      Alert.alert('Success', 'API Key updated successfully.');
    } catch (error) {
      logger.error('Failed to update API key', error);
      Alert.alert('Error', 'Failed to update API key.');
    }
  };

  const handleClearData = () => {
    Alert.alert(
      'Clear All Data',
      'Are you sure you want to delete all expenses and settings? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Clear Data', 
          style: 'destructive',
          onPress: async () => {
            // TODO: databaseService.clearAllData();
            Alert.alert('Refreshed', 'Database cleared (logic to be implemented in DatabaseService).');
          }
        }
      ]
    );
  };

  const SettingRow = ({ icon: Icon, title, value, onPress, isLast = false, rightElement = <ChevronRight size={20} color={Colors.onSurfaceVariant} /> }: any) => (
    <TouchableOpacity 
      onPress={onPress}
      className={`flex-row items-center justify-between py-4 ${!isLast ? 'border-b border-surfaceVariant' : ''}`}
    >
      <View className="flex-row items-center">
        <View className="bg-surfaceContainerHigh p-2 rounded-xl mr-4">
          <Icon size={20} color={Colors.primary} />
        </View>
        <Text className="text-onSurface font-manrope-semibold text-base">{title}</Text>
      </View>
      {rightElement}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView className="flex-1 px-6 pt-8" contentContainerStyle={{ paddingBottom: 100 }}>
        <Text className="text-onSurface font-noto-serif-bold text-3xl mb-8">
          {Strings.settings.title}
        </Text>

        {/* Profile Section */}
        <LuminousCard className="p-4 mb-6">
          <View className="flex-row items-center p-2">
            <View className="w-16 h-16 rounded-full bg-primary items-center justify-center mr-4">
              <User size={32} color={Colors.onPrimary} />
            </View>
            <View>
              <Text className="text-onSurface font-noto-serif-bold text-xl">Peach User</Text>
              <Text className="text-onSurfaceVariant font-manrope-regular">Free Tier</Text>
            </View>
          </View>
        </LuminousCard>

        {/* AI Configuration */}
        <Text className="text-onSurfaceVariant font-manrope-bold text-xs uppercase tracking-widest mb-3 ml-1">
          {Strings.settings.ai_preferences}
        </Text>
        <LuminousCard className="p-4 mb-8">
          <View className="mb-4">
            <View className="flex-row items-center mb-3">
              <Key size={18} color={Colors.primary} />
              <Text className="text-onSurface font-manrope-semibold ml-2">Gemini API Key</Text>
            </View>
            <TextInput
              value={apiKey}
              onChangeText={setApiKey}
              secureTextEntry
              placeholder="Paste your key here..."
              placeholderTextColor={Colors.onSurfaceVariant}
              className="bg-surfaceContainerHigh text-onSurface px-4 py-3 rounded-xl font-manrope-regular"
            />
          </View>
          <TouchableOpacity 
            onPress={handleSaveApiKey}
            className="bg-primary py-3 rounded-xl items-center"
          >
            <Text className="text-onPrimary font-manrope-bold">Update Key</Text>
          </TouchableOpacity>
        </LuminousCard>

        {/* App Settings */}
        <Text className="text-onSurfaceVariant font-manrope-bold text-xs uppercase tracking-widest mb-3 ml-1">
          Preferences
        </Text>
        <LuminousCard className="px-4 mb-8">
          <SettingRow 
            icon={Moon} 
            title="Dark Mode" 
            rightElement={<Switch value={isThemeDark} onValueChange={setIsThemeDark} trackColor={{ true: Colors.primary }} />}
          />
          <SettingRow 
            icon={Bell} 
            title="Notifications" 
            rightElement={<Switch value={notifications} onValueChange={setNotifications} trackColor={{ true: Colors.primary }} />}
          />
          <SettingRow 
            icon={Info} 
            title="Help & Support" 
            isLast 
          />
        </LuminousCard>

        {/* Danger Zone */}
        <Text className="text-error font-manrope-bold text-xs uppercase tracking-widest mb-3 ml-1">
          Danger Zone
        </Text>
        <LuminousCard className="px-4 mb-8 border border-error/20">
          <SettingRow 
            icon={Trash2} 
            title="Clear All Data" 
            onPress={handleClearData}
            isLast 
          />
        </LuminousCard>

        <View className="items-center opacity-40">
          <Text className="text-onSurfaceVariant font-manrope-medium">PeachSpend v1.0.1</Text>
          <Text className="text-onSurfaceVariant font-manrope-regular text-xs">Made with ❤️ for beautiful savings</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
