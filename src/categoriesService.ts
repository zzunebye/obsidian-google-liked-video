import { YouTubeCategory, CategoriesCache } from './types';
import { LikedVideoApi } from './api';
import { debugLogger } from './debug';

const CACHE_KEY = 'geulo-video-categories';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

class CategoriesService {
    private categories: Map<string, YouTubeCategory> = new Map();
    private isLoaded = false;
    private isLoading = false;

    /**
     * Initialize categories by loading from cache or fetching from API
     */
    async loadCategories(api: LikedVideoApi): Promise<void> {
        if (this.isLoaded || this.isLoading) {
            return;
        }

        this.isLoading = true;
        debugLogger.info('Loading YouTube video categories...');

        try {
            // Try to load from cache first
            const cached = this.loadFromCache();
            if (cached) {
                this.categories = new Map(Object.entries(cached.categories));
                this.isLoaded = true;
                debugLogger.info(`Loaded ${this.categories.size} categories from cache`);
                this.isLoading = false;
                return;
            }

            // If cache is empty or expired, fetch from API
            debugLogger.info('Cache expired or empty, fetching categories from API');
            const fetchedCategories = await api.fetchVideoCategories();

            if (fetchedCategories && fetchedCategories.length > 0) {
                // Convert array to map for efficient lookups
                this.categories.clear();
                fetchedCategories.forEach(category => {
                    this.categories.set(category.id, category);
                });

                // Save to cache
                this.saveToCache(fetchedCategories);
                this.isLoaded = true;
                debugLogger.info(`Fetched and cached ${this.categories.size} categories`);
            } else {
                debugLogger.warn('No categories fetched from API');
            }
        } catch (error) {
            debugLogger.error('Failed to load categories:', error);
            // Continue with empty categories map - plugin should still function
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Get category name by ID
     */
    getCategoryName(categoryId: string): string {
        if (!categoryId) {
            return 'Unknown';
        }

        const category = this.categories.get(categoryId);
        if (category) {
            return category.title;
        }

        // If not found and not loaded yet, return a loading indicator
        if (!this.isLoaded && this.isLoading) {
            return 'Loading...';
        }

        return 'Unknown';
    }

    /**
     * Get formatted category display text
     */
    getCategoryDisplay(categoryId: string): string {
        const categoryName = this.getCategoryName(categoryId);
        if (categoryName === 'Unknown' || categoryName === 'Loading...') {
            return `${categoryName} (${categoryId})`;
        }
        return `${categoryName} (${categoryId})`;
    }

    /**
     * Check if categories are loaded
     */
    isReady(): boolean {
        return this.isLoaded;
    }

    /**
     * Get all categories as array
     */
    getAllCategories(): YouTubeCategory[] {
        return Array.from(this.categories.values());
    }

    /**
     * Clear cache and reload categories
     */
    async refreshCategories(api: LikedVideoApi): Promise<void> {
        this.clearCache();
        this.categories.clear();
        this.isLoaded = false;
        await this.loadCategories(api);
    }

    /**
     * Load categories from localStorage cache
     */
    private loadFromCache(): CategoriesCache | null {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (!cached) {
                return null;
            }

            const data: CategoriesCache = JSON.parse(cached);
            const now = Date.now();

            // Check if cache is expired
            if (now - data.lastFetched > CACHE_DURATION) {
                debugLogger.debug('Categories cache expired');
                return null;
            }

            debugLogger.debug('Categories loaded from cache');
            return data;
        } catch (error) {
            debugLogger.error('Failed to load categories from cache:', error);
            return null;
        }
    }

    /**
     * Save categories to localStorage cache
     */
    private saveToCache(categories: YouTubeCategory[]): void {
        try {
            const cacheData: CategoriesCache = {
                categories: {},
                lastFetched: Date.now()
            };

            // Convert to object for JSON serialization
            categories.forEach(category => {
                cacheData.categories[category.id] = category;
            });

            localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
            debugLogger.debug('Categories saved to cache');
        } catch (error) {
            debugLogger.error('Failed to save categories to cache:', error);
        }
    }

    /**
     * Clear cache
     */
    private clearCache(): void {
        try {
            localStorage.removeItem(CACHE_KEY);
            debugLogger.debug('Categories cache cleared');
        } catch (error) {
            debugLogger.error('Failed to clear categories cache:', error);
        }
    }

    /**
     * Get cache status for debugging
     */
    getCacheStatus(): { isLoaded: boolean; isLoading: boolean; categoriesCount: number; lastFetched?: number } {
        const cached = this.loadFromCache();
        return {
            isLoaded: this.isLoaded,
            isLoading: this.isLoading,
            categoriesCount: this.categories.size,
            lastFetched: cached?.lastFetched
        };
    }
}

export const categoriesService = new CategoriesService();