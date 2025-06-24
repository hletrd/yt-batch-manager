import rendererI18n from './i18n/renderer-i18n.js';

interface YouTubeAPI {
  authenticate: () => Promise<{ success: boolean; error?: string }>;
  loadVideos: () => Promise<any>;
  updateVideo: (data: { video_id: string; title: string; description: string }) => Promise<any>;
  updateVideosBatch: (data: { updates: Array<{ video_id: string; title: string; description: string }> }) => Promise<any>;
  saveVideos: () => Promise<any>;
  loadFromFile: () => Promise<any>;
  downloadVideoInfo: () => Promise<any>;
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
}

declare global {
  interface Window {
    youtubeAPI: YouTubeAPI;
    electronAPI: {
      ipcRenderer: {
        on: (channel: string, func: (...args: any[]) => void) => void;
        removeAllListeners: (channel: string) => void;
      };
    };
  }
}

interface VideoData {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  thumbnails: Record<string, ThumbnailData>;
  published_at: string;
  privacy_status: string;
}

interface ThumbnailData {
  url: string;
  width: number;
  height: number;
}

interface AppState {
  changedVideos: Set<string>;
  allVideos: VideoData[];
  displayedVideos: VideoData[];
  currentSort: string;
  videosPerPage: number;
  currentPage: number;
  isLoading: boolean;
}

interface FindResult {
  activeMatchOrdinal: number;
  matches: number;
  currentMatch?: {
    element: HTMLElement;
    videoId: string;
    type: 'title' | 'description';
  };
}

interface SearchMatch {
  element: HTMLInputElement | HTMLTextAreaElement;
  videoId: string;
  type: 'title' | 'description';
  text: string;
  index: number;
}

class YouTubeBatchManager {
  private state: AppState = {
    changedVideos: new Set(),
    allVideos: [],
    displayedVideos: [],
    currentSort: 'date-desc',
    videosPerPage: 20,
    currentPage: 0,
    isLoading: false,
  };

  private currentSearchText: string = '';
  private searchMatches: SearchMatch[] = [];
  private currentMatchIndex: number = -1;
  private findBarVisible: boolean = false;
  private saveInProgress: Set<string> = new Set();
  private batchSaveInProgress: boolean = false;

  constructor() {
    this.initializeTheme();
    this.setupEventListeners();
    this.setupFindListeners();
    this.initializeApp();
  }

  private initializeTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    this.updateThemeIcon(theme);
  }

  private updateThemeIcon(theme: string): void {
    const iconPath = document.getElementById('theme-icon-path');
    if (iconPath) {
      if (theme === 'dark') {
        iconPath.setAttribute('d', 'M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93');
      } else {
        iconPath.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
      }
    }
  }

  private setTheme(theme: string): void {
    document.documentElement.setAttribute('data-theme', theme);
    this.updateThemeIcon(theme);
    localStorage.setItem('theme', theme);
  }

  toggleTheme(): void {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
  }

  private showStatus(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    const statusEl = document.getElementById('status-message');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `status-message status-${type} show`;

      setTimeout(() => {
        statusEl.classList.remove('show');
      }, 3000);
    }
  }

  private showCredentialsError(errorMessage: string, credentialsPath?: string): void {
    const videoList = document.getElementById('video-list');
    if (!videoList) return;

    videoList.innerHTML = `
      <div class="credentials-error">
        <div class="error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3>${rendererI18n.t('credentials.required')}</h3>
        <p>${rendererI18n.t('credentials.pleaseSelectCredentials')}</p>
        <div class="credentials-help">
          <h4>${rendererI18n.t('credentials.setupInstructions')}</h4>
          <ol>
            <li><a href="#" onclick="window.youtubeAPI.openExternal?.('${rendererI18n.t('urls.googleCloudConsole')}') || alert('${rendererI18n.t('urls.pleaseVisit')}')">${rendererI18n.t('credentials.step1')}</a></li>
            <li>${rendererI18n.t('credentials.step2')}</li>
            <li>${rendererI18n.t('credentials.step3')}</li>
            <li>${rendererI18n.t('credentials.step4')}</li>
            <li>${rendererI18n.t('credentials.step5')}</li>
            <li>${rendererI18n.t('credentials.step6')}</li>
          </ol>
        </div>
        <div class="credentials-actions">
          <button class="btn btn-primary" onclick="app.selectCredentialsFile()">
            ${rendererI18n.t('buttons.selectCredentialsFile')}
          </button>
        </div>
      </div>
    `;
  }

  private markChanged(videoId: string): void {
    this.state.changedVideos.add(videoId);
    const updateBtn = document.getElementById(`update-btn-${videoId}`);
    if (updateBtn) {
      updateBtn.style.display = 'inline-block';
    }
    this.updateSaveAllButton();
  }

  private unmarkChanged(videoId: string): void {
    this.state.changedVideos.delete(videoId);
    const updateBtn = document.getElementById(`update-btn-${videoId}`);
    if (updateBtn) {
      updateBtn.style.display = 'none';
    }
    this.updateSaveAllButton();
  }

  private updateSaveAllButton(): void {
    const saveAllBtn = document.getElementById('save-all-btn');

    if (this.state.changedVideos.size > 0) {
      if (saveAllBtn) {
        saveAllBtn.style.display = 'flex';
        saveAllBtn.textContent = rendererI18n.t('buttons.saveAllCount', { count: this.state.changedVideos.size });
      }
    } else {
      if (saveAllBtn) saveAllBtn.style.display = 'none';
    }
  }

  private hasCurrentChanges(videoId: string, savedTitle: string, savedDescription: string): boolean {
    const titleInput = document.getElementById(`title-${videoId}`) as HTMLInputElement;
    const descriptionInput = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
    const originalVideo = this.state.allVideos.find(v => v.id === videoId);

    if (!titleInput || !descriptionInput || !originalVideo) return false;

    const currentTitle = titleInput.value;
    const currentDescription = descriptionInput.value;

    return (currentTitle !== savedTitle || currentDescription !== savedDescription) &&
           (currentTitle !== originalVideo.title || currentDescription !== originalVideo.description);
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    const scrollTop = textarea.scrollTop;
    textarea.style.height = 'auto';
    const newHeight = Math.max(140, textarea.scrollHeight);
    textarea.style.height = newHeight + 'px';
    textarea.scrollTop = scrollTop;
  }

  private initializeTextarea(videoId: string): void {
    const textarea = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
    if (textarea) {
      textarea.style.height = 'auto';
      requestAnimationFrame(() => {
        this.autoResizeTextarea(textarea);
      });
    }
  }

  private updateTitleCounter(videoId: string): void {
    const titleInput = document.getElementById(`title-${videoId}`) as HTMLInputElement;
    const counter = document.getElementById(`title-counter-${videoId}`);

    if (titleInput && counter) {
      const length = titleInput.value.length;
      counter.textContent = `${length}/100`;

      if (length > 100) {
        counter.classList.add('warning');
      } else {
        counter.classList.remove('warning');
      }
    }
  }

  async saveAllChanges(): Promise<void> {
    if (this.state.changedVideos.size === 0) return;

    const saveAllBtn = document.getElementById('save-all-btn') as HTMLButtonElement;
    const originalText = saveAllBtn.innerHTML;

    saveAllBtn.disabled = true;
    saveAllBtn.innerHTML = 'Saving...';

    this.batchSaveInProgress = true;

    const savedData = new Map<string, {title: string, description: string}>();

    const updates = Array.from(this.state.changedVideos).map(videoId => {
      const titleInput = document.getElementById(`title-${videoId}`) as HTMLInputElement;
      const descriptionInput = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;

      const title = titleInput.value;
      const description = descriptionInput.value;

      savedData.set(videoId, { title, description });

      return {
        video_id: videoId,
        title,
        description,
      };
    });

    this.showStatus(rendererI18n.t('status.savingVideos', { count: updates.length }), 'info');

    try {
      const result = await window.youtubeAPI.updateVideosBatch({ updates });

      if (result.success) {
        const successCount = result.results?.successful?.length || updates.length;
        const failCount = result.results?.failed?.length || 0;

        if (failCount > 0) {
          this.showStatus(rendererI18n.t('status.videosUpdatedWithFailures', { successCount, failCount }), 'info');
        } else {
          this.showStatus(rendererI18n.t('status.allVideosUpdatedSuccessfully', { successCount }), 'success');
        }

        const successfulUpdates = result.results?.successful || [];
        const processedVideos = new Set<string>();

        if (successfulUpdates.length > 0) {
          successfulUpdates.forEach((update: { video_id: string; title: string }) => {
            const videoId = update.video_id;
            const saved = savedData.get(videoId);
            if (!saved) return;

            processedVideos.add(videoId);

            const videoTitleEl = document.querySelector(`[data-video-id="${videoId}"] .video-title`);
            if (videoTitleEl) {
              videoTitleEl.textContent = saved.title;
            }

            const videoIndex = this.state.allVideos.findIndex(v => v.id === videoId);
            if (videoIndex !== -1) {
              this.state.allVideos[videoIndex].title = saved.title;
              this.state.allVideos[videoIndex].description = saved.description;
            }
          });
        } else {
          Array.from(this.state.changedVideos).forEach((videoId: string) => {
            const saved = savedData.get(videoId);
            if (!saved) return;

            processedVideos.add(videoId);

            const videoTitleEl = document.querySelector(`[data-video-id="${videoId}"] .video-title`);
            if (videoTitleEl) {
              videoTitleEl.textContent = saved.title;
            }

            const videoIndex = this.state.allVideos.findIndex(v => v.id === videoId);
            if (videoIndex !== -1) {
              this.state.allVideos[videoIndex].title = saved.title;
              this.state.allVideos[videoIndex].description = saved.description;
            }
          });
        }

        processedVideos.forEach(videoId => {
          const saved = savedData.get(videoId);
          if (!saved) return;

          if (!this.hasCurrentChanges(videoId, saved.title, saved.description)) {
            this.state.changedVideos.delete(videoId);
            const updateBtn = document.getElementById(`update-btn-${videoId}`);
            if (updateBtn) {
              updateBtn.style.display = 'none';
            }
          }
        });

        this.updateSaveAllButton();
      } else {
        this.showStatus(rendererI18n.t('status.failedToUpdateVideo'), 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus(rendererI18n.t('status.errorUpdatingVideo'), 'error');
    } finally {
      saveAllBtn.disabled = false;
      saveAllBtn.innerHTML = originalText;
      this.batchSaveInProgress = false;
    }
  }

  toggleMobileMenu(): void {
    const mobileMenu = document.getElementById('mobile-menu');
    const burgerMenu = document.querySelector('.burger-menu');

    if (window.innerWidth <= 768) {
      mobileMenu?.classList.toggle('hide');
      burgerMenu?.classList.toggle('active');
    }
  }

  toggleDropdown(): void {
    const dropdown = document.querySelector('.dropdown');
    dropdown?.classList.toggle('show');
  }

  toggleFileDropdown(): void {
    const fileDropdown = document.getElementById('file-dropdown-content');
    const dropdown = fileDropdown?.closest('.dropdown');
    dropdown?.classList.toggle('show');
  }

  sortVideos(sortType: string): void {
    this.state.currentSort = sortType;
    const sortKeys: Record<string, string> = {
      'date-desc': 'sorting.dateNewestFirst',
      'date-asc': 'sorting.dateOldestFirst',
      'title-asc': 'sorting.titleAZ',
      'title-desc': 'sorting.titleZA',
    };

    const currentSortEl = document.getElementById('current-sort');
    if (currentSortEl) {
      currentSortEl.textContent = rendererI18n.t(sortKeys[sortType]);
    }

    document.querySelector('.dropdown')?.classList.remove('show');

    this.sortAllVideos();
    this.state.currentPage = 0;
    this.renderVideos(true);
  }

  private sortAllVideos(): void {
    switch(this.state.currentSort) {
      case 'date-desc':
        this.state.allVideos.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
        break;
      case 'date-asc':
        this.state.allVideos.sort((a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime());
        break;
      case 'title-asc':
        this.state.allVideos.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'title-desc':
        this.state.allVideos.sort((a, b) => b.title.localeCompare(a.title));
        break;
    }
  }

  async loadVideos(): Promise<void> {
    this.showStatus(rendererI18n.t('status.authenticatingAndLoadingVideos'), 'info');

    try {
      const authResult = await window.youtubeAPI.authenticate();
      if (!authResult.success) {
        this.showStatus(authResult.error || rendererI18n.t('status.authenticationFailed'), 'error');
        return;
      }

      await this.loadChannelInfo();

      const result = await window.youtubeAPI.loadVideos();

      if (result.success) {
        this.state.allVideos = result.videos;
        this.sortAllVideos();
        this.state.currentPage = 0;
        this.renderVideos(true);
        this.showStatus(rendererI18n.t('status.videosLoadedSuccessfully', { count: result.count }), 'success');

        const saveJsonLink = document.getElementById('save-json-link') as HTMLAnchorElement;
        if (saveJsonLink) {
          saveJsonLink.style.pointerEvents = 'auto';
          saveJsonLink.style.opacity = '1';
        }
      } else {
        this.showStatus(result.error || rendererI18n.t('errors.errorLoadingVideos'), 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus(rendererI18n.t('status.errorLoadingVideos'), 'error');
    }
  }

  async loadChannelInfo(): Promise<void> {
    try {
      const result = await window.youtubeAPI.getChannelInfo();
      if (result.channelInfo) {
        const { name, thumbnail } = result.channelInfo;

        const channelInfoDiv = document.getElementById('channel-info');
        const channelName = document.getElementById('channel-name');
        const channelAvatar = document.getElementById('channel-avatar') as HTMLImageElement;
        const mainContent = document.getElementById('main-content');

        if (channelName) channelName.textContent = name;

        if (channelAvatar && thumbnail) {
          channelAvatar.src = thumbnail;
          channelAvatar.style.display = 'block';
        }

        if (channelInfoDiv) channelInfoDiv.classList.add('show');
        if (mainContent) mainContent.classList.add('with-channel');
      }
    } catch (error) {
      console.error('Error loading channel info:', error);
    }
  }

  async downloadVideoInfo(): Promise<void> {
    this.showStatus(rendererI18n.t('status.preparingDownload'), 'info');

    try {
      const result = await window.youtubeAPI.downloadVideoInfo();

      if (result.success && !result.cancelled) {
        this.showStatus(rendererI18n.t('status.videosSavedSuccessfully'), 'success');
      } else if (result.cancelled) {
        this.showStatus(rendererI18n.t('status.downloadCancelled'), 'info');
      } else {
        this.showStatus(result.error || rendererI18n.t('status.errorSavingVideos'), 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus(rendererI18n.t('status.errorSavingVideos'), 'error');
    }
  }

  async loadFromFile(): Promise<void> {
    this.showStatus(rendererI18n.t('status.loadingVideosFromFile'), 'info');

    try {
      const result = await window.youtubeAPI.loadJsonFile();

      if (result.success && !result.cancelled) {
        this.state.allVideos = result.videos;
        this.sortAllVideos();
        this.state.currentPage = 0;
        this.renderVideos(true);
        this.showStatus(rendererI18n.t('status.videosLoadedFromFileSuccessfully'), 'success');

        const saveJsonLink = document.getElementById('save-json-link') as HTMLAnchorElement;
        if (saveJsonLink) {
          saveJsonLink.style.pointerEvents = 'auto';
          saveJsonLink.style.opacity = '1';
        }
      } else if (result.cancelled) {
        this.showStatus(rendererI18n.t('status.fileSelectionCancelled'), 'info');
      } else {
        this.showStatus(result.message || result.error || rendererI18n.t('status.failedToLoadVideosFromFile'), 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus(rendererI18n.t('status.failedToLoadVideosFromFile'), 'error');
    }
  }

  async updateVideo(videoId: string): Promise<void> {
    const titleInput = document.getElementById(`title-${videoId}`) as HTMLInputElement;
    const descriptionInput = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
    const updateBtn = document.getElementById(`update-btn-${videoId}`) as HTMLButtonElement;

    updateBtn.disabled = true;
    updateBtn.textContent = 'Updating...';

    this.saveInProgress.add(videoId);

    const savedTitle = titleInput.value;
    const savedDescription = descriptionInput.value;

    try {
      const result = await window.youtubeAPI.updateVideo({
        video_id: videoId,
        title: savedTitle,
        description: savedDescription,
      });

      if (result.success) {
        this.showStatus(rendererI18n.t('status.videoUpdatedSuccessfully'), 'success');

        const videoTitleEl = document.querySelector(`[data-video-id="${videoId}"] .video-title`);
        if (videoTitleEl) {
          videoTitleEl.textContent = savedTitle;
        }

        const videoIndex = this.state.allVideos.findIndex(v => v.id === videoId);
        if (videoIndex !== -1) {
          this.state.allVideos[videoIndex].title = savedTitle;
          this.state.allVideos[videoIndex].description = savedDescription;
        }

        if (!this.hasCurrentChanges(videoId, savedTitle, savedDescription)) {
          this.state.changedVideos.delete(videoId);
          updateBtn.style.display = 'none';
        }
        this.updateSaveAllButton();
      } else {
        this.showStatus(rendererI18n.t('status.failedToUpdateVideo'), 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus(rendererI18n.t('status.errorUpdatingVideo'), 'error');
    } finally {
      updateBtn.disabled = false;
      updateBtn.textContent = 'Update Video';
      this.saveInProgress.delete(videoId);
    }
  }

  private async getThumbnailDataUrl(filename: string): Promise<string> {
    try {
      const result = await window.youtubeAPI.getThumbnail(filename);
      if (result.thumbnailPath) {
        return `file://${result.thumbnailPath}`;
      }
    } catch (error) {
      console.error('Error getting thumbnail:', error);
    }

    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjkwIiB2aWV3Qm94PSIwIDAgMTIwIDkwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjkwIiBmaWxsPSIjRkZGIiBzdHJva2U9IiNEREQiLz4KPHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4PSI0MCIgeT0iMjUiPgo8cGF0aCBkPSJNMzUgMjBMMTAgMzBWMTBMMzUgMjBaIiBmaWxsPSIjQ0NDIi8+Cjwvc3ZnPgo8L3N2Zz4K';
  }

  private renderVideos(clear: boolean = false): void {
    const videoList = document.getElementById('video-list');
    if (!videoList) return;

    if (clear) {
      videoList.innerHTML = '';
      this.state.displayedVideos = [];
    }

    const startIndex = this.state.currentPage * this.state.videosPerPage;
    const endIndex = startIndex + this.state.videosPerPage;
    const videosToAdd = this.state.allVideos.slice(startIndex, endIndex);

    if (videosToAdd.length === 0) {
      if (this.state.allVideos.length === 0) {
        videoList.innerHTML = `
          <div class="no-videos">
            <h3>${rendererI18n.t('app.noVideosLoaded')}</h3>
            <p>${rendererI18n.t('app.noVideosLoadedDescription')}</p>
          </div>
        `;
      }
      return;
    }

    videosToAdd.forEach(async (video) => {
      const thumbnailUrl = await this.getThumbnailDataUrl(video.thumbnail_url.replace('cache://', ''));

      const videoHTML = `
        <div class="video-item" data-video-id="${video.id}">
          <div class="video-header">
            <div class="video-thumbnail">
              <img
                src="${thumbnailUrl}"
                alt="Thumbnail"
                loading="lazy"
                onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjkwIiB2aWV3Qm94PSIwIDAgMTIwIDkwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjkwIiBmaWxsPSIjRkZGIiBzdHJva2U9IiNEREQiLz4KPHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4PSI0MCIgeT0iMjUiPgo8cGF0aCBkPSJNMzUgMjBMMTAgMzBWMTBMMzUgMjBaIiBmaWxsPSIjQ0NDIi8+Cjwvc3ZnPgo8L3N2Zz4K'"
              />
            </div>
            <div class="video-info">
              <a href="https://www.youtube.com/watch?v=${video.id}" target="_blank" class="video-id-link">
                https://youtu.be/watch?v=${video.id}
              </a>
              <div class="video-title">${this.escapeHtml(video.title)}</div>
              <div class="video-published">
                ${rendererI18n.t('app.published')}: ${video.published_at.substring(0, 10)}
                ${video.privacy_status ? `<span class="privacy-status">${rendererI18n.t(`privacy.${video.privacy_status}`) || rendererI18n.t('privacy.unknown')}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="form-group">
            <label for="title-${video.id}">${rendererI18n.t('form.title')}</label>
            <input
              type="text"
              class="form-control title-input"
              id="title-${video.id}"
              value="${this.escapeHtml(video.title)}"
              oninput="app.handleTitleChange('${video.id}'); app.updateTitleCounter('${video.id}')"
            />
            <div class="title-counter" id="title-counter-${video.id}">${video.title.length}/100</div>
          </div>

          <div class="form-group">
            <label for="description-${video.id}">${rendererI18n.t('form.description')}</label>
            <textarea
              class="form-control"
              id="description-${video.id}"
              oninput="app.handleDescriptionChange('${video.id}'); app.handleTextareaResize(this)"
            >${this.escapeHtml(video.description)}</textarea>
          </div>

          <div class="video-actions">
            <button class="btn btn-success" onclick="app.updateVideo('${video.id}')" id="update-btn-${video.id}" style="display: none;">
              ${rendererI18n.t('buttons.updateVideoInfo')}
            </button>
          </div>
        </div>
      `;

      videoList.insertAdjacentHTML('beforeend', videoHTML);

      requestAnimationFrame(() => {
        setTimeout(() => {
          const textarea = document.getElementById(`description-${video.id}`) as HTMLTextAreaElement;
          if (textarea) {
            textarea.style.height = 'auto';
            this.autoResizeTextarea(textarea);
          }
          this.updateTitleCounter(video.id);

          if (this.findBarVisible) {
            this.setupInputEditListenersForVideo(video.id);
          }
        }, 10);
      });
    });

    this.state.displayedVideos = this.state.displayedVideos.concat(videosToAdd);
    this.state.currentPage++;
    this.state.isLoading = false;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  handleTitleChange(videoId: string): void {
    const titleInput = document.getElementById(`title-${videoId}`) as HTMLInputElement;
    const originalVideo = this.state.allVideos.find(v => v.id === videoId);

    if (titleInput && originalVideo && titleInput.value !== originalVideo.title) {
      this.markChanged(videoId);
    } else if (titleInput && originalVideo && titleInput.value === originalVideo.title) {
      this.unmarkChanged(videoId);
    }
  }

  handleDescriptionChange(videoId: string): void {
    const descriptionInput = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
    const originalVideo = this.state.allVideos.find(v => v.id === videoId);

    if (descriptionInput && originalVideo && descriptionInput.value !== originalVideo.description) {
      this.markChanged(videoId);
    } else if (descriptionInput && originalVideo && descriptionInput.value === originalVideo.description) {
      this.unmarkChanged(videoId);
    }
  }

  handleTextareaResize(textarea: HTMLTextAreaElement): void {
    this.autoResizeTextarea(textarea);
  }

  private handleScroll(): void {
    if (this.state.isLoading || this.state.displayedVideos.length >= this.state.allVideos.length) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    if (scrollTop + windowHeight >= documentHeight - 1000) {
      this.state.isLoading = true;
      this.renderVideos();
    }
  }

  private setupEventListeners(): void {
    window.addEventListener('scroll', () => this.handleScroll());

    window.addEventListener('beforeunload', (event) => {
      if (this.state.changedVideos.size > 0) {
        const message = `You have ${this.state.changedVideos.size} unsaved changes. Are you sure you want to leave?`;
        event.preventDefault();
        event.returnValue = message;
        return message;
      }
      return undefined;
    });

    document.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('.dropdown')) {
        document.querySelectorAll('.dropdown')?.forEach(dropdown => dropdown.classList.remove('show'));
      }
      if (window.innerWidth <= 768 && !(event.target as Element).closest('.header-content')) {
        const mobileMenu = document.getElementById('mobile-menu');
        const burgerMenu = document.querySelector('.burger-menu');
        if (!mobileMenu?.classList.contains('hide')) {
          mobileMenu?.classList.add('hide');
          burgerMenu?.classList.remove('active');
        }
      }
    });

    window.addEventListener('resize', () => {
      const mobileMenu = document.getElementById('mobile-menu');
      const burgerMenu = document.querySelector('.burger-menu');
      if (window.innerWidth > 768) {
        mobileMenu?.classList.remove('hide');
        burgerMenu?.classList.remove('active');
      }
    });

    setInterval(() => {
      if (this.state.changedVideos.size > 0) {
        console.log(`${this.state.changedVideos.size} videos have unsaved changes`);
      }
    }, 30000);
  }

  async removeSavedCredentials(): Promise<void> {
    const confirmation = confirm(
      `${rendererI18n.t('dialog.confirmRemoveCredentials')}\n\n${rendererI18n.t('dialog.confirmRemoveCredentialsMessage')}`
    );

    if (!confirmation) return;

    try {
      const result = await window.youtubeAPI.removeStoredCredentials();
      if (result.success) {
        this.showStatus(rendererI18n.t('credentials.credentialsRemovedSuccessfully'), 'success');
        setTimeout(() => {
          location.reload();
        }, 1500);
      } else {
        this.showStatus(result.error || 'Error removing credentials', 'error');
      }
    } catch (error) {
      this.showStatus('Error removing credentials', 'error');
    }
  }

  async deleteCache(): Promise<void> {
    const confirmation = confirm(
      `${rendererI18n.t('dialog.confirmClearCache')}\n\n${rendererI18n.t('dialog.confirmClearCacheMessage')}`
    );

    if (!confirmation) return;

    try {
      const result = await window.youtubeAPI.clearCache();
      if (result.success) {
        this.showStatus(rendererI18n.t('credentials.cacheDeletedSuccessfully'), 'success');
      } else {
        this.showStatus(result.error || 'Error clearing cache', 'error');
      }
    } catch (error) {
      this.showStatus('Error clearing cache', 'error');
    }
  }

  async selectCredentialsFile(): Promise<void> {
    try {
      const result = await window.youtubeAPI.selectCredentialsFile();
      if (result.success) {
        this.showStatus(rendererI18n.t('credentials.credentialsSelectedSuccessfully'), 'success');
        setTimeout(() => {
          location.reload();
        }, 1500);
      } else if (!result.cancelled) {
        this.showStatus(result.error || 'Error selecting credentials file', 'error');
      }
    } catch (error) {
      this.showStatus('Error selecting credentials file', 'error');
    }
  }

  private setupFindListeners(): void {
    window.electronAPI.ipcRenderer.on('show-find', () => {
      this.showFindBar();
    });

    window.electronAPI.ipcRenderer.on('hide-find', () => {
      this.hideFindBar();
    });

    window.electronAPI.ipcRenderer.on('find-next', () => {
      this.findNext();
    });

    window.electronAPI.ipcRenderer.on('find-previous', () => {
      this.findPrevious();
    });

    const findInput = document.getElementById('find-input') as HTMLInputElement;
    const findNext = document.getElementById('find-next') as HTMLButtonElement;
    const findPrevious = document.getElementById('find-previous') as HTMLButtonElement;
    const findClose = document.getElementById('find-close') as HTMLButtonElement;

    if (findInput) {
      findInput.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        this.currentSearchText = target.value;
        if (target.value) {
          this.performFind(target.value);
        } else {
          this.clearFind();
        }
      });

      findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const currentValue = (e.target as HTMLInputElement).value;
          if (currentValue.trim()) {
            if (this.searchMatches.length > 0) {
              if (e.shiftKey) {
                this.findPrevious();
              } else {
                this.findNext();
              }
            } else {
              this.performFind(currentValue);
            }
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.hideFindBar();
        }
      });
    }

    if (findNext) {
      findNext.addEventListener('click', () => this.findNext());
    }

    if (findPrevious) {
      findPrevious.addEventListener('click', () => this.findPrevious());
    }

    if (findClose) {
      findClose.addEventListener('click', () => this.hideFindBar());
    }
  }

    private showFindBar(): void {
    const findBar = document.getElementById('find-bar');
    const findInput = document.getElementById('find-input') as HTMLInputElement;

    if (findBar) {
      findBar.classList.remove('hidden');
      this.findBarVisible = true;

      rendererI18n.updatePageTexts();

      this.setupInputEditListeners();

      setTimeout(() => {
        if (findInput && this.findBarVisible) {
          findInput.focus();
          findInput.select();
        }
      }, 200);
    }
  }

  private hideFindBar(): void {
    const findBar = document.getElementById('find-bar');

    if (findBar) {
      findBar.classList.add('hidden');
      this.findBarVisible = false;
      this.removeInputEditListeners();
      this.clearFind();

      document.querySelectorAll('.search-highlight-container').forEach(el => {
        el.classList.remove('search-highlight-container');
      });
      document.querySelectorAll('[data-search-highlight]').forEach(el => {
        el.removeAttribute('data-search-highlight');
        el.removeAttribute('data-search-text');
        el.classList.remove('search-text-match');
      });
    }
  }

  private setupInputEditListeners(): void {
    const titleInputs = document.querySelectorAll('input[id^="title-"]') as NodeListOf<HTMLInputElement>;
    const descriptionTextareas = document.querySelectorAll('textarea[id^="description-"]') as NodeListOf<HTMLTextAreaElement>;

    const handleInputEdit = () => {
      if (this.findBarVisible) {
        this.hideFindBar();
      }
    };

    titleInputs.forEach(input => {
      input.addEventListener('input', handleInputEdit);
      input.addEventListener('keydown', handleInputEdit);
      (input as any)._findEditHandler = handleInputEdit;
    });

    descriptionTextareas.forEach(textarea => {
      textarea.addEventListener('input', handleInputEdit);
      textarea.addEventListener('keydown', handleInputEdit);
      (textarea as any)._findEditHandler = handleInputEdit;
    });
  }

  private setupInputEditListenersForVideo(videoId: string): void {
    const titleInput = document.getElementById(`title-${videoId}`) as HTMLInputElement;
    const descriptionTextarea = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;

    const handleInputEdit = () => {
      if (this.findBarVisible) {
        this.hideFindBar();
      }
    };

    if (titleInput && !(titleInput as any)._findEditHandler) {
      titleInput.addEventListener('input', handleInputEdit);
      titleInput.addEventListener('keydown', handleInputEdit);
      (titleInput as any)._findEditHandler = handleInputEdit;
    }

    if (descriptionTextarea && !(descriptionTextarea as any)._findEditHandler) {
      descriptionTextarea.addEventListener('input', handleInputEdit);
      descriptionTextarea.addEventListener('keydown', handleInputEdit);
      (descriptionTextarea as any)._findEditHandler = handleInputEdit;
    }
  }

  private removeInputEditListeners(): void {
    const titleInputs = document.querySelectorAll('input[id^="title-"]') as NodeListOf<HTMLInputElement>;
    const descriptionTextareas = document.querySelectorAll('textarea[id^="description-"]') as NodeListOf<HTMLTextAreaElement>;

    titleInputs.forEach(input => {
      const handler = (input as any)._findEditHandler;
      if (handler) {
        input.removeEventListener('input', handler);
        input.removeEventListener('keydown', handler);
        delete (input as any)._findEditHandler;
      }
    });

    descriptionTextareas.forEach(textarea => {
      const handler = (textarea as any)._findEditHandler;
      if (handler) {
        textarea.removeEventListener('input', handler);
        textarea.removeEventListener('keydown', handler);
        delete (textarea as any)._findEditHandler;
      }
    });
  }

    private performFind(text: string): void {
    if (!text.trim()) {
      this.clearFind();
      return;
    }

    this.searchMatches = [];
    this.currentMatchIndex = -1;

    const titleInputs = document.querySelectorAll('input[id^="title-"]') as NodeListOf<HTMLInputElement>;
    const descriptionTextareas = document.querySelectorAll('textarea[id^="description-"]') as NodeListOf<HTMLTextAreaElement>;

    titleInputs.forEach((input) => {
      const videoId = input.id.replace('title-', '');
      const inputText = input.value.toLowerCase();
      const searchText = text.toLowerCase();

      if (inputText.includes(searchText)) {
        this.searchMatches.push({
          element: input,
          videoId,
          type: 'title',
          text: input.value,
          index: inputText.indexOf(searchText)
        });
      }
    });

    descriptionTextareas.forEach((textarea) => {
      const videoId = textarea.id.replace('description-', '');
      const textareaText = textarea.value.toLowerCase();
      const searchText = text.toLowerCase();

      if (textareaText.includes(searchText)) {
        this.searchMatches.push({
          element: textarea,
          videoId,
          type: 'description',
          text: textarea.value,
          index: textareaText.indexOf(searchText)
        });
      }
    });

    this.searchMatches.sort((a, b) => {
      const aPosition = Array.from(document.querySelectorAll('[data-video-id]')).findIndex(el => el.getAttribute('data-video-id') === a.videoId);
      const bPosition = Array.from(document.querySelectorAll('[data-video-id]')).findIndex(el => el.getAttribute('data-video-id') === b.videoId);

      if (aPosition !== bPosition) {
        return aPosition - bPosition;
      }

      if (a.type === 'title' && b.type === 'description') return -1;
      if (a.type === 'description' && b.type === 'title') return 1;

      return 0;
    });

    if (this.searchMatches.length > 0) {
      this.currentMatchIndex = 0;
      this.highlightCurrentMatch();
    } else {
      setTimeout(() => {
        const findInput = document.getElementById('find-input') as HTMLInputElement;
        if (findInput && this.findBarVisible) {
          findInput.focus();
        }
      }, 50);
    }

    this.updateFindResults({
      activeMatchOrdinal: this.searchMatches.length > 0 ? 1 : 0,
      matches: this.searchMatches.length,
      currentMatch: this.searchMatches.length > 0 ? {
        element: this.searchMatches[0].element,
        videoId: this.searchMatches[0].videoId,
        type: this.searchMatches[0].type
      } : undefined
    });
  }

  private findNext(): void {
    if (!this.currentSearchText || this.searchMatches.length === 0) return;

    this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
    this.highlightCurrentMatch();
    this.updateFindResults({
      activeMatchOrdinal: this.currentMatchIndex + 1,
      matches: this.searchMatches.length,
      currentMatch: {
        element: this.searchMatches[this.currentMatchIndex].element,
        videoId: this.searchMatches[this.currentMatchIndex].videoId,
        type: this.searchMatches[this.currentMatchIndex].type
      }
    });
  }

  private findPrevious(): void {
    if (!this.currentSearchText || this.searchMatches.length === 0) return;

    this.currentMatchIndex = this.currentMatchIndex <= 0 ? this.searchMatches.length - 1 : this.currentMatchIndex - 1;
    this.highlightCurrentMatch();
    this.updateFindResults({
      activeMatchOrdinal: this.currentMatchIndex + 1,
      matches: this.searchMatches.length,
      currentMatch: {
        element: this.searchMatches[this.currentMatchIndex].element,
        videoId: this.searchMatches[this.currentMatchIndex].videoId,
        type: this.searchMatches[this.currentMatchIndex].type
      }
    });
  }

  private highlightCurrentMatch(): void {
    if (this.currentMatchIndex < 0 || this.currentMatchIndex >= this.searchMatches.length) return;

    const match = this.searchMatches[this.currentMatchIndex];
    const element = match.element;

    document.querySelectorAll('.search-highlight-container').forEach(el => {
      el.classList.remove('search-highlight-container');
    });

    element.classList.add('search-highlight-container');

    const videoElement = element.closest('[data-video-id]');
    if (videoElement) {
      videoElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    this.createTextHighlightOverlay(element, this.currentSearchText);

    setTimeout(() => {
      const findInput = document.getElementById('find-input') as HTMLInputElement;
      if (findInput && this.findBarVisible) {
        findInput.focus();
      }
    }, 0);
  }

    private createTextHighlightOverlay(element: HTMLInputElement | HTMLTextAreaElement, searchText: string): void {
    document.querySelectorAll('[data-search-highlight]').forEach(el => {
      el.removeAttribute('data-search-highlight');
      el.removeAttribute('data-search-text');
    });

    const text = element.value;
    const searchLower = searchText.toLowerCase();
    const textLower = text.toLowerCase();
    const startIndex = textLower.indexOf(searchLower);

    if (startIndex === -1) return;

    element.setAttribute('data-search-highlight', 'true');
    element.setAttribute('data-search-text', searchText);

    element.classList.add('search-text-match');

    setTimeout(() => {
      element.removeAttribute('data-search-highlight');
      element.removeAttribute('data-search-text');
      element.classList.remove('search-text-match');
    }, 2000);
  }

  private clearFind(): void {
    this.searchMatches = [];
    this.currentMatchIndex = -1;
    this.updateFindResults({ activeMatchOrdinal: 0, matches: 0 });

    document.querySelectorAll('.search-highlight-container').forEach(el => {
      el.classList.remove('search-highlight-container');
    });
    document.querySelectorAll('[data-search-highlight]').forEach(el => {
      el.removeAttribute('data-search-highlight');
      el.removeAttribute('data-search-text');
      el.classList.remove('search-text-match');
    });
  }

  private updateFindResults(result: FindResult): void {
    const findResults = document.getElementById('find-results');
    const findNext = document.getElementById('find-next') as HTMLButtonElement;
    const findPrevious = document.getElementById('find-previous') as HTMLButtonElement;

    if (findResults) {
      if (result.matches === 0) {
        findResults.textContent = rendererI18n.t('find.noResults');
      } else if (result.matches === 1) {
        findResults.textContent = rendererI18n.t('find.oneResult');
      } else {
        findResults.textContent = rendererI18n.t('find.resultsCount', {
          current: result.activeMatchOrdinal,
          total: result.matches
        });
      }
    }

    if (findNext && findPrevious) {
      const hasResults = result.matches > 0;
      findNext.disabled = !hasResults;
      findPrevious.disabled = !hasResults;
    }
  }

  private async initializeApp(): Promise<void> {
    try {
      await rendererI18n.waitForInitialization();
      rendererI18n.updatePageTexts();

      const credentialsCheck = await window.youtubeAPI.checkCredentials();
      if (!credentialsCheck.success) {
        this.showCredentialsError(credentialsCheck.error!, credentialsCheck.path);
        return;
      }

      const result = await window.youtubeAPI.getVideos();
      if (result.videos && result.videos.length > 0) {
        this.state.allVideos = result.videos;
        this.sortAllVideos();
        this.state.currentPage = 0;
        this.renderVideos(true);

        const saveJsonLink = document.getElementById('save-json-link') as HTMLAnchorElement;
        if (saveJsonLink) {
          saveJsonLink.style.pointerEvents = 'auto';
          saveJsonLink.style.opacity = '1';
        }
      }
    } catch (error) {
      console.error(rendererI18n.t('errors.errorInitializingApp'), error);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  (window as any).app = new YouTubeBatchManager();
});