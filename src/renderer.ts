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

  constructor() {
    this.initializeTheme();
    this.setupEventListeners();
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
        saveAllBtn.textContent = `Save All (${this.state.changedVideos.size})`;
      }
    } else {
      if (saveAllBtn) saveAllBtn.style.display = 'none';
    }
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

    const updates = Array.from(this.state.changedVideos).map(videoId => {
      const titleInput = document.getElementById(`title-${videoId}`) as HTMLInputElement;
      const descriptionInput = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;

      return {
        video_id: videoId,
        title: titleInput.value,
        description: descriptionInput.value,
      };
    });

    this.showStatus(`Saving ${updates.length} videos...`, 'info');

    try {
      const result = await window.youtubeAPI.updateVideosBatch({ updates });

      if (result.success) {
        const successCount = result.results?.successful?.length || updates.length;
        const failCount = result.results?.failed?.length || 0;

        if (failCount > 0) {
          this.showStatus(`${successCount} videos updated, ${failCount} failed`, 'info');
        } else {
          this.showStatus(`All ${successCount} videos updated successfully!`, 'success');
        }

        this.state.changedVideos.clear();
        document.querySelectorAll('[id^="update-btn-"]').forEach(btn => {
          (btn as HTMLElement).style.display = 'none';
        });
        this.updateSaveAllButton();
      } else {
        this.showStatus('Failed to update videos', 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus('Error updating videos', 'error');
    } finally {
      saveAllBtn.disabled = false;
      saveAllBtn.innerHTML = originalText;
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
    const sortNames: Record<string, string> = {
      'date-desc': 'Date (Newest)',
      'date-asc': 'Date (Oldest)',
      'title-asc': 'Title (A-Z)',
      'title-desc': 'Title (Z-A)',
    };

    const currentSortEl = document.getElementById('current-sort');
    if (currentSortEl) {
      currentSortEl.textContent = sortNames[sortType];
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
    this.showStatus('Authenticating and loading videos from YouTube...', 'info');

    try {
      const authResult = await window.youtubeAPI.authenticate();
      if (!authResult) {
        this.showStatus('Authentication failed', 'error');
        return;
      }

      await this.loadChannelInfo();

      const result = await window.youtubeAPI.loadVideos();

      if (result.success) {
        this.state.allVideos = result.videos;
        this.sortAllVideos();
        this.state.currentPage = 0;
        this.renderVideos(true);
        this.showStatus(`Loaded ${result.count} videos successfully!`, 'success');

        const saveJsonLink = document.getElementById('save-json-link') as HTMLAnchorElement;
        if (saveJsonLink) {
          saveJsonLink.style.pointerEvents = 'auto';
          saveJsonLink.style.opacity = '1';
        }
      } else {
        this.showStatus(result.error || 'Failed to load videos', 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus('Error loading videos', 'error');
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

  async downloadVideos(): Promise<void> {
    this.showStatus('Preparing download...', 'info');

    try {
      const result = await window.youtubeAPI.downloadVideos();

      if (result.success && !result.cancelled) {
        this.showStatus('Videos saved successfully!', 'success');
      } else if (result.cancelled) {
        this.showStatus('Download cancelled', 'info');
      } else {
        this.showStatus(result.error || 'Failed to save videos', 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus('Error saving videos', 'error');
    }
  }

  async loadFromFile(): Promise<void> {
    this.showStatus('Loading videos from file...', 'info');

    try {
      const result = await window.youtubeAPI.loadJsonFile();

      if (result.success && !result.cancelled) {
        this.state.allVideos = result.videos;
        this.sortAllVideos();
        this.state.currentPage = 0;
        this.renderVideos(true);
        this.showStatus('Videos loaded from file successfully!', 'success');

        const saveJsonLink = document.getElementById('save-json-link') as HTMLAnchorElement;
        if (saveJsonLink) {
          saveJsonLink.style.pointerEvents = 'auto';
          saveJsonLink.style.opacity = '1';
        }
      } else if (result.cancelled) {
        this.showStatus('File selection cancelled', 'info');
      } else {
        this.showStatus(result.message || result.error || 'Failed to load videos from file', 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus('Error loading videos from file', 'error');
    }
  }

  async updateVideo(videoId: string): Promise<void> {
    const titleInput = document.getElementById(`title-${videoId}`) as HTMLInputElement;
    const descriptionInput = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
    const updateBtn = document.getElementById(`update-btn-${videoId}`) as HTMLButtonElement;

    updateBtn.disabled = true;
    updateBtn.textContent = 'Updating...';

    try {
      const result = await window.youtubeAPI.updateVideo({
        video_id: videoId,
        title: titleInput.value,
        description: descriptionInput.value,
      });

      if (result.success) {
        this.showStatus('Video updated successfully!', 'success');
        this.state.changedVideos.delete(videoId);
        updateBtn.style.display = 'none';
        this.updateSaveAllButton();
      } else {
        this.showStatus('Failed to update video', 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showStatus('Error updating video', 'error');
    } finally {
      updateBtn.disabled = false;
      updateBtn.textContent = 'Update Video';
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
            <h3>No videos loaded</h3>
            <p>Click "Load from YouTube" to fetch your videos, or "Load from File" to load a previous backup.</p>
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
                Published: ${video.published_at.substring(0, 10)}
                ${video.privacy_status ? `<span class="privacy-status">${video.privacy_status.charAt(0).toUpperCase() + video.privacy_status.slice(1)}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="form-group">
            <label for="title-${video.id}">Title</label>
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
            <label for="description-${video.id}">Description</label>
            <textarea
              class="form-control"
              id="description-${video.id}"
              oninput="app.handleDescriptionChange('${video.id}'); app.handleTextareaResize(this)"
            >${this.escapeHtml(video.description)}</textarea>
          </div>

          <div class="video-actions">
            <button class="btn btn-success" onclick="app.updateVideo('${video.id}')" id="update-btn-${video.id}" style="display: none;">
              Update Video Info
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

  private async initializeApp(): Promise<void> {
    try {
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
      console.error('Error initializing app:', error);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  (window as any).app = new YouTubeBatchManager();
});