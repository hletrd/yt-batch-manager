import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TranslationData {
  [key: string]: any;
}

class I18n {
  private translations: TranslationData = {};
  private currentLanguage: string = 'en';
  private fallbackLanguage: string = 'en';
  private availableLanguages: string[] = [];
  private initialized: boolean = false;

  constructor() {
    this.scanAvailableLanguages();
    this.loadLanguage(this.fallbackLanguage);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!app.isReady()) {
      await app.whenReady();
    }

    this.currentLanguage = this.detectSystemLanguage();
    this.loadLanguage(this.currentLanguage);
    this.initialized = true;
  }

  private scanAvailableLanguages(): void {
    try {
      const i18nDir = __dirname;
      const files = fs.readdirSync(i18nDir);

      console.log(`Files: ${files}`);
      console.log(`I18n dir: ${i18nDir}`);

      this.availableLanguages = files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''))
        .sort();

      console.log(`Available languages found: ${this.availableLanguages.join(', ')}`);

      if (!this.availableLanguages.includes(this.fallbackLanguage)) {
        console.warn(`Fallback language ${this.fallbackLanguage} not found in available languages`);
        if (this.availableLanguages.length > 0) {
          this.fallbackLanguage = this.availableLanguages[0];
          console.log(`Using ${this.fallbackLanguage} as fallback language`);
        }
      }
    } catch (error) {
      console.error('Error scanning for available languages:', error);
      this.availableLanguages = ['en'];
    }
  }

  private detectSystemLanguage(): string {
    try {
      if (!app.isReady()) {
        console.warn('App not ready when detecting system language, using fallback');
        return this.fallbackLanguage;
      }

      const systemLocale = app.getLocale();

      if (!systemLocale || systemLocale.trim() === '') {
        console.warn('System locale is empty, trying alternative methods');

        const envLang = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL;
        if (envLang) {
          const languageCode = envLang.split('_')[0].split('.')[0].toLowerCase();
          console.log(`Using language from environment: ${languageCode}`);
          if (this.availableLanguages.includes(languageCode)) {
            return languageCode;
          }
        }

        console.warn('No valid system language detected, using fallback');
        return this.fallbackLanguage;
      }

      const languageCode = systemLocale.split('-')[0].toLowerCase();

      console.log(`System locale: ${systemLocale}`);
      console.log(`Language code: ${languageCode}`);
      console.log(`Available languages: ${this.availableLanguages.join(', ')}`);

      if (this.availableLanguages.includes(languageCode)) {
        return languageCode;
      } else {
        console.log(`System language ${languageCode} not available, falling back to ${this.fallbackLanguage}`);
        return this.fallbackLanguage;
      }
    } catch (error) {
      console.warn('Error detecting system language:', error);
      return this.fallbackLanguage;
    }
  }

  setLanguage(language: string): void {
    if (this.availableLanguages.includes(language)) {
      this.currentLanguage = language;
      this.loadLanguage(language);
      console.log(`Language switched to: ${language}`);
    } else {
      console.warn(`Language ${language} not available. Available languages: ${this.availableLanguages.join(', ')}`);
    }
  }

  getAvailableLanguages(): string[] {
    return [...this.availableLanguages];
  }

  addAvailableLanguage(language: string): void {
    if (!this.availableLanguages.includes(language)) {
      this.availableLanguages.push(language);
      this.availableLanguages.sort();
    }
  }

  refreshAvailableLanguages(): void {
    this.scanAvailableLanguages();
  }

  getCurrentLanguage(): string {
    return this.currentLanguage;
  }

  private loadLanguage(language: string): void {
    try {
      const languageFilePath = path.join(__dirname, `${language}.json`);
      if (fs.existsSync(languageFilePath)) {
        const languageData = fs.readFileSync(languageFilePath, 'utf-8');
        this.translations = JSON.parse(languageData);
      } else if (language !== this.fallbackLanguage) {
        console.warn(`Language file not found for ${language}, falling back to ${this.fallbackLanguage}`);
        this.loadLanguage(this.fallbackLanguage);
      } else {
        console.error(`Fallback language file not found: ${this.fallbackLanguage}.json`);
      }
    } catch (error) {
      console.error(`Error loading language file for ${language}:`, error);
      if (language !== this.fallbackLanguage) {
        this.loadLanguage(this.fallbackLanguage);
      }
    }
  }

  t(key: string, params?: Record<string, any>): string {
    const keys = key.split('.');
    let value: any = this.translations;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        console.warn(`Translation key not found: ${key}`);
        return key;
      }
    }

    if (typeof value !== 'string') {
      console.warn(`Translation value is not a string for key: ${key}`);
      return key;
    }

    if (params) {
      return this.interpolate(value, params);
    }

    return value;
  }

  private interpolate(template: string, params: Record<string, any>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return params[key] !== undefined ? String(params[key]) : match;
    });
  }
}

export const i18n = new I18n();
export default i18n;
