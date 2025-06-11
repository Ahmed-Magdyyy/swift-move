// services/googleMapsService.js
const axios = require('axios');
const Driver = require('../models/driverModel');
const ApiError = require('../utils/ApiError')

class GoogleMapsService {
    constructor() {
        this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
        this.baseUrl = 'https://maps.googleapis.com/maps/api';
        if (!this.apiKey) {
            console.warn('Google Maps API Key is not configured. Service will not work.');
        }
    }

    async getPlaceDetails(lat, lng) {
        if (!this.apiKey) throw new ApiError('Google Maps API Key is missing.', 500);
        try {
            const response = await axios.get(`${this.baseUrl}/geocode/json`, {
                params: {
                    latlng: `${lat},${lng}`,
                    key: this.apiKey
                }
            });

            if (response.data.status === 'OK' && response.data.results[0]) {
                const result = response.data.results[0];
                return {
                    address: result.formatted_address,
                    placeId: result.place_id,
                    location: {
                        type: 'Point',
                        coordinates: [result.geometry.location.lng, result.geometry.location.lat]
                    }
                };
            }
            throw new ApiError(response.data.error_message || 'Failed to get place details from Google Maps.', response.data.status === 'ZERO_RESULTS' ? 404 : 502); // 502 Bad Gateway for upstream errors
        } catch (error) {
            if (error instanceof ApiError) throw error;
            console.error('GoogleMapsService getPlaceDetails error:', error.response ? error.response.data : error.message);
            throw new ApiError(`Google Maps API Error (getPlaceDetails): ${error.message}`, 502);
        }
    }

    async calculateRoute(origin, destination) {
        if (!this.apiKey) throw new ApiError('Google Maps API Key is missing.', 500);
        try {
            const originStr = `${origin[1]},${origin[0]}`; // lat, lng
            const destinationStr = `${destination[1]},${destination[0]}`;

            const response = await axios.get(`${this.baseUrl}/directions/json`, {
                params: {
                    origin: originStr,
                    destination: destinationStr,
                    key: this.apiKey
                }
            });

            if (response.data.status === 'OK' && response.data.routes && response.data.routes.length > 0) {
                const routeLeg = response.data.routes[0].legs[0];
                return {
                    distance: routeLeg.distance.value,
                    duration: routeLeg.duration.value,
                    polyline: response.data.routes[0].overview_polyline.points
                };
            }
            throw new ApiError(response.data.error_message || 'Failed to calculate route using Google Maps.', response.data.status === 'ZERO_RESULTS' ? 404 : 502);
        } catch (error) {
            if (error instanceof ApiError) throw error;
            console.error('GoogleMapsService calculateRoute error:', error.response ? error.response.data : error.message);
            throw new ApiError(`Google Maps API Error (calculateRoute): ${error.message}`, 502);
        }
    }

    async getNearbyDrivers(pickupCoordinates, requestedVehicleType, radius = 5000) { 
        try {
            if (!Array.isArray(pickupCoordinates) || pickupCoordinates.length !== 2) {
                throw new ApiError('Invalid pickupCoordinates format. Expected [longitude, latitude].', 400);
            }
            if (!requestedVehicleType) {
                throw new ApiError('requestedVehicleType is required.', 400);
            }

            const query = {
                'vehicle.type': requestedVehicleType,
                isAvailable: true,
                status: 'accepted',
                currentLocation: {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: pickupCoordinates
                        },
                        $maxDistance: radius
                    }
                }
            };


            const drivers = await Driver.find(query)
                .populate('user', 'name phone averageRating profileImage')

            return drivers.map(driver => ({
                driverId: driver.user._id.toString(),
                name: driver.user.name,
                phone: driver.user.phone,
                averageRating: driver.user.averageRating,
                profileImage: driver.user.profileImage,
                vehicle: driver.vehicle,
                currentLocation: driver.currentLocation.coordinates,
            }));
        } catch (error) {
            if (error instanceof ApiError) throw error;
            console.error('Error in getNearbyDrivers:', error);
            throw new ApiError(`Failed to get nearby drivers: ${error.message}`, 500);
        }
    }

    async getPlacePredictions(input, sessionToken) {
        if (!this.apiKey) throw new ApiError('Google Maps API Key is missing.', 500);
        if (!input) return [];
        try {
            const params = { input, key: this.apiKey, types: 'address' };
            if (sessionToken) params.sessiontoken = sessionToken;

            const response = await axios.get(`${this.baseUrl}/place/autocomplete/json`, params);

            if (response.data.status === 'OK') {
                return response.data.predictions.map(prediction => ({
                    placeId: prediction.place_id,
                    description: prediction.description,
                }));
            }
            if (response.data.status === 'ZERO_RESULTS') return [];
            throw new ApiError(response.data.error_message || 'Failed to get place predictions.', 502);
        } catch (error) {
            if (error instanceof ApiError) throw error;
            console.error('GoogleMapsService getPlacePredictions error:', error.response ? error.response.data : error.message);
            throw new ApiError(`Google Maps API Error (getPlacePredictions): ${error.message}`, 502);
        }
    }
}

module.exports = new GoogleMapsService();