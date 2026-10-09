declare module '@react-native-community/netinfo' {
  export interface NetInfoState {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
  }
  export type NetInfoSubscription = () => void;
  const NetInfo: {
    addEventListener(listener: (state: NetInfoState) => void): NetInfoSubscription;
    fetch(): Promise<NetInfoState>;
  };
  export default NetInfo;
}
