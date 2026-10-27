export interface ElectronFolderResult {
  canceled?: boolean;
  cancelled?: boolean;
  path: string | null;
  folderName?: string;
  error?: string;
}

export interface ElectronAPI {
  selectFolder: (initialPath?: string) => Promise<ElectronFolderResult>;
  getPlatform: () => Promise<string>;
  isDesktop?: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
