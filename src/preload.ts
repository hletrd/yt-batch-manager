const { contextBridge, ipcRenderer, shell } = require('electron');

interface YouTubeAPI {
  authenticate: () => Promise<{ success: boolean; error?: string }>;
  loadVideos: () => Promise<any>;
  updateVideo: (data: { video_id: string; title: string; description: string }) => Promise<any>;
  updateVideosBatch: (data: { updates: Array<{ video_id: string; title: string; description: string }> }) => Promise<any>;
  saveVideos: () => Promise<any>;
  loadFromFile: () => Promise<any>;
  downloadVideoInfo: () => Promise<any>;
  downloadFilteredVideoInfo: (data: { videos: any[] }) => Promise<any>;
  loadJsonFile: () => Promise<any>;
  getThumbnail: (filename: string) => Promise<any>;
  getChannelInfo: () => Promise<any>;
  getVideos: () => Promise<any>;
  checkCredentials: () => Promise<{ success: boolean; error?: string; path?: string }>;
  openExternal: (url: string) => Promise<void>;
  getAvailableLanguages: () => Promise<{ languages: string[] }>;
  getCurrentLanguage: () => Promise<{ language: string }>;
  selectCredentialsFile: () => Promise<{ success: boolean; error?: string; cancelled?: boolean }>;
  removeStoredCredentials: () => Promise<{ success: boolean; error?: string }>;
  clearCache: () => Promise<{ success: boolean; error?: string }>;
  getVideoCategories: () => Promise<{ categories: Record<string, { id: string; title: string }> }>;
  getI18nLanguages: () => Promise<{ languages: Record<string, { id: string; name: string }> }>;
}

const youtubeAPI: YouTubeAPI = {
  authenticate: () => ipcRenderer.invoke('youtube:authenticate'),
  loadVideos: () => ipcRenderer.invoke('youtube:load-videos'),
  updateVideo: (data) => ipcRenderer.invoke('youtube:update-video', data),
  updateVideosBatch: (data) => ipcRenderer.invoke('youtube:update-videos-batch', data),
  saveVideos: () => ipcRenderer.invoke('youtube:save-videos'),
  loadFromFile: () => ipcRenderer.invoke('youtube:load-from-file'),
  downloadVideoInfo: () => ipcRenderer.invoke('youtube:download-videos'),
  downloadFilteredVideoInfo: (data) => ipcRenderer.invoke('youtube:download-filtered-videos', data),
  loadJsonFile: () => ipcRenderer.invoke('youtube:load-json-file'),
  getThumbnail: (filename) => ipcRenderer.invoke('youtube:get-thumbnail', filename),
  getChannelInfo: () => ipcRenderer.invoke('youtube:get-channel-info'),
  getVideos: () => ipcRenderer.invoke('youtube:get-videos'),
  checkCredentials: () => ipcRenderer.invoke('youtube:check-credentials'),
  openExternal: (url) => shell.openExternal(url),
  getAvailableLanguages: () => ipcRenderer.invoke('i18n:get-available-languages'),
  getCurrentLanguage: () => ipcRenderer.invoke('i18n:get-current-language'),
  selectCredentialsFile: () => ipcRenderer.invoke('youtube:select-credentials-file'),
  removeStoredCredentials: () => ipcRenderer.invoke('youtube:remove-stored-credentials'),
  clearCache: () => ipcRenderer.invoke('youtube:clear-cache'),
  getVideoCategories: () => ipcRenderer.invoke('youtube:get-video-categories'),
  getI18nLanguages: () => ipcRenderer.invoke('youtube:get-i18n-languages'),
};

const electronAPI = {
  ipcRenderer: {
    on: (channel: string, func: (...args: any[]) => void) => {
      const validChannels = ['show-find', 'hide-find', 'find-next', 'find-previous', 'find-result'];
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, func);
      }
    },
    removeAllListeners: (channel: string) => {
      const validChannels = ['show-find', 'hide-find', 'find-next', 'find-previous', 'find-result'];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    }
  }
};

contextBridge.exposeInMainWorld('youtubeAPI', youtubeAPI);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);