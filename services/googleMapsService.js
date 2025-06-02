const axios = require('axios');

class GoogleMapsService {
    constructor() {
        this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
        this.baseUrl = 'https://maps.googleapis.com/maps/api';
    }

    // Get place details from coordinates
    async getPlaceDetails(lat, lng) {
        try {
            const response = await axios.get(`${this.baseUrl}/geocode/json`, {
                params: {
                    latlng: `${lat},${lng}`,
                    key: this.apiKey
                }
            });

            if (response.data.status === 'OK') {
                const result = response.data.results[0];
                return {
                    address: result.formatted_address,
                    location: {
                        type: 'Point',
                        coordinates: [result.geometry.location.lng, result.geometry.location.lat]
                    }
                };
            }
            throw new Error('Failed to get place details');
        } catch (error) {
            throw new Error(`Google Maps API Error: ${error.message}`);
        }
    }

    // Calculate distance and duration between two points
    async calculateRoute(origin, destination) {
        try {
            const response = await axios.get(`${this.baseUrl}/directions/json`, {
                params: {
                    origin: `${origin[1]},${origin[0]}`, // lat,lng
                    destination: `${destination[1]},${destination[0]}`, // lat,lng
                    key: this.apiKey
                }
            });

            if (response.data.status === 'OK') {
                const route = response.data.routes[0].legs[0];
                return {
                    distance: route.distance.value, // in meters
                    duration: route.duration.value, // in seconds
                    polyline: response.data.routes[0].overview_polyline.points
                };
            }
            throw new Error('Failed to calculate route');
        } catch (error) {
            throw new Error(`Google Maps API Error: ${error.message}`);
        }
    }

    // Get nearby drivers
    async getNearbyDrivers(location, radius = 5000) { // radius in meters
        try {
            // This would typically query your database for drivers within radius
            // For now, we'll return a mock response
            return {
                drivers: [
                    {
                        id: '1',
                        location: {
                            type: 'Point',
                            coordinates: [location[0] + 0.001, location[1] + 0.001]
                        },
                        distance: 100 // meters
                    }
                ]
            };
        } catch (error) {
            throw new Error(`Failed to get nearby drivers: ${error.message}`);
        }
    }

    // Get place predictions for autocomplete
    async getPlacePredictions(input) {
        try {
            const response = await axios.get(`${this.baseUrl}/place/autocomplete/json`, {
                params: {
                    input,
                    key: this.apiKey,
                    types: 'address'
                }
            });

            if (response.data.status === 'OK') {
                return response.data.predictions.map(prediction => ({
                    placeId: prediction.place_id,
                    description: prediction.description
                }));
            }
            return [];
        } catch (error) {
            throw new Error(`Google Maps API Error: ${error.message}`);
        }
    }
}

module.exports = new GoogleMapsService(); 