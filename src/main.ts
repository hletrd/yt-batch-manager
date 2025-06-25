import { app, BrowserWindow, ipcMain, dialog, shell, screen } from 'electron';
import { youtube } from '@googleapis/youtube';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import { i18n } from './i18n/i18n.js';
import * as crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface VideoData {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  thumbnails: Record<string, ThumbnailData>;
  published_at: string;
  privacy_status: string;
  category_id: string;
  duration?: string;
  upload_status?: string;
  processing_status?: string;
  processing_progress?: {
    parts_total?: number;
    parts_processed?: number;
    time_left_ms?: number;
  };
  statistics?: {
    view_count?: string;
    like_count?: string;
    dislike_count?: string;
    comment_count?: string;
  };
}

interface ThumbnailData {
  url: string;
  width: number;
  height: number;
}

interface UpdateRequest {
  video_id: string;
  title: string;
  description: string;
  privacy_status: string;
  category_id: string;
}

interface BatchUpdateResponse {
  success: boolean;
  results: {
    successful: Array<{ video_id: string; title: string }>;
    failed: Array<{ video_id: string; error: string }>;
  };
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

interface StoreSchema {
  windowState?: WindowState;
}

const SCOPES = ['https://www.googleapis.com/auth/youtube'];
// MD5 hash of thumbnail indicating the video is being processed
const ERROR_THUMBNAIL_MD5 = 'e2ddfee11ae7edcae257da47f3a78a70';

const getCredentialsPath = (): string => {
  return path.join(app.getPath('userData'), 'credentials.json');
};

const getTokenPath = (): string => {
  return path.join(app.getPath('userData'), 'token.json');
};

const getCacheDirPath = (): string => {
  return path.join(app.getPath('userData'), 'cache', 'thumbnails');
};

const CACHE_DIR = getCacheDirPath();

const store = new Store<StoreSchema>() as any;

class YouTubeManager {
  private oauth2Client: OAuth2Client;
  private youtube: any;
  private videos: VideoData[] = [];
  private thumbnailUrls: Record<string, string> = {};
  private videoCategories: Record<string, { id: string; title: string }> = {};

  constructor() {
    this.oauth2Client = new OAuth2Client();
    this.ensureCacheDir();
  }

  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (error) {
      console.error(i18n.t('errors.errorCreatingCacheDirectory'), error);
    }
  }

  checkCredentials(): { success: boolean; error?: string; path?: string } {
    const credentialsPath = getCredentialsPath();

    if (!fsSync.existsSync(credentialsPath)) {
      return {
        success: false,
        error: i18n.t('credentials.credentialsNotFound', { path: credentialsPath }),
        path: credentialsPath
      };
    }

    try {
      const credentialsContent = fsSync.readFileSync(credentialsPath, 'utf-8');
      const credentials = JSON.parse(credentialsContent);

      if (!credentials.installed || !credentials.installed.client_secret || !credentials.installed.client_id || !credentials.installed.redirect_uris) {
        return {
          success: false,
          error: i18n.t('credentials.credentialsMissingFields'),
          path: credentialsPath
        };
      }

      return { success: true, path: credentialsPath };
    } catch (parseError) {
      return {
        success: false,
        error: i18n.t('credentials.credentialsInvalid'),
        path: credentialsPath
      };
    }
  }

  async selectCredentialsFile(mainWindow: BrowserWindow): Promise<{ success: boolean; error?: string; cancelled?: boolean }> {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: i18n.t('credentials.selectCredentialsFile'),
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || !result.filePaths.length) {
        return { success: false, cancelled: true };
      }

      const selectedPath = result.filePaths[0];
      const credentialsPath = getCredentialsPath();

      await fs.mkdir(path.dirname(credentialsPath), { recursive: true });

      await fs.copyFile(selectedPath, credentialsPath);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async removeStoredCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      const credentialsPath = getCredentialsPath();
      const tokenPath = getTokenPath();

      if (fsSync.existsSync(credentialsPath)) {
        await fs.unlink(credentialsPath);
      }

      if (fsSync.existsSync(tokenPath)) {
        await fs.unlink(tokenPath);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async clearCache(): Promise<{ success: boolean; error?: string }> {
    try {
      const cacheDir = getCacheDirPath();

      if (fsSync.existsSync(cacheDir)) {
        const files = await fs.readdir(cacheDir);
        await Promise.all(files.map(file => fs.unlink(path.join(cacheDir, file))));
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async authenticate(): Promise<{ success: boolean; error?: string }> {
    try {
      const credentialsPath = getCredentialsPath();
      if (!fsSync.existsSync(credentialsPath)) {
        return {
          success: false,
          error: i18n.t('credentials.credentialsNotFound', { path: credentialsPath })
        };
      }

      let credentials;
      try {
        const credentialsContent = await fs.readFile(credentialsPath, 'utf-8');
        credentials = JSON.parse(credentialsContent);
      } catch (parseError) {
        return {
          success: false,
          error: i18n.t('credentials.credentialsInvalid')
        };
      }

      if (!credentials.installed || !credentials.installed.client_secret || !credentials.installed.client_id || !credentials.installed.redirect_uris) {
        return {
          success: false,
          error: i18n.t('credentials.credentialsMissingFields')
        };
      }

      const { client_secret, client_id, redirect_uris } = credentials.installed;

      this.oauth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);

      let tokens = null;
      if (fsSync.existsSync(getTokenPath())) {
        const tokenContent = await fs.readFile(getTokenPath(), 'utf-8');
        tokens = JSON.parse(tokenContent);
        this.oauth2Client.setCredentials(tokens);
      }

      if (!tokens || !tokens.access_token) {
        tokens = await this.getNewToken();
      } else {
        try {
          const tokenInfo = await this.oauth2Client.getTokenInfo(tokens.access_token);
          if (!tokenInfo) {
            throw new Error('Invalid token');
          }
        } catch (error) {
          if (tokens.refresh_token) {
            try {
              const { credentials } = await this.oauth2Client.refreshAccessToken();
              tokens = credentials;
              this.oauth2Client.setCredentials(tokens);
              await fs.writeFile(getTokenPath(), JSON.stringify(tokens, null, 2));
            } catch (refreshError) {
              tokens = await this.getNewToken();
            }
          } else {
            tokens = await this.getNewToken();
          }
        }
      }

      this.youtube = youtube({ version: 'v3', auth: this.oauth2Client });
      return { success: true };
    } catch (error) {
      console.error(i18n.t('console.authenticationFailed'), error);
      return {
        success: false,
        error: error instanceof Error ? error.message : i18n.t('authentication.unknownError')
      };
    }
  }

  private async getNewToken(): Promise<any> {
    const port = await this.findAvailablePort(5000);
    const redirectUri = `http://localhost:${port}/callback`;

    this.oauth2Client = new OAuth2Client(
      this.oauth2Client._clientId,
      this.oauth2Client._clientSecret,
      redirectUri
    );

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    const tokens = await this.startCallbackServer(port, authUrl);
    this.oauth2Client.setCredentials(tokens);

    await fs.writeFile(getTokenPath(), JSON.stringify(tokens, null, 2));

    return tokens;
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number) => {
        const server = http.createServer();
        server.listen(port, () => {
          server.close(() => resolve(port));
        });
        server.on('error', () => {
          if (port < startPort + 100) {
            tryPort(port + 1);
          } else {
            reject(new Error('No available port found'));
          }
        });
      };
      tryPort(startPort);
    });
  }

  private async startCallbackServer(port: number, authUrl: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url!, true);

        if (parsedUrl.pathname === '/callback') {
          const code = parsedUrl.query.code as string;
          const error = parsedUrl.query.error as string;

          res.writeHead(200, { 'Content-Type': 'text/html' });

          if (error) {
            res.end(i18n.t('http.authenticationFailed', { error }));
            server.close();
            reject(new Error(i18n.t('authentication.authenticationError', { error })));
            return;
          }

          if (code) {
            res.end(i18n.t('http.authenticationSuccessful'));

            server.close();

            this.oauth2Client.getToken(code).then(({ tokens }) => {
              resolve(tokens);
            }).catch(reject);
          } else {
            res.end(i18n.t('http.authenticationFailedNoCode'));
            server.close();
            reject(new Error(i18n.t('authentication.noAuthorizationCode')));
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.listen(port, () => {
        shell.openExternal(authUrl);
      });

      server.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async downloadThumbnail(url: string, filename: string): Promise<boolean> {
    return new Promise((resolve) => {
      const filePath = path.join(CACHE_DIR, filename);
      const chunks: Buffer[] = [];

      https.get(url, (response) => {
        response.on('data', (chunk) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const hash = crypto.createHash('md5').update(buffer).digest('hex');

          if (hash === ERROR_THUMBNAIL_MD5) {
            console.log(`Skipping error thumbnail with MD5: ${hash} for ${filename}`);
            resolve(false);
            return;
          }

          fsSync.writeFileSync(filePath, buffer);
          resolve(true);
        });
      }).on('error', (error) => {
        console.error(i18n.t('errors.errorDownloadingThumbnail', { url }), error);
        resolve(false);
      });
    });
  }

  private createLocalThumbnailUrls(videoId: string, thumbnails: any): Record<string, ThumbnailData> {
    const localThumbnails: Record<string, ThumbnailData> = {};

    for (const [size, thumbData] of Object.entries(thumbnails as Record<string, any>)) {
      const { width, height, url } = thumbData;
      const filename = `${videoId}_${size}_${width}_${height}.jpg`;

      this.thumbnailUrls[filename] = url;

      localThumbnails[size] = {
        url: `cache://${filename}`,
        width,
        height,
      };
    }

    return localThumbnails;
  }

  async getChannelInfo(): Promise<any> {
    try {
      if (!this.youtube) {
        throw new Error('YouTube API not authenticated');
      }

      const channelsResponse = await this.youtube.channels.list({
        part: 'snippet,brandingSettings',
        mine: true,
      });

      if (!channelsResponse.data.items?.length) {
        return null;
      }

      const channel = channelsResponse.data.items[0];
      return {
        name: channel.snippet.title,
        thumbnail: channel.snippet.thumbnails?.default?.url || channel.snippet.thumbnails?.medium?.url,
        id: channel.id,
        country: channel.brandingSettings?.channel?.country || null,
      };
    } catch (error) {
      console.error(i18n.t('errors.errorFetchingChannelInfo'), error);
      return null;
    }
  }

  async getChannelVideos(channelId?: string, maxResults: number = 200): Promise<VideoData[]> {
    try {
      if (!this.youtube) {
        throw new Error('YouTube API not authenticated');
      }

      let uploadsPlaylistId: string;

      if (!channelId) {
        const channelsResponse = await this.youtube.channels.list({
          part: 'contentDetails',
          mine: true,
        });

        if (!channelsResponse.data.items?.length) {
          return [];
        }

        uploadsPlaylistId = channelsResponse.data.items[0].contentDetails.relatedPlaylists.uploads;
      } else {
        const channelsResponse = await this.youtube.channels.list({
          part: 'contentDetails',
          id: channelId,
        });

        if (!channelsResponse.data.items?.length) {
          return [];
        }

        uploadsPlaylistId = channelsResponse.data.items[0].contentDetails.relatedPlaylists.uploads;
      }

      const playlistItems: any[] = [];
      let nextPageToken: string | undefined;

      while (playlistItems.length < maxResults) {
        const playlistResponse = await this.youtube.playlistItems.list({
          part: 'snippet,status',
          playlistId: uploadsPlaylistId,
          maxResults: Math.min(50, maxResults - playlistItems.length),
          pageToken: nextPageToken,
        });

        playlistItems.push(...(playlistResponse.data.items || []));
        nextPageToken = playlistResponse.data.nextPageToken;

        if (!nextPageToken) break;
      }

      const videoIds: string[] = [];
      const videoSnippetsMap: Record<string, any> = {};

      for (const item of playlistItems) {
        try {
          const snippet = item.snippet || {};
          const resourceId = snippet.resourceId || {};

          if (!resourceId.videoId) continue;

          const videoId = resourceId.videoId;
          videoIds.push(videoId);
          videoSnippetsMap[videoId] = {
            snippet,
            status: item.status || {},
          };
        } catch (error) {
          console.error('Error processing video item:', error);
          continue;
        }
      }

      const videos: VideoData[] = [];

      for (let i = 0; i < videoIds.length; i += 50) {
        const batchIds = videoIds.slice(i, i + 50);

        try {
          const videoDetailsResponse = await this.youtube.videos.list({
            part: 'snippet,contentDetails,status,statistics,processingDetails',
            id: batchIds.join(','),
          });

          const videoDetails = videoDetailsResponse.data.items || [];

          for (const videoDetail of videoDetails) {
            try {
              const videoId = videoDetail.id;
              const originalData = videoSnippetsMap[videoId];

              let snippet, thumbnails;

              if (!originalData) {
                console.log(`Video ${videoId} is not in the playlist items`);
                console.log(videoDetail);
                continue;
              } else {
                snippet = videoDetail.snippet;
                thumbnails = snippet.thumbnails || {};
              }

              const localThumbnails = this.createLocalThumbnailUrls(videoId, thumbnails);

              let thumbnailUrl = '';
              for (const size of ['medium', 'high', 'default', 'standard']) {
                if (localThumbnails[size]) {
                  thumbnailUrl = localThumbnails[size].url;
                  break;
                }
              }

              const status = videoDetail.status || {};
              const contentDetails = videoDetail.contentDetails || {};
              const statistics = videoDetail.statistics || {};
              const processingDetails = videoDetail.processingDetails || {};

              const privacyStatus = status.privacyStatus || 'unknown';

              const videoData: VideoData = {
                id: videoId,
                title: snippet.title || '',
                description: snippet.description || '',
                thumbnail_url: thumbnailUrl,
                thumbnails: localThumbnails,
                published_at: snippet.publishedAt || '',
                privacy_status: privacyStatus,
                category_id: snippet.categoryId,
                duration: contentDetails.duration || undefined,
                upload_status: status.uploadStatus || undefined,
                processing_status: processingDetails.processingStatus || undefined,
                processing_progress: processingDetails.processingProgress ? {
                  parts_total: processingDetails.processingProgress.partsTotal || undefined,
                  parts_processed: processingDetails.processingProgress.partsProcessed || undefined,
                  time_left_ms: processingDetails.processingProgress.timeLeftMs || undefined,
                } : undefined,
                statistics: {
                  view_count: statistics.viewCount || '0',
                  like_count: statistics.likeCount || '0',
                  dislike_count: statistics.dislikeCount || '0',
                  comment_count: statistics.commentCount || '0',
                },
              };

              videos.push(videoData);
            } catch (error) {
              console.error('Error processing video detail:', error);
              continue;
            }
          }
        } catch (error) {
          console.error('Error fetching video details batch:', error);
          continue;
        }
      }

      this.videos = videos;
      return videos;
    } catch (error) {
      console.error('Error fetching videos:', error);
      return [];
    }
  }

  async updateVideo(videoId: string, title: string, description: string, privacyStatus: string, categoryId: string): Promise<boolean> {
    try {
      if (!this.youtube) {
        throw new Error('YouTube API not authenticated');
      }

      const parts = ['snippet'];
      const requestBody: any = {
        id: videoId,
        snippet: {
          title,
          description,
          categoryId,
        },
      };

      if (privacyStatus) {
        parts.push('status');
        requestBody.status = {
          privacyStatus: privacyStatus,
        };
      }

      await this.youtube.videos.update({
        part: parts.join(','),
        requestBody: requestBody,
      });

      return true;
    } catch (error) {
      console.error(`Error updating video ${videoId}:`, error);
      return false;
    }
  }

  async saveVideosToFile(filename: string = 'videos_backup.json'): Promise<boolean> {
    try {
      await fs.writeFile(filename, JSON.stringify(this.videos, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error('Error saving videos:', error);
      return false;
    }
  }

  async loadVideosFromFile(filename: string = 'videos_backup.json'): Promise<boolean> {
    try {
      if (fsSync.existsSync(filename)) {
        const content = await fs.readFile(filename, 'utf-8');
        this.videos = JSON.parse(content);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error loading videos:', error);
      return false;
    }
  }

  getVideos(): VideoData[] {
    return this.videos;
  }

  async getThumbnailPath(filename: string): Promise<string | null> {
    const filePath = path.join(CACHE_DIR, filename);
    if (fsSync.existsSync(filePath)) {
      return filePath;
    }

    if (this.thumbnailUrls[filename]) {
      const success = await this.downloadThumbnail(this.thumbnailUrls[filename], filename);
      if (success) {
        return filePath;
      }
    }

    return null;
  }

  async getVideoCategories(): Promise<Record<string, { id: string; title: string }>> {
    try {
      if (!this.youtube) {
        throw new Error('YouTube API not authenticated');
      }

      if (Object.keys(this.videoCategories).length > 0) {
        return this.videoCategories;
      }

      const channelInfo = await this.getChannelInfo();

      let regionCode = 'US';
      if (channelInfo && channelInfo.country) {
        regionCode = channelInfo.country;
      } else {
        const systemLocale = app.getLocale();
        const localeParts = systemLocale.split('-');
        if (localeParts.length > 1) {
          regionCode = localeParts[1];
        }
      }

      const locale = app.getLocale().replace('-', '_') || 'en_US';

      const response = await this.youtube.videoCategories.list({
        part: 'snippet',
        regionCode: regionCode,
        hl: locale,
      });

      const categories: Record<string, { id: string; title: string }> = {};

      if (response.data.items) {
        for (const category of response.data.items) {
          if (category.snippet.assignable) {
            categories[category.id] = {
              id: category.id,
              title: category.snippet.title,
            };
          }
        }
      }

      this.videoCategories = categories;
      return categories;
    } catch (error) {
      console.error('Error fetching video categories:', error);
      return {};
    }
  }
}

class ElectronApp {
  private mainWindow: BrowserWindow | null = null;
  private youtubeManager: YouTubeManager;
  private findVisible: boolean = false;

  constructor() {
    this.youtubeManager = new YouTubeManager();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor,AutofillShowTypePredictions');
    app.commandLine.appendSwitch('disable-blink-features', 'AutofillPreventOverscroll,AutofillShowTypePredictions');

    app.whenReady().then(async () => {
      await i18n.initialize();
      this.createWindow();
      this.setupIpcHandlers();
    });

    app.on('window-all-closed', () => {
      app.quit();
    });

    app.on('activate', () => {
      if (this.mainWindow === null) {
        this.createWindow();
      }
    });
  }

  private registerLocalShortcuts(): void {
    if (!this.mainWindow) return;

    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      if (!this.mainWindow?.isFocused()) return;

      if ((input.control || input.meta) && input.key.toLowerCase() === 'f' && !input.shift && !input.alt) {
        event.preventDefault();
        this.toggleFind();
        return;
      }

      if (input.key === 'F3' && !input.control && !input.meta && !input.shift && !input.alt) {
        event.preventDefault();
        this.findNext();
        return;
      }

      if (input.key === 'F3' && input.shift && !input.control && !input.meta && !input.alt) {
        event.preventDefault();
        this.findPrevious();
        return;
      }

      if (input.key === 'Escape' && !input.control && !input.meta && !input.shift && !input.alt) {
        event.preventDefault();
        this.closeFind();
        return;
      }
    });
  }

  private toggleFind(): void {
    if (!this.mainWindow) return;

    if (this.findVisible) {
      this.closeFind();
    } else {
      this.showFind();
    }
  }

  private showFind(): void {
    if (!this.mainWindow) return;

    this.findVisible = true;
    this.mainWindow.webContents.send('show-find');
  }

    private closeFind(): void {
    if (!this.mainWindow) return;

    this.findVisible = false;
    this.mainWindow.webContents.send('hide-find');
  }

  private findNext(): void {
    if (!this.mainWindow || !this.findVisible) return;
    this.mainWindow.webContents.send('find-next');
  }

  private findPrevious(): void {
    if (!this.mainWindow || !this.findVisible) return;
    this.mainWindow.webContents.send('find-previous');
  }

  private createWindow(): void {
    const windowState = this.getWindowState();

    this.mainWindow = new BrowserWindow({
      width: windowState.width,
      height: windowState.height,
      x: windowState.x,
      y: windowState.y,
      minWidth: 360,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: true,
      },
      titleBarStyle: 'default',
      show: false,
      autoHideMenuBar: true,
    });

    if (windowState.isMaximized) {
      this.mainWindow.maximize();
    }

    this.mainWindow.setMenuBarVisibility(false);

    this.setupWindowStateTracking();

    this.mainWindow.loadFile(path.join(__dirname, '../src/renderer.html'));

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
      this.registerLocalShortcuts();
    });
  }

  private getWindowState(): WindowState {
    const defaultState: WindowState = {
      width: 1200,
      height: 800,
    };

    const savedState = store.get('windowState') as WindowState | undefined;
    if (!savedState) {
      return defaultState;
    }

    if (!app.isReady()) {
      return savedState;
    }

    try {
      const displays = screen.getAllDisplays();
      let isValidPosition = false;

      if (savedState.x !== undefined && savedState.y !== undefined) {
        for (const display of displays) {
          const { x, y, width, height } = display.bounds;

          if (
            savedState.x < x + width &&
            savedState.x + savedState.width > x &&
            savedState.y < y + height &&
            savedState.y + savedState.height > y
          ) {
            isValidPosition = true;
            break;
          }
        }
      }

      if (!isValidPosition) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

        savedState.x = Math.round((screenWidth - savedState.width) / 2);
        savedState.y = Math.round((screenHeight - savedState.height) / 2);
      }
    } catch (error) {
      console.warn('Screen module not available, using saved state as-is:', error);
    }

    savedState.width = Math.max(360, savedState.width);
    savedState.height = Math.max(600, savedState.height);

    return savedState;
  }

  private setupWindowStateTracking(): void {
    if (!this.mainWindow) return;

    const saveWindowState = () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

      const bounds = this.mainWindow.getBounds();
      const isMaximized = this.mainWindow.isMaximized();

      const windowState: WindowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        isMaximized,
      };

      store.set('windowState', windowState);
    };

    this.mainWindow.on('resize', saveWindowState);
    this.mainWindow.on('move', saveWindowState);
    this.mainWindow.on('maximize', saveWindowState);
    this.mainWindow.on('unmaximize', saveWindowState);
    this.mainWindow.on('close', saveWindowState);
  }

  private setupIpcHandlers(): void {
    ipcMain.handle('youtube:authenticate', async () => {
      return await this.youtubeManager.authenticate();
    });

    ipcMain.handle('youtube:load-videos', async () => {
      try {
        const videos = await this.youtubeManager.getChannelVideos();
        return { success: true, videos, count: videos.length };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('youtube:update-video', async (_, { video_id, title, description, privacy_status, category_id }: UpdateRequest) => {
      try {
        const success = await this.youtubeManager.updateVideo(video_id, title, description, privacy_status, category_id);

        if (success) {
          const videos = this.youtubeManager.getVideos();
          const video = videos.find(v => v.id === video_id);
          if (video) {
            video.title = title;
            video.description = description;
            video.privacy_status = privacy_status;
            video.category_id = category_id;
          }
        }

        return { success };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('youtube:update-videos-batch', async (_, { updates }: { updates: UpdateRequest[] }): Promise<BatchUpdateResponse> => {
      const results = {
        successful: [] as Array<{ video_id: string; title: string }>,
        failed: [] as Array<{ video_id: string; error: string }>,
      };

      for (const update of updates) {
        const { video_id, title, description, privacy_status, category_id } = update;

        if (!video_id || title === undefined || description === undefined) {
          results.failed.push({
            video_id: video_id || 'unknown',
            error: 'Missing required fields',
          });
          continue;
        }

        try {
          const success = await this.youtubeManager.updateVideo(video_id, title, description, privacy_status, category_id);

          if (success) {
            const videos = this.youtubeManager.getVideos();
            const video = videos.find(v => v.id === video_id);
            if (video) {
              video.title = title;
              video.description = description;
              video.privacy_status = privacy_status;
              video.category_id = category_id;
            }

            results.successful.push({ video_id, title });
          } else {
            results.failed.push({
              video_id,
              error: 'YouTube API update failed',
            });
          }
        } catch (error) {
          results.failed.push({
            video_id,
            error: (error as Error).message,
          });
        }
      }

      return {
        success: results.successful.length > 0,
        results,
        summary: {
          total: updates.length,
          successful: results.successful.length,
          failed: results.failed.length,
        },
      };
    });

    ipcMain.handle('youtube:save-videos', async () => {
      const success = await this.youtubeManager.saveVideosToFile();
      return { success };
    });

    ipcMain.handle('youtube:load-from-file', async () => {
      const success = await this.youtubeManager.loadVideosFromFile();
      if (success) {
        return { success: true, videos: this.youtubeManager.getVideos() };
      }
      return { success: false, message: 'No backup file found' };
    });

    ipcMain.handle('youtube:download-videos', async () => {
      try {
        const result = await dialog.showSaveDialog(this.mainWindow!, {
          title: 'Save Videos Backup',
          defaultPath: 'videos_backup.json',
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (!result.canceled && result.filePath) {
          const success = await this.youtubeManager.saveVideosToFile(result.filePath);
          return { success, filePath: result.filePath };
        }

        return { success: false, cancelled: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('youtube:load-json-file', async () => {
      try {
        const result = await dialog.showOpenDialog(this.mainWindow!, {
          title: 'Load Videos Backup',
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });

        if (!result.canceled && result.filePaths.length > 0) {
          const success = await this.youtubeManager.loadVideosFromFile(result.filePaths[0]);
          if (success) {
            return { success: true, videos: this.youtubeManager.getVideos() };
          }
          return { success: false, message: 'Failed to load file' };
        }

        return { success: false, cancelled: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('youtube:get-thumbnail', async (_, filename: string) => {
      const thumbnailPath = await this.youtubeManager.getThumbnailPath(filename);
      return { thumbnailPath };
    });

    ipcMain.handle('youtube:get-channel-info', async () => {
      const channelInfo = await this.youtubeManager.getChannelInfo();
      return { channelInfo };
    });

    ipcMain.handle('youtube:check-credentials', async () => {
      return this.youtubeManager.checkCredentials();
    });

    ipcMain.handle('youtube:get-videos', async () => {
      return { videos: this.youtubeManager.getVideos() };
    });

    ipcMain.handle('i18n:get-available-languages', async () => {
      return { languages: i18n.getAvailableLanguages() };
    });

    ipcMain.handle('i18n:get-current-language', async () => {
      return { language: i18n.getCurrentLanguage() };
    });

    ipcMain.handle('youtube:select-credentials-file', async () => {
      return await this.youtubeManager.selectCredentialsFile(this.mainWindow!);
    });

    ipcMain.handle('youtube:remove-stored-credentials', async () => {
      return await this.youtubeManager.removeStoredCredentials();
    });

    ipcMain.handle('youtube:clear-cache', async () => {
      return await this.youtubeManager.clearCache();
    });

    ipcMain.handle('youtube:get-video-categories', async () => {
      const categories = await this.youtubeManager.getVideoCategories();
      return { categories };
    });
  }
}

new ElectronApp();