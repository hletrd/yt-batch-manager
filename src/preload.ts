import { contextBridge, ipcRenderer, shell } from 'electron';

interface YouTubeAPI {
  authenticate: () => Promise<{ success: boolean; error?: string }>;
  loadVideos: () => Promise<any>;
  updateVideo: (data: { video_id: string; title: string; description: string }) => Promise<any>;
  updateVideosBatch: (data: { updates: Array<{ video_id: string; title: string; description: string }> }) => Promise<any>;
  saveVideos: () => Promise<any>;
  loadFromFile: () => Promise<any>;
  downloadVideos: () => Promise<any>;
  loadJsonFile: () => Promise<any>;
  getThumbnail: (filename: string) => Promise<any>;
  getChannelInfo: () => Promise<any>;
  getVideos: () => Promise<any>;
  checkCredentials: () => Promise<{ success: boolean; error?: string; path?: string }>;
  openExternal: (url: string) => Promise<void>;
}

const youtubeAPI: YouTubeAPI = {
  authenticate: () => ipcRenderer.invoke('youtube:authenticate'),
  loadVideos: () => ipcRenderer.invoke('youtube:load-videos'),
  updateVideo: (data) => ipcRenderer.invoke('youtube:update-video', data),
  updateVideosBatch: (data) => ipcRenderer.invoke('youtube:update-videos-batch', data),
  saveVideos: () => ipcRenderer.invoke('youtube:save-videos'),
  loadFromFile: () => ipcRenderer.invoke('youtube:load-from-file'),
  downloadVideos: () => ipcRenderer.invoke('youtube:download-videos'),
  loadJsonFile: () => ipcRenderer.invoke('youtube:load-json-file'),
  getThumbnail: (filename) => ipcRenderer.invoke('youtube:get-thumbnail', filename),
  getChannelInfo: () => ipcRenderer.invoke('youtube:get-channel-info'),
  getVideos: () => ipcRenderer.invoke('youtube:get-videos'),
  checkCredentials: () => ipcRenderer.invoke('youtube:check-credentials'),
  openExternal: (url) => shell.openExternal(url),
};

contextBridge.exposeInMainWorld('youtubeAPI', youtubeAPI);

declare global {
  interface Window {
    youtubeAPI: YouTubeAPI;
  }
}