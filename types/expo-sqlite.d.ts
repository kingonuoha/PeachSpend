declare module 'expo-sqlite' {
  export type SQLiteBindBlobValue = Uint8Array | ArrayBuffer;
  export type SQLiteBindValue = string | number | null | boolean | SQLiteBindBlobValue;
  export type SQLiteBindParams = Record<string, SQLiteBindValue> | SQLiteBindValue[];

  export interface SQLiteDatabase {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, params?: SQLiteBindParams): Promise<void>;
    getFirstAsync<T>(sql: string, params?: SQLiteBindParams): Promise<T | null>;
    getAllAsync<T>(sql: string, params?: SQLiteBindParams): Promise<T[]>;
    isInTransactionAsync(): Promise<boolean>;
    closeAsync(): Promise<void>;
  }

  export function openDatabaseAsync(
    databaseName: string,
    options?: { useNewConnection?: boolean }
  ): Promise<SQLiteDatabase>;
}
