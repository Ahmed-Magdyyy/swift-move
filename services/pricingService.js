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

        this.insuranceRates = {
            basic: 0.05, // 5% of total value
            premium: 0.1  // 10% of total value
        };
    }

    async calculateMovePrice(pickup, delivery, vehicleType, items = [], insurance = { isSelected: false, type: 'basic' }) {
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

            // Calculate insurance price if selected
            let insurancePrice = 0;
            if (insurance.isSelected) {
                const totalItemValue = items.reduce((sum, item) => sum + (item.value || 0), 0);
                insurancePrice = totalItemValue * this.insuranceRates[insurance.type];
            }

            // Calculate total price
            const totalPrice = basePrice + distancePrice + insurancePrice;

            return {
                basePrice,
                distancePrice,
                insurancePrice,
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