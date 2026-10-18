// Shared query surface keeps existing API routes independent of the provider.
export interface ApplicationDatabase {
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  all<T = any[]>(sql: string, ...params: any[]): Promise<T>;
  run(sql: string, ...params: any[]): Promise<{ lastID?: number; changes?: number }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface DatabaseQueryResult {
  rows: Record<string, any>[];
  rowCount: number | null;
}

export interface DatabaseClient {
  query(sql: string, values?: any[]): Promise<DatabaseQueryResult>;
  release(): void;
}

export interface DatabasePool {
  query(sql: string, values?: any[]): Promise<DatabaseQueryResult>;
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
}
