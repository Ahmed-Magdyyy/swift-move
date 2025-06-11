const googleMapsService = require('./googleMapsService');

class PricingService {
    constructor() {
        this.baseRates = {
            bike: {
                basePrice: 10,
                perKmRate: 2
            },
            car: {
                basePrice: 20,
                perKmRate: 3
            },
            van: {
                basePrice: 30,
                perKmRate: 4
            },
            truck: {
                basePrice: 50,
                perKmRate: 5
            }
        };

    }

    async calculateMovePrice(pickup, delivery, vehicleType) {
        try {
            // Get route details from Google Maps
            const route = await googleMapsService.calculateRoute(
                pickup.coordinates.coordinates,
                delivery.coordinates.coordinates
            );

            // Calculate base price
            const vehicleRate = this.baseRates[vehicleType];
            const distanceInKm = route.distance / 1000; // convert meters to kilometers
            const basePrice = vehicleRate.basePrice;
            const distancePrice = distanceInKm * vehicleRate.perKmRate;

            // Calculate total price
            const totalPrice = basePrice + distancePrice;

            return {
                basePrice,
                distancePrice,
                totalPrice,
                distance: route.distance,
                duration: route.duration,
                polyline: route.polyline
            };
        } catch (error) {
            throw new Error(`Failed to calculate price: ${error.message}`);
        }
    }

    // Calculate driver earnings (platform takes 20% commission)
    calculateDriverEarnings(totalPrice) {
        const commission = totalPrice * 0.2;
        return {
            total: totalPrice,
            commission,
            driverEarnings: totalPrice - commission
        };
    }

}

module.exports = new PricingService(); 