const Redis = require('ioredis');

class CacheService {
    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            }
        });

        this.redis.on('error', (err) => {
            console.error('Redis connection error:', err);
        });

        this.redis.on('connect', () => {
            console.log('Connected to Redis');
        });

        // Default TTL of 1 hour
        this.DEFAULT_TTL = 3600;
    }

    // Generate cache key for coordinates
    generateCoordinateKey(coords1, coords2) {
        return `route:${coords1.join(',')}:${coords2.join(',')}`;
    }

    // Cache route calculation
    async getRoute(origin, destination) {
        const key = this.generateCoordinateKey(origin, destination);
        const cachedRoute = await this.redis.get(key);
        
        if (cachedRoute) {
            return JSON.parse(cachedRoute);
        }

        // If not in cache, calculate and store
        const route = await googleMapsService.calculateRoute(origin, destination);
        await this.redis.setex(key, this.DEFAULT_TTL, JSON.stringify(route));
        return route;
    }

    // Cache place details
    async getPlaceDetails(lat, lng) {
        const key = `place:${lat},${lng}`;
        const cachedPlace = await this.redis.get(key);
        
        if (cachedPlace) {
            return JSON.parse(cachedPlace);
        }

        const place = await googleMapsService.getPlaceDetails(lat, lng);
        await this.redis.setex(key, this.DEFAULT_TTL, JSON.stringify(place));
        return place;
    }

    // Clear cache for specific coordinates
    async clearRouteCache(coords1, coords2) {
        const key = this.generateCoordinateKey(coords1, coords2);
        await this.redis.del(key);
    }

    // Clear all route caches
    async clearAllRouteCaches() {
        const keys = await this.redis.keys('route:*');
        if (keys.length > 0) {
            await this.redis.del(keys);
        }
    }

    // Clear all place caches
    async clearAllPlaceCaches() {
        const keys = await this.redis.keys('place:*');
        if (keys.length > 0) {
            await this.redis.del(keys);
        }
    }

    // Close Redis connection
    async close() {
        await this.redis.quit();
    }
}

module.exports = new CacheService(); 